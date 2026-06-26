import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './db.js';
import { openDatabase } from './db.js';
import { ScanLog } from './scanLog.js';

describe('ScanLog', () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('appends and reads recent entries newest-first', () => {
    let t = 1_000;
    const log = new ScanLog(db, { maxRows: 100, maxAgeMs: 1_000_000 }, () => (t += 1));
    log.append({ ean: '111', outcome: 'added' });
    log.append({ ean: '222', outcome: 'not_found', message: 'unknown EAN' });
    expect(log.count()).toBe(2);
    const recent = log.recent();
    expect(recent[0]?.ean).toBe('222');
    expect(recent[0]?.message).toBe('unknown EAN');
    expect(recent[1]?.ean).toBe('111');
  });

  it('prunes by row cap, keeping the newest rows', () => {
    const log = new ScanLog(db, { maxRows: 3, maxAgeMs: 1_000_000_000 });
    for (let i = 0; i < 10; i += 1) log.append({ ean: String(i), outcome: 'added' });
    const deleted = log.prune();
    expect(deleted).toBe(7);
    expect(log.count()).toBe(3);
    expect(log.recent().map((r) => r.ean)).toEqual(['9', '8', '7']);
  });

  it('prunes by age', () => {
    let now = 10_000_000;
    const log = new ScanLog(db, { maxRows: 1_000, maxAgeMs: 100 }, () => now);
    log.append({ ean: 'old', outcome: 'added' }); // created_at = 10_000_000
    now = 10_000_500; // advance well past maxAgeMs
    log.append({ ean: 'fresh', outcome: 'added' }); // created_at = 10_000_500
    const deleted = log.prune(); // cutoff = 10_000_400 → 'old' dropped
    expect(deleted).toBe(1);
    expect(log.recent().map((r) => r.ean)).toEqual(['fresh']);
  });
});
