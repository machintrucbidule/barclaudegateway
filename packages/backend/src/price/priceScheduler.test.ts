import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../storage/db.js';
import { openDatabase } from '../storage/db.js';
import { PriceTrackingStore } from '../storage/priceTracking.js';
import type { AppConfig } from '../config/defaults.js';
import { DEFAULT_APP_CONFIG } from '../config/defaults.js';
import { PriceScheduler } from './priceScheduler.js';

interface DropCall {
  productId: string;
  price: number;
}

function build(price: { value: number | undefined }): {
  db: Database;
  store: PriceTrackingStore;
  scheduler: PriceScheduler;
  drops: DropCall[];
} {
  const db = openDatabase(':memory:');
  const store = new PriceTrackingStore(db);
  const drops: DropCall[] = [];
  const scheduler = new PriceScheduler({
    chronodrive: {
      getProduct: async (id: string) => ({
        id,
        labels: {},
        eans: [],
        ...(price.value !== undefined ? { prices: { defaultPrice: price.value } } : {}),
      }),
    },
    store,
    notifier: {
      notifyPriceDrop: async (info) => {
        drops.push({ productId: info.productId, price: info.price });
        return { ok: true };
      },
    },
    configStore: {
      readAppConfig: (): AppConfig => ({ ...DEFAULT_APP_CONFIG }),
    },
    emit: () => {},
    now: () => 1_000,
  });
  return { db, store, scheduler, drops };
}

describe('PriceScheduler.runOnce', () => {
  let ctx: ReturnType<typeof build>;
  const price: { value: number | undefined } = { value: 2.0 };

  beforeEach(() => {
    ctx = build(price);
    ctx.store.add({ productId: 'P1', label: 'Lait', threshold: 1.5 });
  });

  afterEach(() => {
    ctx.scheduler.stop();
    ctx.db.close();
  });

  it('records the price without alerting while above the threshold', async () => {
    price.value = 2.0;
    const summary = await ctx.scheduler.runOnce();
    expect(summary).toEqual({ checked: 1, alerts: 0 });
    expect(ctx.store.get('P1')?.lastPrice).toBe(2.0);
    expect(ctx.drops).toHaveLength(0);
    expect(ctx.store.get('P1')?.armed).toBe(true);
  });

  it('fires once on a drop, disarms, does not re-fire while still below, re-arms on recovery', async () => {
    // Drop below the threshold → one alert, then disarmed.
    price.value = 1.2;
    expect((await ctx.scheduler.runOnce()).alerts).toBe(1);
    expect(ctx.drops).toHaveLength(1);
    expect(ctx.store.get('P1')?.armed).toBe(false);

    // Still below → no second alert.
    price.value = 1.1;
    expect((await ctx.scheduler.runOnce()).alerts).toBe(0);
    expect(ctx.drops).toHaveLength(1);

    // Recovers above the threshold → re-armed, no alert.
    price.value = 1.9;
    expect((await ctx.scheduler.runOnce()).alerts).toBe(0);
    expect(ctx.store.get('P1')?.armed).toBe(true);

    // Drops again → alerts again (a new crossing).
    price.value = 1.0;
    expect((await ctx.scheduler.runOnce()).alerts).toBe(1);
    expect(ctx.drops).toHaveLength(2);
  });

  it('skips a product with no price (does not record or alert)', async () => {
    price.value = undefined;
    const summary = await ctx.scheduler.runOnce();
    expect(summary).toEqual({ checked: 0, alerts: 0 });
    expect(ctx.store.get('P1')?.lastPrice).toBeNull();
  });
});
