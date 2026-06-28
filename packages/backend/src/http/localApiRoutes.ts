/**
 * Local "Layer B" API (BL-008, DECISION-022/023), mounted under `/api/v1`.
 *
 * The personal API this gateway *exposes* so other devices/apps (notably the macronome integration) can
 * query Chronodrive through it — distinct from the internal UI API (`/api/*`, {@link apiRoutes}) and the
 * ESP ingestion endpoint (`POST /v1/scan`). Foundation (BATCH-7): a versioned prefix, an `X-API-Key`
 * guard, per-request `api_local` logging, and `GET /api/v1/ping`. Data endpoints: search + product sheet
 * (BATCH-8); cart read/write, lists CRUD, recipe-fill, budget+nutrition aggregate (BATCH-9). Price-tracking
 * arrives in BATCH-10. Each upstream call is journalled as a `chronodrive` event.
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
  CartWriteResult,
  ItemRef,
  ItemResolution,
  ListSummary,
  ListWriteResult,
  LocalApiError,
  LocalApiStatus,
  NormalizedCart,
  NormalizedCartLine,
  NormalizedList,
  ProductSearchResponse,
  RecipeFillRequest,
  RecipeFillResult,
} from '@barclaudegateway/shared';
import { LOCAL_API_KEY_HEADER } from '@barclaudegateway/shared';
import type { ConfigStore } from '../storage/config.js';
import type { EmitEvent } from '../logging/eventLogger.js';
import type { LogEventType } from '@barclaudegateway/shared';
import type { ChronodriveClient } from '../chronodrive/client.js';
import { ChronodriveError, NotFoundError } from './errors.js';
import { validateEan } from '../ingest/ean.js';
import { toNormalizedProduct, toProductSummary } from '../chronodrive/productMapper.js';
import { aggregateCartNutrition, toNormalizedCart } from '../chronodrive/cartMapper.js';

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

/**
 * Resolve a write {@link ItemRef} to a Chronodrive product id (BL-011, DECISION-025). Priority
 * `id` → `ean` → `name`; `id` is trusted as-is, `ean`/`name` resolve via the Products search.
 */
async function resolveItemRef(
  chronodrive: ChronodriveClient,
  ref: ItemRef,
): Promise<ItemResolution> {
  if (typeof ref.id === 'string' && ref.id.length > 0) {
    return { ref, status: 'resolved', productId: ref.id };
  }
  if (typeof ref.ean === 'string' && ref.ean.length > 0) {
    const p = await chronodrive.getProductByEan(ref.ean);
    return p
      ? { ref, status: 'resolved', productId: p.id, matchedName: p.labels?.productLabel }
      : { ref, status: 'not_found' };
  }
  if (typeof ref.name === 'string' && ref.name.trim().length > 0) {
    const res = await chronodrive.searchProducts(ref.name.trim(), 1, 1);
    const p = res.content?.[0];
    return p
      ? { ref, status: 'resolved', productId: p.id, matchedName: p.labels?.productLabel }
      : { ref, status: 'not_found' };
  }
  return { ref, status: 'not_found' };
}

/** Validate a `{ items: ItemRef[] }` body into a usable item list, or return a human error. */
function parseItems(body: unknown): { ok: true; items: ItemRef[] } | { ok: false; error: string } {
  const items = (body as { items?: unknown } | undefined)?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'items must be a non-empty array' };
  }
  for (const it of items) {
    const ref = it as ItemRef;
    if (typeof ref !== 'object' || ref === null || (!ref.id && !ref.ean && !ref.name)) {
      return { ok: false, error: 'each item needs one of id, ean or name' };
    }
  }
  return { ok: true, items: items as ItemRef[] };
}

function badRequest(reply: FastifyReply, error: string): FastifyReply {
  const body: LocalApiError = { error, code: 'bad_request' };
  return reply.code(400).send(body);
}

