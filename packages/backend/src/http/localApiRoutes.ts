/**
 * Local "Layer B" API (BL-008, DECISION-022/023), mounted under `/api/v1`.
 *
 * The personal API this gateway *exposes* so other devices/apps (notably the macronome integration) can
 * query Chronodrive through it — distinct from the internal UI API (`/api/*`, {@link apiRoutes}) and the
 * ESP ingestion endpoint (`POST /v1/scan`). BATCH-7 ships only the foundation: a versioned prefix, an
 * `X-API-Key` guard, per-request operational logging, and a `GET /api/v1/ping` health stub. The data
 * endpoints (search, product, cart, lists, recipe-fill, price-tracking) arrive in BATCH-8..10.
 *
 * Security: a single shared key (auto-generated + backend-managed, see `bootstrap.ts`) is read fresh from
 * config on every request and compared in constant time to the `X-API-Key` header. Missing/wrong/empty →
 * HTTP 401. The guard is an `onRequest` hook **encapsulated to this plugin** (Fastify child context), so
 * `POST /v1/scan` and the UI `/api/*` routes are untouched.
 *
 * Observability (epic acceptance, DECISION-022): an `onResponse` hook journals every served request as an
 * `api_local` ("API interne") {@link LogEvent}, visible and filterable on the `/logs` page. The key and
 * request headers are never logged.
 */

import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { LocalApiError, LocalApiStatus } from '@barclaudegateway/shared';
import { LOCAL_API_KEY_HEADER } from '@barclaudegateway/shared';
import type { ConfigStore } from '../storage/config.js';
import type { EmitEvent } from '../logging/eventLogger.js';

export interface LocalApiDeps {
  /** Source of the auto-managed `local_api_key` (read fresh per request so rotation needs no restart). */
  configStore: ConfigStore;
  /** BL-009: emit point — every inbound request is journalled as an `api_local` event. */
  emit: EmitEvent;
}

/** Constant-time compare of the stored key against the provided header value. Empty/absent key = locked. */
function keyMatches(stored: string | undefined, provided: unknown): boolean {
  if (
    stored === undefined ||
    stored.length === 0 ||
    typeof provided !== 'string' ||
    provided.length === 0
  )
    return false;
  const a = Buffer.from(stored, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  // timingSafeEqual throws on unequal lengths; the length check both guards that and is itself a
  // (cheap, non-secret) mismatch — a wrong-length key is simply wrong.
  return a.length === b.length && timingSafeEqual(a, b);
}

export const localApiRoutes: FastifyPluginAsync<{ deps: LocalApiDeps }> = (app, opts) => {
  const { deps } = opts;

  // Guard: every request to this prefix must carry the right X-API-Key, else 401.
  app.addHook('onRequest', async (request, reply) => {
    const stored = deps.configStore.readAppConfig().localApiKey;
    if (!keyMatches(stored, request.headers[LOCAL_API_KEY_HEADER])) {
      const body: LocalApiError = { error: 'invalid or missing X-API-Key', code: 'unauthorized' };
      return reply.code(401).send(body);
    }
  });

  // Observability: one `api_local` line per served request (incl. rejected ones). Secret-free — only the
  // method, path and status are recorded, never the key or other headers.
  app.addHook('onResponse', async (request, reply) => {
    deps.emit({
      category: 'api_local',
      type: 'local_api_request',
      level: reply.statusCode >= 400 ? 'warn' : 'info',
      message: `${request.method} ${request.url} → ${reply.statusCode}`,
    });
  });

  // Unknown paths under this prefix get a clean JSON 404 (not the SPA history-fallback).
  app.setNotFoundHandler((_request, reply) => {
    const body: LocalApiError = { error: 'Not found', code: 'not_found' };
    reply.code(404).send(body);
  });

  // BATCH-7 stub: proves the guard + routing. Data endpoints are added in BATCH-8..10.
  app.get('/ping', async () => {
    const body: LocalApiStatus = { status: 'ok', version: 1 };
    return body;
  });

  return Promise.resolve();
};
