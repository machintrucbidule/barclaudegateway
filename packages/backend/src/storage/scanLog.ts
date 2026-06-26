/**
 * Bounded scan journal (DECISION-003).
 *
 * Retention is "10 000 rows OR 10 years, whichever is most restrictive" (user-chosen at the design
 * gate); in practice the row cap bites first. {@link ScanLog.prune} is called on startup and daily.
 * Phase 3 owns the scan→action pipeline; this table is intentionally minimal here.
 */

import type { Database } from './db.js';

export interface ScanLogEntry {
  ean: string;
  outcome: string;
  message?: string;
}

export interface RetentionPolicy {
  maxRows: number;
  maxAgeMs: number;
}

const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1_000;

export const DEFAULT_RETENTION: RetentionPolicy = {
  maxRows: 10_000,
  maxAgeMs: TEN_YEARS_MS,
};

export class ScanLog {
  constructor(
    private readonly db: Database,
    private readonly retention: RetentionPolicy = DEFAULT_RETENTION,
    private readonly now: () => number = Date.now,
  ) {}

  /** Append a scan record (epoch-ms timestamped). */
  append(entry: ScanLogEntry): void {
    this.db
      .prepare('INSERT INTO scan_log (created_at, ean, outcome, message) VALUES (?, ?, ?, ?)')
      .run(this.now(), entry.ean, entry.outcome, entry.message ?? null);
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM scan_log').get() as { n: number };
    return row.n;
  }

  /** Most recent entries, newest first. */
  recent(limit = 50): Array<{
    id: number;
    createdAt: number;
    ean: string;
    outcome: string;
    message: string | null;
  }> {
    const rows = this.db
      .prepare(
        'SELECT id, created_at, ean, outcome, message FROM scan_log ORDER BY id DESC LIMIT ?',
      )
      .all(limit) as Array<{
      id: number;
      created_at: number;
      ean: string;
      outcome: string;
      message: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      ean: r.ean,
      outcome: r.outcome,
      message: r.message,
    }));
  }

  /** Enforce the retention policy. Returns the number of rows deleted. */
  prune(): number {
    const cutoff = this.now() - this.retention.maxAgeMs;
    const byAge = this.db.prepare('DELETE FROM scan_log WHERE created_at < ?').run(cutoff);
    const byCount = this.db
      .prepare(
        'DELETE FROM scan_log WHERE id NOT IN (SELECT id FROM scan_log ORDER BY id DESC LIMIT ?)',
      )
      .run(this.retention.maxRows);
    return Number(byAge.changes) + Number(byCount.changes);
  }
}
