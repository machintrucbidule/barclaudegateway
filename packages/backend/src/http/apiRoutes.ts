/**
 * Local web-UI API (Phase 4), mounted under `/api`.
 *
 * Reuses the Phase 3 stores — nothing here is a second source of truth. The config page edits the same
 * `enabled_destinations` and static `config` rows the pipeline reads; the dashboard reads the bounded
 * scan journal and the health self-test; the Logs page consumes the live SSE stream.
 *
 * Security (contract.md §8): credentials are WRITE-ONLY. `PUT /api/credentials` stores them encrypted;
 * no route ever serialises the password back — `GET /api/config` exposes only `credentials.set`. The
 * per-service `x-api-key`s are not secret and are returned/edited normally. Secrets are never logged.
 */

import type { FastifyPluginAsync } from 'fastify';
import type {
  ApiConfig,
  ConfigResponse,
  CredentialsInput,
  DestinationsResponse,
  EnabledDestinations,
  EventsResponse,
  LogCategory,
  ScansResponse,
} from '@barclaudegateway/shared';
import type { ChronodriveClient } from '../chronodrive/client.js';
import type { AppConfig } from '../config/defaults.js';
import { appConfigToEntries } from '../config/defaults.js';
import { runHealthSelfTest } from '../health/selfTest.js';
import { ChronodriveError } from './errors.js';
import type { ConfigStore } from '../storage/config.js';
import type { CredentialStore } from '../storage/credentials.js';
import type { DestinationsStore } from '../storage/destinations.js';
import type { ScanLog } from '../storage/scanLog.js';
import type { EventLog } from '../storage/eventLog.js';
import type { ScanEventBus } from '../ingest/scanEvents.js';
import type { EventLogBus } from '../logging/eventLogBus.js';
import type { EmitEvent } from '../logging/eventLogger.js';
import type { ErrorMonitor } from '../health/errorMonitor.js';
import type { HaWebhookNotifier } from '../health/haWebhook.js';

export interface ApiDeps {
  chronodrive: ChronodriveClient;
  configStore: ConfigStore;
  destinations: DestinationsStore;
  credentialStore: CredentialStore;
  scanLog: ScanLog;
  events: ScanEventBus;
  /** BL-003: the bounded operational-log journal (`GET /api/events` initial load). */
  eventLog: EventLog;
  /** BL-003: the live operational-log bus (`GET /api/events/stream`). */
  eventBus: EventLogBus;
  /** BL-003: emit point — config/credentials changes are journalled as `other` events. */
  emit: EmitEvent;
  /** Phase 5: the live critical-error state behind the maintenance surface. */
  errorMonitor: ErrorMonitor;
  /** Phase 5: the Home Assistant alert sender (also drives the config-page "send test"). */
  haWebhook: HaWebhookNotifier;
}

const SCAN_PAGE_SIZE_DEFAULT = 100;
const SCAN_PAGE_SIZE_MAX = 500;
/** Allowed page sizes for the scan history (BL-004); `all` returns every matching row. */
const SCAN_PAGE_SIZES = new Set([10, 50, 100, 500]);
const EVENT_PAGE_SIZE_DEFAULT = 100;
const EVENT_PAGE_SIZE_MAX = 500;
const LOG_CATEGORIES: ReadonlySet<string> = new Set(['auth', 'scan', 'other']);
const SSE_KEEPALIVE_MS = 25_000;

/** Parse a positive integer query param, clamped to `[1, max]`, falling back to `fallback`. */
function parsePage(
  raw: string | undefined,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const parsed = raw !== undefined ? Number.parseInt(raw, 10) : fallback;
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), max) : fallback;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Compact, secret-free description of an error for a `listsError` payload. */
function describeError(error: unknown): { category: string; message: string } {
  if (error instanceof ChronodriveError) {
    return { category: error.category, message: error.message.slice(0, 200) };
  }
  return {
    category: 'unknown',
    message: (error as Error)?.message?.slice(0, 200) ?? 'Unknown error',
  };
}

/** The `AppConfig` projected to the wire shape (identical fields; no secrets to strip). */
function toApiConfig(config: AppConfig): ApiConfig {
  return {
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    scope: config.scope,
    identityBaseUrl: config.identityBaseUrl,
    apiBaseUrl: config.apiBaseUrl,
    apiKeys: { ...config.apiKeys },
    siteMode: config.siteMode,
    siteId: config.siteId,
    haWebhookUrl: config.haWebhookUrl,
  };
}

