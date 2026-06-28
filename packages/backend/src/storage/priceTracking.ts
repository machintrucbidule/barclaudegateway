/**
 * Price-tracking storage (BL-012): the products under tracking + their per-product price history.
 *
 * `tracked_products` is one row per watched product (its threshold, last seen price, and the `alert_armed`
 * flag that makes a drop fire exactly once per threshold crossing). `price_history` is a bounded append-log
 * of observed prices, pruned like the scan/event logs (row cap OR age, most restrictive wins).
 */

import type { Database } from './db.js';
import type { RetentionPolicy } from './scanLog.js';

export interface TrackedProductRow {
  productId: string;
  ean: string | null;
  label: string | null;
  threshold: number;
  createdAt: number;
  lastPrice: number | null;
  lastCheckedAt: number | null;
  armed: boolean;
  lastAlertAt: number | null;
}

export interface PricePointRow {
  price: number;
  at: number;
}

const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1_000;

/** Price history is verbose-but-slow (a few points per product per day); a generous cap is the bound. */
export const DEFAULT_PRICE_RETENTION: RetentionPolicy = {
  maxRows: 50_000,
  maxAgeMs: TEN_YEARS_MS,
};

interface DbTrackedRow {
  product_id: string;
  ean: string | null;
  label: string | null;
  threshold: number;
  created_at: number;
  last_price: number | null;
  last_checked_at: number | null;
  alert_armed: number;
  last_alert_at: number | null;
}

function toTracked(r: DbTrackedRow): TrackedProductRow {
  return {
    productId: r.product_id,
    ean: r.ean,
    label: r.label,
    threshold: r.threshold,
    createdAt: r.created_at,
    lastPrice: r.last_price,
    lastCheckedAt: r.last_checked_at,
    armed: r.alert_armed !== 0,
    lastAlertAt: r.last_alert_at,
  };
}

export class PriceTrackingStore {
  constructor(
    private readonly db: Database,
    private readonly retention: RetentionPolicy = DEFAULT_PRICE_RETENTION,
    private readonly now: () => number = Date.now,
  ) {}

  /** All tracked products, newest first. */
  list(): TrackedProductRow[] {
    const rows = this.db
      .prepare('SELECT * FROM tracked_products ORDER BY created_at DESC')
      .all() as unknown as DbTrackedRow[];
    return rows.map(toTracked);
  }

  get(productId: string): TrackedProductRow | undefined {
    const row = this.db
      .prepare('SELECT * FROM tracked_products WHERE product_id = ?')
      .get(productId) as DbTrackedRow | undefined;
    return row ? toTracked(row) : undefined;
  }

  /** Insert or update a tracked product (re-adding updates its threshold/label and re-arms it). */
  add(input: {
    productId: string;
    ean?: string | null;
    label?: string | null;
    threshold: number;
  }): TrackedProductRow {
    this.db
      .prepare(
        `INSERT INTO tracked_products (product_id, ean, label, threshold, created_at, alert_armed)
         VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT(product_id) DO UPDATE SET
           ean = excluded.ean, label = excluded.label, threshold = excluded.threshold, alert_armed = 1`,
      )
      .run(input.productId, input.ean ?? null, input.label ?? null, input.threshold, this.now());
    return this.get(input.productId) as TrackedProductRow;
  }

  remove(productId: string): boolean {
    const res = this.db.prepare('DELETE FROM tracked_products WHERE product_id = ?').run(productId);
    this.db.prepare('DELETE FROM price_history WHERE product_id = ?').run(productId);
    return Number(res.changes) > 0;
  }

  updateThreshold(productId: string, threshold: number): boolean {
    const res = this.db
      .prepare('UPDATE tracked_products SET threshold = ? WHERE product_id = ?')
      .run(threshold, productId);
    return Number(res.changes) > 0;
  }

  /** Record an observed price: update the product's last price/check time and append a history point. */
  recordPrice(productId: string, price: number, at: number = this.now()): void {
    this.db
      .prepare(
        'UPDATE tracked_products SET last_price = ?, last_checked_at = ? WHERE product_id = ?',
      )
      .run(price, at, productId);
    this.db
      .prepare('INSERT INTO price_history (product_id, price, at) VALUES (?, ?, ?)')
      .run(productId, price, at);
  }

  /** Recent price points for a product, newest first. */
  history(productId: string, limit = 100): PricePointRow[] {
    return this.db
      .prepare('SELECT price, at FROM price_history WHERE product_id = ? ORDER BY at DESC LIMIT ?')
      .all(productId, limit) as unknown as PricePointRow[];
  }

  /** Arm/disarm the per-product alert (disarmed after firing, re-armed when the price recovers). */
  setArmed(productId: string, armed: boolean): void {
    this.db
      .prepare('UPDATE tracked_products SET alert_armed = ? WHERE product_id = ?')
      .run(armed ? 1 : 0, productId);
  }

  markAlerted(productId: string, at: number = this.now()): void {
    this.db
      .prepare(
        'UPDATE tracked_products SET last_alert_at = ?, alert_armed = 0 WHERE product_id = ?',
      )
      .run(at, productId);
  }

  /** Enforce the price-history retention policy. Returns the number of rows deleted. */
  prune(): number {
    const cutoff = this.now() - this.retention.maxAgeMs;
    const byAge = this.db.prepare('DELETE FROM price_history WHERE at < ?').run(cutoff);
    const byCount = this.db
      .prepare(
        'DELETE FROM price_history WHERE id NOT IN (SELECT id FROM price_history ORDER BY id DESC LIMIT ?)',
      )
      .run(this.retention.maxRows);
    return Number(byAge.changes) + Number(byCount.changes);
  }
}
