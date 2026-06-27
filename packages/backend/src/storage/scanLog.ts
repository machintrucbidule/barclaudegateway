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

export interface ScanRow {
  id: number;
  createdAt: number;
  ean: string;
  outcome: string;
  message: string | null;
}

/**
 * Filter for the searchable, paginated scan history (BL-004). `status` matches the `outcome` column;
 * `search` matches the EAN or the message (substring). A `pageSize` of `null` returns all matching rows
 * on a single page (the "all" page-size option, still bounded by retention).
 */
export interface ScanQuery {
  status?: string;
  search?: string;
  page: number;
  pageSize: number | null;
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

  /** One page of the history (newest first) matching the status/search filter (BL-004). */
  query(q: ScanQuery): ScanRow[] {
    const { clause, params } = buildFilter(q.status, q.search);
    const sql = `SELECT id, created_at, ean, outcome, message FROM scan_log ${clause} ORDER BY id DESC`;
    let rows: ScanRow[];
    if (q.pageSize === null) {
      rows = this.db.prepare(sql).all(...params) as unknown as ScanRow[];
    } else {
      const offset = Math.max(q.page - 1, 0) * q.pageSize;
      rows = this.db
        .prepare(`${sql} LIMIT ? OFFSET ?`)
        .all(...params, q.pageSize, offset) as unknown as ScanRow[];
    }
    return (rows as unknown as Array<Omit<ScanRow, 'createdAt'> & { created_at: number }>).map(
      (r) => ({
        id: r.id,
        createdAt: r.created_at,
        ean: r.ean,
        outcome: r.outcome,
        message: r.message,
      }),
    );
  }

  /** Total rows matching the status/search filter (the whole set, not just one page). */
  countMatching(filter: { status?: string; search?: string } = {}): number {
    const { clause, params } = buildFilter(filter.status, filter.search);
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM scan_log ${clause}`).get(...params) as {
      n: number;
    };
    return row.n;
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

/** Build the shared WHERE clause + bound params for the status/search filter (BL-004). */
function buildFilter(
  status: string | undefined,
  search: string | undefined,
): { clause: string; params: Array<string | number> } {
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (status !== undefined && status !== '') {
    conditions.push('outcome = ?');
    params.push(status);
  }
  if (search !== undefined && search !== '') {
    // ESCAPE '\' so literal % / _ in the search term match themselves rather than acting as wildcards.
    conditions.push("(ean LIKE ? ESCAPE '\\' OR message LIKE ? ESCAPE '\\')");
    const like = `%${escapeLike(search)}%`;
    params.push(like, like);
  }
  const clause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { clause, params };
}

/** Escape LIKE wildcards in user input so a literal `%`/`_` matches itself. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
