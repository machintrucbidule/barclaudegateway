/**
 * Bounded operational-log journal (BL-003, DECISION-018).
 *
 * Mirrors {@link ScanLog}: an append-only, bounded table of {@link LogEvent} rows (auth exchanges,
 * per-step scan detail, token refreshes, system events). Retention is "50 000 rows OR 10 years,
 * whichever is most restrictive" (user-chosen at the BATCH-3 development gate); the operational log is
 * far more verbose than the scan log, so the row cap bites first. {@link EventLog.prune} runs on startup
 * and daily.
 *
 * Rows are already secret-free by the time they arrive here — the {@link EventLogger} redacts every
 * event's `message`/`detail` before calling {@link EventLog.append} (contract.md §8).
 */

import type { LogCategory, LogEvent, LogEventInput } from '@barclaudegateway/shared';

import type { Database } from './db.js';
import type { RetentionPolicy } from './scanLog.js';

const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1_000;

export const DEFAULT_EVENT_RETENTION: RetentionPolicy = {
  maxRows: 50_000,
  maxAgeMs: TEN_YEARS_MS,
};

/** Filter for {@link EventLog.query} / {@link EventLog.count}. Omit `category` for "all". */
export interface EventQuery {
  category?: LogCategory;
  page: number;
  pageSize: number;
}

interface EventRow {
  id: number;
  at: number;
  category: string;
  type: string;
  level: string;
  message: string;
  detail: string | null;
}

export class EventLog {
  constructor(
    private readonly db: Database,
    private readonly retention: RetentionPolicy = DEFAULT_EVENT_RETENTION,
    private readonly now: () => number = Date.now,
  ) {}

  /** Persist an event (assigning `id` and, when absent, `at`) and return the stored {@link LogEvent}. */
  append(input: LogEventInput): LogEvent {
    const at = input.at ?? this.now();
    const detail = input.detail === undefined ? null : JSON.stringify(input.detail);
    const result = this.db
      .prepare(
        'INSERT INTO event_log (at, category, type, level, message, detail) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(at, input.category, input.type, input.level, input.message, detail);
    return {
      id: Number(result.lastInsertRowid),
      at,
      category: input.category,
      type: input.type,
      level: input.level,
      message: input.message,
      ...(input.detail === undefined ? {} : { detail: input.detail }),
    };
  }

  /** One page of events, newest first, optionally restricted to a category. */
  query(q: EventQuery): LogEvent[] {
    const offset = Math.max(q.page - 1, 0) * q.pageSize;
    const where = q.category === undefined ? '' : 'WHERE category = ?';
    const params: Array<string | number> =
      q.category === undefined ? [q.pageSize, offset] : [q.category, q.pageSize, offset];
    const rows = this.db
      .prepare(
        `SELECT id, at, category, type, level, message, detail FROM event_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params) as unknown as EventRow[];
    return rows.map((r) => toLogEvent(r));
  }

  /** Total rows matching the category filter (the whole set, not just one page). */
  count(filter: { category?: LogCategory } = {}): number {
    if (filter.category === undefined) {
      const row = this.db.prepare('SELECT COUNT(*) AS n FROM event_log').get() as { n: number };
      return row.n;
    }
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM event_log WHERE category = ?')
      .get(filter.category) as { n: number };
    return row.n;
  }

  /** Enforce the retention policy. Returns the number of rows deleted. */
  prune(): number {
    const cutoff = this.now() - this.retention.maxAgeMs;
    const byAge = this.db.prepare('DELETE FROM event_log WHERE at < ?').run(cutoff);
    const byCount = this.db
      .prepare(
        'DELETE FROM event_log WHERE id NOT IN (SELECT id FROM event_log ORDER BY id DESC LIMIT ?)',
      )
      .run(this.retention.maxRows);
    return Number(byAge.changes) + Number(byCount.changes);
  }
}

function toLogEvent(r: EventRow): LogEvent {
  const event: LogEvent = {
    id: r.id,
    at: r.at,
    category: r.category as LogCategory,
    type: r.type as LogEvent['type'],
    level: r.level as LogEvent['level'],
    message: r.message,
  };
  if (r.detail !== null) {
    event.detail = JSON.parse(r.detail) as Record<string, unknown>;
  }
  return event;
}
