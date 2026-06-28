import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './db.js';
import { openDatabase } from './db.js';
import { PriceTrackingStore } from './priceTracking.js';

describe('PriceTrackingStore', () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('adds, gets and lists tracked products (re-add updates + re-arms)', () => {
    let t = 1_000;
    const store = new PriceTrackingStore(db, undefined, () => (t += 1));
    const added = store.add({ productId: 'P1', ean: '111', label: 'Lait', threshold: 1.5 });
    expect(added).toMatchObject({ productId: 'P1', ean: '111', threshold: 1.5, armed: true });

    store.markAlerted('P1'); // disarm
    expect(store.get('P1')?.armed).toBe(false);
    // Re-adding updates the threshold and re-arms.
    const readded = store.add({ productId: 'P1', ean: '111', label: 'Lait', threshold: 1.2 });
    expect(readded.threshold).toBe(1.2);
    expect(readded.armed).toBe(true);

    store.add({ productId: 'P2', threshold: 2, ean: null, label: null });
    expect(store.list().map((p) => p.productId)).toContain('P1');
    expect(store.list()).toHaveLength(2);
  });

  it('records prices, builds history, and updates last price', () => {
    const store = new PriceTrackingStore(db);
    store.add({ productId: 'P1', threshold: 1.5 });
    store.recordPrice('P1', 1.99, 100);
    store.recordPrice('P1', 1.49, 200);
    expect(store.get('P1')?.lastPrice).toBe(1.49);
    expect(store.get('P1')?.lastCheckedAt).toBe(200);
    const hist = store.history('P1');
    expect(hist.map((h) => h.price)).toEqual([1.49, 1.99]); // newest first
  });

  it('arms/disarms and updates the threshold', () => {
    const store = new PriceTrackingStore(db);
    store.add({ productId: 'P1', threshold: 1.5 });
    store.setArmed('P1', false);
    expect(store.get('P1')?.armed).toBe(false);
    store.setArmed('P1', true);
    expect(store.get('P1')?.armed).toBe(true);
    expect(store.updateThreshold('P1', 0.99)).toBe(true);
    expect(store.get('P1')?.threshold).toBe(0.99);
    expect(store.updateThreshold('MISSING', 1)).toBe(false);
  });

  it('removes a product and its history', () => {
    const store = new PriceTrackingStore(db);
    store.add({ productId: 'P1', threshold: 1 });
    store.recordPrice('P1', 1, 10);
    expect(store.remove('P1')).toBe(true);
    expect(store.get('P1')).toBeUndefined();
    expect(store.history('P1')).toEqual([]);
    expect(store.remove('P1')).toBe(false);
  });

  it('prunes price history by row cap', () => {
    // Fixed clock so the age cutoff (now − maxAgeMs) never deletes the recorded points.
    const store = new PriceTrackingStore(
      db,
      { maxRows: 3, maxAgeMs: 1_000_000_000_000 },
      () => 2_000_000,
    );
    store.add({ productId: 'P1', threshold: 1 });
    for (let i = 0; i < 10; i += 1) store.recordPrice('P1', i, 1_900_000 + i);
    expect(store.prune()).toBe(7);
    expect(store.history('P1')).toHaveLength(3);
  });
});