/** Validate a `PUT /api/config` body into a full {@link AppConfig}, or return a human error. */
function parseConfigBody(
  body: unknown,
): { ok: true; config: AppConfig } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null)
    return { ok: false, error: 'Expected a JSON object' };
  const b = body as Record<string, unknown>;
  const keys = b.apiKeys as Record<string, unknown> | undefined;

  if (!isNonEmptyString(b.clientId)) return { ok: false, error: 'clientId is required' };
  if (!isHttpUrl(b.redirectUri)) return { ok: false, error: 'redirectUri must be an http(s) URL' };
  if (!isNonEmptyString(b.scope)) return { ok: false, error: 'scope is required' };
  if (!isHttpUrl(b.identityBaseUrl))
    return { ok: false, error: 'identityBaseUrl must be an http(s) URL' };
  if (!isHttpUrl(b.apiBaseUrl)) return { ok: false, error: 'apiBaseUrl must be an http(s) URL' };
  if (typeof keys !== 'object' || keys === null) return { ok: false, error: 'apiKeys is required' };
  if (!isNonEmptyString(keys.search)) return { ok: false, error: 'apiKeys.search is required' };
  if (!isNonEmptyString(keys.customerCartRead))
    return { ok: false, error: 'apiKeys.customerCartRead is required' };
  if (!isNonEmptyString(keys.cartWrite))
    return { ok: false, error: 'apiKeys.cartWrite is required' };
  if (!isNonEmptyString(keys.shoppingLists))
    return { ok: false, error: 'apiKeys.shoppingLists is required' };
  if (!isNonEmptyString(b.siteMode)) return { ok: false, error: 'siteMode is required' };
  // siteId is optional: a string, possibly empty (empty = dynamic detection).
  if (b.siteId !== undefined && typeof b.siteId !== 'string')
    return { ok: false, error: 'siteId must be a string' };
  // haWebhookUrl is optional: empty string (disabled) OR a valid http(s) URL.
  if (b.haWebhookUrl !== undefined && b.haWebhookUrl !== '' && !isHttpUrl(b.haWebhookUrl))
    return { ok: false, error: 'haWebhookUrl must be empty or an http(s) URL' };

  return {
    ok: true,
    config: {
      clientId: b.clientId,
      redirectUri: b.redirectUri,
      scope: b.scope,
      identityBaseUrl: b.identityBaseUrl,
      apiBaseUrl: b.apiBaseUrl,
      apiKeys: {
        search: keys.search,
        customerCartRead: keys.customerCartRead,
        cartWrite: keys.cartWrite,
        shoppingLists: keys.shoppingLists,
      },
      siteMode: b.siteMode,
      siteId: typeof b.siteId === 'string' ? b.siteId : '',
      haWebhookUrl: typeof b.haWebhookUrl === 'string' ? b.haWebhookUrl : '',
    },
  };
}

/** Validate a `PUT /api/config/destinations` body into {@link EnabledDestinations}. */
function parseDestinationsBody(
  body: unknown,
): { ok: true; value: EnabledDestinations } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null)
    return { ok: false, error: 'Expected a JSON object' };
  const b = body as Record<string, unknown>;
  if (typeof b.cart !== 'boolean') return { ok: false, error: 'cart must be a boolean' };
  if (!Array.isArray(b.lists)) return { ok: false, error: 'lists must be an array' };
  const lists: Array<{ id: string; name: string }> = [];
  for (const entry of b.lists) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !isNonEmptyString((entry as Record<string, unknown>).id) ||
      typeof (entry as Record<string, unknown>).name !== 'string'
    ) {
      return { ok: false, error: 'each list needs a non-empty id and a name' };
    }
    const e = entry as { id: string; name: string };
    lists.push({ id: e.id, name: e.name });
  }
  return { ok: true, value: { cart: b.cart, lists } };
}

