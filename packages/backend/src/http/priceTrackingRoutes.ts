/**
 * Price-tracking CRUD (BL-012, DECISION-026) — one sub-plugin registered on BOTH surfaces (the user's
 * choice): the internal UI API `/api/price-tracking/*` (no key, used by the "Suivi des prix" page) and the
 * local API `/api/v1/price-tracking/*` (inherits the BATCH-7 `X-API-Key` guard via plugin encapsulation,
 * for macronome/external clients). Wraps the {@link PriceTrackingStore} + the {@link PriceScheduler}.
 */

import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type {
  AddTrackedProductInput,
  CheckNowResult,
  LocalApiError,
  PriceHistoryResponse,
  PriceTrackingSettings,
  TrackedProduct,
  TrackedProductsResponse,
} from '@barclaudegateway/shared';
import type { ChronodriveClient } from '../chronodrive/client.js';
import type { ConfigStore } from '../storage/config.js';
import { CONFIG_KEYS } from '../config/defaults.js';
import type { PriceTrackingStore, TrackedProductRow } from '../storage/priceTracking.js';
import type { PriceScheduler } from '../price/priceScheduler.js';
import type { EmitEvent } from '../logging/eventLogger.js';
import { ChronodriveError, NotFoundError } from './errors.js';

export interface PriceTrackingDeps {
  store: PriceTrackingStore;
  chronodrive: Pick<ChronodriveClient, 'getProduct' | 'getProductByEan'>;
  scheduler: Pick<PriceScheduler, 'trigger' | 'applyConfig'>;
  configStore: ConfigStore;
  emit: EmitEvent;
}

function toDto(r: TrackedProductRow): TrackedProduct {
  return {
    productId: r.productId,
    ...(r.ean !== null ? { ean: r.ean } : {}),
    ...(r.label !== null ? { label: r.label } : {}),
    threshold: r.threshold,
    ...(r.lastPrice !== null ? { lastPrice: r.lastPrice } : {}),
    ...(r.lastCheckedAt !== null ? { lastCheckedAt: r.lastCheckedAt } : {}),
    armed: r.armed,
    ...(r.lastAlertAt !== null ? { lastAlertAt: r.lastAlertAt } : {}),
  };
}

function badRequest(reply: FastifyReply, error: string): FastifyReply {
  const body: LocalApiError = { error, code: 'bad_request' };
  return reply.code(400).send(body);
}

function notFound(reply: FastifyReply, error: string): FastifyReply {
  const body: LocalApiError = { error, code: 'not_found' };
  return reply.code(404).send(body);
}

export const priceTrackingRoutes: FastifyPluginAsync<{ deps: PriceTrackingDeps }> = (app, opts) => {
  const { deps } = opts;

  app.get('/', async () => {
    const response: TrackedProductsResponse = { products: deps.store.list().map(toDto) };
    return response;
  });

  app.get('/settings', async () => {
    const c = deps.configStore.readAppConfig();
    const settings: PriceTrackingSettings = {
      enabled: c.priceTrackingEnabled ?? false,
      intervalHours: c.priceTrackingIntervalHours ?? 12,
    };
    return settings;
  });

  app.put('/settings', async (request, reply) => {
    const b = request.body as Partial<PriceTrackingSettings> | undefined;
    if (
      typeof b?.enabled !== 'boolean' ||
      typeof b?.intervalHours !== 'number' ||
      b.intervalHours < 1
    ) {
      return badRequest(reply, 'enabled (boolean) and intervalHours (>= 1) are required');
    }
    const intervalHours = Math.floor(b.intervalHours);
    deps.configStore.set(CONFIG_KEYS.priceTrackingEnabled, String(b.enabled));
    deps.configStore.set(CONFIG_KEYS.priceTrackingIntervalHours, String(intervalHours));
    deps.scheduler.applyConfig(); // (re)start or stop the timer to reflect the new settings
    deps.emit({
      category: 'other',
      type: 'config_change',
      level: 'info',
      message: `price tracking ${b.enabled ? 'enabled' : 'disabled'} @ ${String(intervalHours)}h`,
    });
    const settings: PriceTrackingSettings = { enabled: b.enabled, intervalHours };
    return settings;
  });

  app.post('/check-now', async () => {
    const result: CheckNowResult = await deps.scheduler.trigger();
    return result;
  });

  app.post('/', async (request, reply) => {
    const b = request.body as Partial<AddTrackedProductInput> | undefined;
    if (typeof b?.threshold !== 'number' || b.threshold <= 0) {
      return badRequest(reply, 'threshold (a positive number) is required');
    }
    if (!b.ean && !b.productId) return badRequest(reply, 'ean or productId is required');
    try {
      const product = b.productId
        ? await deps.chronodrive.getProduct(b.productId)
        : await deps.chronodrive.getProductByEan(b.ean as string);
      deps.emit({
        category: 'chronodrive',
        type: 'product_lookup',
        level: 'info',
        message: `price-tracking resolve ${b.productId ?? b.ean ?? ''}`,
      });
      if (!product) return notFound(reply, 'product not found');
      const row = deps.store.add({
        productId: product.id,
        ean: product.eans?.[0] ?? b.ean ?? null,
        label: product.labels?.productLabel ?? null,
        threshold: b.threshold,
      });
      deps.emit({
        category: 'other',
        type: 'config_change',
        level: 'info',
        message: `tracking product ${product.id} (seuil ${String(b.threshold)})`,
      });
      return toDto(row);
    } catch (err) {
      if (err instanceof NotFoundError) return notFound(reply, 'product not found');
      const category = err instanceof ChronodriveError ? err.category : 'unknown';
      deps.emit({
        category: 'chronodrive',
        type: 'product_lookup',
        level: 'error',
        message: `price-tracking resolve failed (${category})`,
      });
      const body: LocalApiError = { error: 'upstream Chronodrive error', code: 'upstream_error' };
      return reply.code(502).send(body);
    }
  });

  app.put('/:productId', async (request, reply) => {
    const { productId } = request.params as { productId: string };
    const threshold = (request.body as { threshold?: unknown } | undefined)?.threshold;
    if (typeof threshold !== 'number' || threshold <= 0) {
      return badRequest(reply, 'threshold (a positive number) is required');
    }
    if (!deps.store.updateThreshold(productId, threshold)) {
      return notFound(reply, 'product not tracked');
    }
    deps.emit({
      category: 'other',
      type: 'config_change',
      level: 'info',
      message: `tracking threshold ${productId} → ${String(threshold)}`,
    });
    return toDto(deps.store.get(productId) as TrackedProductRow);
  });

  app.delete('/:productId', async (request, reply) => {
    const { productId } = request.params as { productId: string };
    if (!deps.store.remove(productId)) return notFound(reply, 'product not tracked');
    deps.emit({
      category: 'other',
      type: 'config_change',
      level: 'info',
      message: `untracking product ${productId}`,
    });
    return { removed: productId };
  });

  app.get('/:productId/history', async (request) => {
    const { productId } = request.params as { productId: string };
    const response: PriceHistoryResponse = {
      productId,
      history: deps.store.history(productId),
    };
    return response;
  });

  return Promise.resolve();
};
