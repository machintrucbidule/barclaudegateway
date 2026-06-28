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
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type {
  LocalApiError,
  LocalApiStatus,
  ProductSearchResponse,
} from '@barclaudegateway/shared';
import { LOCAL_API_KEY_HEADER } from '@barclaudegateway/shared';
import type { ConfigStore } from '../storage/config.js';
import type { EmitEvent } from '../logging/eventLogger.js';
import type { LogEventType } from '@barclaudegateway/shared';
import type { ChronodriveClient } from '../chronodrive/client.js';
import { ChronodriveError, NotFoundError } from './errors.js';
import { validateEan } from '../ingest/ean.js';
import { toNormalizedProduct, toProductSummary } from '../chronodrive/productMapper.js';

export interface LocalApiDeps {
  /** Source of the auto-managed `local_api_key` (read fresh per request so rotation needs no restart). */
  configStore: ConfigStore;
  /** BL-009: emit point — every inbound request is journalled as an `api_local` event. */
  emit: EmitEvent;
  /** BL-010: the upstream Chronodrive client serving product search + product sheets. */
  chronodrive: ChronodriveClient;
}

/** Send a clean 502 for a failed upstream Chronodrive call, journalling it as an `chronodrive` error. */
function upstreamFailure(
  reply: FastifyReply,
  emit: EmitEvent,
  type: LogEventType,
  context: string,
  err: unknown,
): FastifyReply {
  const category = err instanceof ChronodriveError ? err.category : 'unknown';
  emit({
    category: 'chronodrive',
    type,
    level: 'error',
    message: `${context} failed (${category})`,
  });
  const body: LocalApiError = { error: 'upstream Chronodrive error', code: 'upstream_error' };
  return reply.code(502).send(body);
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

  // BL-010 — product search. Returns a page of lean summaries (fetch the sheet for nutrition).
  app.get('/search', async (request, reply) => {
    const q = (request.query as { q?: unknown } | undefined)?.q;
    if (typeof q !== 'string' || q.trim().length === 0) {
      const body: LocalApiError = { error: 'query parameter q is required', code: 'bad_request' };
      return reply.code(400).send(body);
    }
    const term = q.trim();
    try {
      const res = await deps.chronodrive.searchProducts(term);
      deps.emit({
        category: 'chronodrive',
        type: 'product_search',
        level: 'info',
        message: `search "${term}" → ${res.content.length} result(s)`,
      });
      const response: ProductSearchResponse = {
        products: res.content.map(toProductSummary),
        page: {
          number: res.page.number,
          size: res.page.size,
          totalElements: res.page.totalElements,
          totalPages: res.page.totalPages,
          hasNext: res.page.hasNext,
        },
      };
      return response;
    } catch (err) {
      return upstreamFailure(reply, deps.emit, 'product_search', `search "${term}"`, err);
    }
  });

  // BL-010 — product sheet by EAN or Chronodrive product id. An EAN (valid GS1 barcode) resolves via
  // the upstream search (§5.13); anything else is treated as a product id (§5.12).
  app.get('/products/:eanOrId', async (request, reply) => {
    const { eanOrId } = request.params as { eanOrId: string };
    const ean = validateEan(eanOrId);
    try {
      const product =
        ean.ok && ean.normalized !== undefined
          ? await deps.chronodrive.getProductByEan(ean.normalized)
          : await deps.chronodrive.getProduct(eanOrId);
      if (product === null) {
        deps.emit({
          category: 'chronodrive',
          type: 'product_lookup',
          level: 'info',
          message: `product lookup ${eanOrId} → not found`,
        });
        const body: LocalApiError = { error: 'product not found', code: 'not_found' };
        return reply.code(404).send(body);
      }
      deps.emit({
        category: 'chronodrive',
        type: 'product_lookup',
        level: 'info',
        message: `product lookup ${eanOrId} → ${product.id}`,
      });
      return toNormalizedProduct(product);
    } catch (err) {
      if (err instanceof NotFoundError) {
        deps.emit({
          category: 'chronodrive',
          type: 'product_lookup',
          level: 'info',
          message: `product lookup ${eanOrId} → not found`,
        });
        const body: LocalApiError = { error: 'product not found', code: 'not_found' };
        return reply.code(404).send(body);
      }
      return upstreamFailure(reply, deps.emit, 'product_lookup', `product lookup ${eanOrId}`, err);
    }
  });

  return Promise.resolve();
};