export const apiRoutes: FastifyPluginAsync<{ deps: ApiDeps }> = (app, opts) => {
  const { deps } = opts;

  const configPayload = (): ConfigResponse => ({
    ...toApiConfig(deps.configStore.readAppConfig()),
    credentials: { set: deps.credentialStore.has() },
  });

  // ---- Health -------------------------------------------------------------------------------
  // Skip the probe entirely (no connection attempt) until credentials are saved; the dashboard then
  // shows an informational "not configured yet" message instead of a degraded/error state.
  app.get('/health', async () =>
    runHealthSelfTest(deps.chronodrive, { isConfigured: () => deps.credentialStore.has() }),
  );

  // ---- Critical-error surface (Phase 5) -----------------------------------------------------
  // Current state for the maintenance page/banner's initial load (the SSE stream below pushes changes).
  app.get('/error-state', async () => deps.errorMonitor.getState());

  // Live error-state stream: emit the current state on connect, then on every transition.
  app.get('/error-state/stream', (request, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    res.write(`data: ${JSON.stringify(deps.errorMonitor.getState())}\n\n`);

    const unsubscribe = deps.errorMonitor.subscribe((state) => {
      res.write(`data: ${JSON.stringify(state)}\n\n`);
    });
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), SSE_KEEPALIVE_MS);
    keepAlive.unref();

    request.raw.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  // Send a sample alert to the configured Home Assistant webhook (the config-page test button).
  app.post('/notify/test', async () => deps.haWebhook.sendTest());

  // ---- Static config + write-only credentials -----------------------------------------------
  app.get('/config', async () => configPayload());

  app.put('/config', async (request, reply) => {
    const parsed = parseConfigBody(request.body);
    if (!parsed.ok) {
      reply.code(400);
      return { error: parsed.error };
    }
    for (const [key, value] of appConfigToEntries(parsed.config)) {
      deps.configStore.set(key, value);
    }
    deps.emit({
      category: 'other',
      type: 'config_change',
      level: 'info',
      message: 'Configuration updated via the web UI',
    });
    return configPayload();
  });

  app.put('/credentials', async (request, reply) => {
    const body = request.body as Partial<CredentialsInput> | undefined;
    if (!isNonEmptyString(body?.email) || !isNonEmptyString(body?.password)) {
      reply.code(400);
      return { error: 'email and password are required' };
    }
    deps.credentialStore.save({ email: body.email, password: body.password });
    deps.emit({
      category: 'other',
      type: 'credentials_change',
      level: 'info',
      message: 'Chronodrive credentials saved',
    });
    // Never echo the password back — only the set indicator.
    return { credentials: { set: true } };
  });

  app.delete('/credentials', async () => {
    deps.credentialStore.clear();
    deps.emit({
      category: 'other',
      type: 'credentials_change',
      level: 'info',
      message: 'Chronodrive credentials cleared',
    });
    return { credentials: { set: false } };
  });

  // ---- Destinations (the enabled_destinations editor) ---------------------------------------
  app.get('/config/destinations', async () => {
    const enabled = deps.destinations.read();
    const response: DestinationsResponse = {
      enabled,
      available: { cart: { name: 'Panier' }, lists: [] },
    };
    try {
      response.available.lists = await deps.chronodrive.getShoppingLists();
    } catch (error) {
      // No credentials yet / API down: still render the cart + already-saved lists, flag the failure.
      response.listsError = describeError(error);
    }
    return response;
  });

  app.put('/config/destinations', async (request, reply) => {
    const parsed = parseDestinationsBody(request.body);
    if (!parsed.ok) {
      reply.code(400);
      return { error: parsed.error };
    }
    deps.destinations.write(parsed.value);
    deps.emit({
      category: 'other',
      type: 'config_change',
      level: 'info',
      message: `Scan destinations updated (cart=${String(parsed.value.cart)}, lists=${String(parsed.value.lists.length)})`,
    });
    // Read back so the client confirms the round-trip through enabled_destinations.
    return deps.destinations.read();
  });

  // ---- Scan history (searchable, filterable, paginated — BL-004) -----------------------------
  app.get('/scans', async (request) => {
    const q = request.query as
      | { page?: string; pageSize?: string; status?: string; search?: string }
      | undefined;
    const status = isNonEmptyString(q?.status) ? q.status : undefined;
    const search = isNonEmptyString(q?.search) ? q.search : undefined;

    // pageSize: one of 10/50/100/500, or "all" (a single page of every matching row). Default 100.
    let pageSize: number | null;
    if (q?.pageSize === 'all') {
      pageSize = null;
    } else {
      const parsed = q?.pageSize !== undefined ? Number.parseInt(q.pageSize, 10) : NaN;
      pageSize = SCAN_PAGE_SIZES.has(parsed)
        ? Math.min(parsed, SCAN_PAGE_SIZE_MAX)
        : SCAN_PAGE_SIZE_DEFAULT;
    }
    const page = pageSize === null ? 1 : parsePage(q?.page, 1);

    const total = deps.scanLog.countMatching({ status, search });
    const scans = deps.scanLog.query({ status, search, page, pageSize });
    const response: ScansResponse = { scans, total, page, pageSize: pageSize ?? total };
    return response;
  });

  // ---- Operational logs (BL-003) ------------------------------------------------------------
  // Initial load: a page of recent log lines (newest first), optionally restricted to a category.
  app.get('/events', async (request) => {
    const q = request.query as { page?: string; pageSize?: string; category?: string } | undefined;
    const category =
      q?.category !== undefined && LOG_CATEGORIES.has(q.category)
        ? (q.category as LogCategory)
        : undefined;
    const page = parsePage(q?.page, 1);
    const pageSize = parsePage(q?.pageSize, EVENT_PAGE_SIZE_DEFAULT, EVENT_PAGE_SIZE_MAX);
    const response: EventsResponse = {
      events: deps.eventLog.query({ category, page, pageSize }),
      total: deps.eventLog.count({ category }),
      page,
      pageSize,
    };
    return response;
  });

  // Live operational-log tail (SSE): forward each new event to connected browsers.
  app.get('/events/stream', (request, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');

    const unsubscribe = deps.eventBus.subscribe((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), SSE_KEEPALIVE_MS);
    keepAlive.unref();

    request.raw.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  // ---- Live scan stream (SSE) ---------------------------------------------------------------
  app.get('/scans/stream', (request, reply) => {
    reply.hijack(); // we own the socket: write the event-stream framing on the raw response ourselves.
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable proxy buffering so events flush immediately.
    });
    res.write('retry: 3000\n\n'); // hint the browser's auto-reconnect backoff.

    const unsubscribe = deps.events.subscribe((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), SSE_KEEPALIVE_MS);
    keepAlive.unref();

    request.raw.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  return Promise.resolve();
};