function notFound(reply: FastifyReply, error: string): FastifyReply {
  const body: LocalApiError = { error, code: 'not_found' };
  return reply.code(404).send(body);
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

  // ---- BL-011 cart -----------------------------------------------------------------------------

  /** Find the active (non-ordered) cart in a `GET /v1/customers/me/carts` response. */
  type CartEntry = Awaited<ReturnType<ChronodriveClient['getActiveCart']>>['content'][number];
  const activeCart = async (): Promise<CartEntry | null> => {
    const cart = await deps.chronodrive.getActiveCart();
    return cart.content?.find((c) => !c.isOrdered) ?? cart.content?.[0] ?? null;
  };

  app.get('/cart', async (_request, reply) => {
    try {
      const active = await activeCart();
      if (!active) return notFound(reply, 'no active cart');
      deps.emit({
        category: 'chronodrive',
        type: 'cart_read',
        level: 'info',
        message: 'read cart',
      });
      const response: NormalizedCart = toNormalizedCart(active);
      return response;
    } catch (err) {
      return upstreamFailure(reply, deps.emit, 'cart_read', 'read cart', err);
    }
  });

  app.get('/cart/nutrition', async (_request, reply) => {
    try {
      const active = await activeCart();
      if (!active) return notFound(reply, 'no active cart');
      deps.emit({
        category: 'chronodrive',
        type: 'cart_read',
        level: 'info',
        message: 'aggregate cart nutrition',
      });
      return aggregateCartNutrition(active);
    } catch (err) {
      return upstreamFailure(reply, deps.emit, 'cart_read', 'aggregate cart', err);
    }
  });

  app.post('/cart/items', async (request, reply) => {
    const parsed = parseItems(request.body);
    if (!parsed.ok) return badRequest(reply, parsed.error);
    try {
      const resolutions = await Promise.all(
        parsed.items.map((ref) => resolveItemRef(deps.chronodrive, ref)),
      );
      const applied: CartWriteResult['applied'] = [];
      resolutions.forEach((r, idx) => {
        if (r.status === 'resolved' && r.productId !== undefined) {
          applied.push({ productId: r.productId, quantity: parsed.items[idx]?.quantity ?? 1 });
        }
      });
      if (applied.length > 0) {
        const cartId = await deps.chronodrive.getActiveCartId();
        await deps.chronodrive.updateCartItems(cartId, applied);
      }
      deps.emit({
        category: 'chronodrive',
        type: 'cart_write',
        level: 'info',
        message: `cart write: ${applied.length}/${parsed.items.length} item(s) applied`,
      });
      const response: CartWriteResult = { resolutions, applied };
      return response;
    } catch (err) {
      return upstreamFailure(reply, deps.emit, 'cart_write', 'cart write', err);
    }
  });

  app.delete('/cart/items/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const active = await activeCart();
      if (!active) return notFound(reply, 'no active cart');
      const line = active.items.find((l) => (l.product?.id ?? l.productId) === id);
      if (!line) return notFound(reply, 'product not in cart');
      // Read-then-zero (§5.6 safe removal): a signed delta that brings the line to 0.
      await deps.chronodrive.updateCartItems(active.id, [
        { productId: id, quantity: -line.quantity },
      ]);
      deps.emit({
        category: 'chronodrive',
        type: 'cart_write',
        level: 'info',
        message: `cart remove ${id}`,
      });
      return { removed: id };
    } catch (err) {
      return upstreamFailure(reply, deps.emit, 'cart_write', `cart remove ${id}`, err);
    }
  });

  // ---- BL-011 lists ----------------------------------------------------------------------------

  app.get('/lists', async (_request, reply) => {
    try {
      const lists = await deps.chronodrive.getShoppingLists();
      deps.emit({
        category: 'chronodrive',
        type: 'list_read',
        level: 'info',
        message: 'read lists',
      });
      const response: ListSummary[] = lists.map((l) => ({
        id: l.id,
        name: l.name,
        nbItems: l.nbItems,
        hasAvailableProduct: l.hasAvailableProduct,
      }));
      return { lists: response };
    } catch (err) {
      return upstreamFailure(reply, deps.emit, 'list_read', 'read lists', err);
    }
  });

  app.get('/lists/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const [list, contents] = await Promise.all([
        deps.chronodrive.getShoppingList(id),
        deps.chronodrive.getListContents(id),
      ]);
      deps.emit({
        category: 'chronodrive',
        type: 'list_read',
        level: 'info',
        message: `read list ${id}`,
      });
      const items: NormalizedCartLine[] = contents.content.map((c) => ({
        quantity: c.quantity,
        product: toProductSummary(c.product),
      }));
      const response: NormalizedList = {
        id: list.id,
        name: list.name,
        items,
        page: {
          number: contents.page.number,
          size: contents.page.size,
          totalElements: contents.page.totalElements,
          totalPages: contents.page.totalPages,
          hasNext: contents.page.hasNext,
        },
      };
      return response;
    } catch (err) {
      if (err instanceof NotFoundError) return notFound(reply, 'list not found');
      return upstreamFailure(reply, deps.emit, 'list_read', `read list ${id}`, err);
    }
  });

  app.post('/lists/:id/items', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = parseItems(request.body);
    if (!parsed.ok) return badRequest(reply, parsed.error);
    try {
      const resolutions = await Promise.all(
        parsed.items.map((ref) => resolveItemRef(deps.chronodrive, ref)),
      );
      const applied: string[] = [];
      const toAdd: Array<{ productId: string; quantity: number }> = [];
      resolutions.forEach((r, idx) => {
        if (r.status === 'resolved' && r.productId !== undefined) {
          applied.push(r.productId);
          toAdd.push({ productId: r.productId, quantity: parsed.items[idx]?.quantity ?? 1 });
        }
      });
      if (toAdd.length > 0) await deps.chronodrive.addToList(id, toAdd);
      deps.emit({
        category: 'chronodrive',
        type: 'list_write',
        level: 'info',
        message: `list ${id} add: ${applied.length}/${parsed.items.length}`,
      });
      const response: ListWriteResult = { resolutions, applied };
      return response;
    } catch (err) {
      if (err instanceof NotFoundError) return notFound(reply, 'list not found');
      return upstreamFailure(reply, deps.emit, 'list_write', `list ${id} add`, err);
    }
  });

  app.delete('/lists/:id/items', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ids = (request.body as { ids?: unknown } | undefined)?.ids;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x) => typeof x === 'string')) {
      return badRequest(reply, 'ids must be a non-empty array of product ids');
    }
    try {
      await deps.chronodrive.removeFromList(id, ids as string[]);
      deps.emit({
        category: 'chronodrive',
        type: 'list_write',
        level: 'info',
        message: `list ${id} remove: ${ids.length}`,
      });
      return { removed: ids };
    } catch (err) {
      if (err instanceof NotFoundError) return notFound(reply, 'list not found');
      return upstreamFailure(reply, deps.emit, 'list_write', `list ${id} remove`, err);
    }
  });

  // ---- BL-011 recipe-fill ----------------------------------------------------------------------

  app.post('/recipe-fill', async (request, reply) => {
    const body = request.body as Partial<RecipeFillRequest> | undefined;
    const target = body?.target;
    if (
      !target ||
      !(
        ('cart' in target && target.cart === true) ||
        ('listId' in target && typeof target.listId === 'string')
      )
    ) {
      return badRequest(reply, 'target must be { cart: true } or { listId }');
    }
    const parsed = parseItems(body);
    if (!parsed.ok) return badRequest(reply, parsed.error);
    try {
      const resolutions = await Promise.all(
        parsed.items.map((ref) => resolveItemRef(deps.chronodrive, ref)),
      );
      const resolved: Array<{ productId: string; quantity: number }> = [];
      resolutions.forEach((r, idx) => {
        if (r.status === 'resolved' && r.productId !== undefined) {
          resolved.push({ productId: r.productId, quantity: parsed.items[idx]?.quantity ?? 1 });
        }
      });
      if (resolved.length > 0) {
        if ('cart' in target) {
          const cartId = await deps.chronodrive.getActiveCartId();
          await deps.chronodrive.updateCartItems(cartId, resolved);
        } else {
          await deps.chronodrive.addToList(target.listId, resolved);
        }
      }
      deps.emit({
        category: 'chronodrive',
        type: 'recipe_fill',
        level: 'info',
        message: `recipe-fill → ${'cart' in target ? 'cart' : `list ${target.listId}`}: ${resolved.length}/${parsed.items.length}`,
      });
      const response: RecipeFillResult = { target, resolutions, added: resolved.length };
      return response;
    } catch (err) {
      if (err instanceof NotFoundError) return notFound(reply, 'list not found');
      return upstreamFailure(reply, deps.emit, 'recipe_fill', 'recipe-fill', err);
    }
  });

  return Promise.resolve();
};
