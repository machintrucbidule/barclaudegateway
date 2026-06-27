import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './db.js';
import { openDatabase } from './db.js';
import { EventLog } from './eventLog.js';

describe('EventLog', () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('appends events (assigning id + at) and queries them newest-first', () => {
    let t = 1_000;
    const log = new EventLog(db, { maxRows: 100, maxAgeMs: 1_000_000 }, () => (t += 1));
    const first = log.append({
      category: 'auth',
      type: 'login_step1',
      level: 'info',
      message: 'a',
    });
    log.append({ category: 'scan', type: 'ean_read', level: 'info', message: 'b' });

    expect(first.id).toBeGreaterThan(0);
    expect(first.at).toBe(1_001);
    expect(log.count()).toBe(2);
    const rows = log.query({ page: 1, pageSize: 10 });
    expect(rows[0]?.message).toBe('b'); // newest first
    expect(rows[1]?.message).toBe('a');
  });

  it('round-trips the structured detail payload as JSON', () => {
    const log = new EventLog(db);
    log.append({
      category: 'scan',
      type: 'product_resolved',
      level: 'info',
      message: 'resolved',
      detail: { ean: '111', productId: 'P1' },
    });
    const [row] = log.query({ page: 1, pageSize: 10 });
    expect(row?.detail).toEqual({ ean: '111', productId: 'P1' });
  });

  it('filters and counts by category, and paginates', () => {
    const log = new EventLog(db);
    log.append({ category: 'auth', type: 'login_complete', level: 'info', message: 'x' });
    log.append({ category: 'scan', type: 'scan_complete', level: 'info', message: 'y' });
    log.append({ category: 'scan', type: 'scan_complete', level: 'info', message: 'z' });

    expect(log.count()).toBe(3);
    expect(log.count({ category: 'scan' })).toBe(2);
    expect(log.query({ category: 'scan', page: 1, pageSize: 1 })).toHaveLength(1);
    expect(log.query({ category: 'auth', page: 1, pageSize: 10 })).toHaveLength(1);
  });

  it('prunes by row cap (50 000 default), keeping the newest rows', () => {
    const log = new EventLog(db, { maxRows: 3, maxAgeMs: 1_000_000_000 });
    for (let i = 0; i < 10; i += 1)
      log.append({ category: 'other', type: 'startup', level: 'info', message: String(i) });
    const deleted = log.prune();
    expect(deleted).toBe(7);
    expect(log.count()).toBe(3);
    expect(log.query({ page: 1, pageSize: 10 }).map((r) => r.message)).toEqual(['9', '8', '7']);
  });

  it('prunes by age', () => {
    let now = 10_000_000;
    const log = new EventLog(db, { maxRows: 1_000, maxAgeMs: 100 }, () => now);
    log.append({ category: 'other', type: 'startup', level: 'info', message: 'old' });
    now = 10_000_500;
    log.append({ category: 'other', type: 'startup', level: 'info', message: 'fresh' });
    expect(log.prune()).toBe(1);
    expect(log.query({ page: 1, pageSize: 10 }).map((r) => r.message)).toEqual(['fresh']);
  });
});
