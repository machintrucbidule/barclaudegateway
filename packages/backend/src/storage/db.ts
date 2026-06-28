/**
 * SQLite storage via Node's built-in `node:sqlite` (DECISION-003, design gate).
 *
 * Single file on a Docker volume in production, `:memory:` in tests. Tables:
 *  - `config`           — static Chronodrive API params (seeded from code, editable in Phase 4);
 *  - `credentials`      — the AES-256-GCM encrypted email/password (single row);
 *  - `scan_log`         — bounded scan journal (retention enforced in scanLog.ts);
 *  - `event_log`        — bounded operational-log journal (BL-003, retention enforced in eventLog.ts);
 *  - `tracked_products` — products under price tracking + their thresholds (BL-012);
 *  - `price_history`    — bounded price-point history per tracked product (BL-012).
 *
 * `node:sqlite` is experimental in Node 24; it emits an ExperimentalWarning at runtime, which is
 * expected and accepted.
 */

import { DatabaseSync } from 'node:sqlite';

export type Database = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credentials (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  iv         BLOB NOT NULL,
  auth_tag   BLOB NOT NULL,
  ciphertext BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  ean        TEXT NOT NULL,
  outcome    TEXT NOT NULL,
  message    TEXT
);

CREATE INDEX IF NOT EXISTS idx_scan_log_created_at ON scan_log (created_at);

CREATE TABLE IF NOT EXISTS event_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       INTEGER NOT NULL,
  category TEXT NOT NULL,
  type     TEXT NOT NULL,
  level    TEXT NOT NULL,
  message  TEXT NOT NULL,
  detail   TEXT
);

CREATE INDEX IF NOT EXISTS idx_event_log_at ON event_log (at);
CREATE INDEX IF NOT EXISTS idx_event_log_category ON event_log (category, id);

CREATE TABLE IF NOT EXISTS tracked_products (
  product_id      TEXT PRIMARY KEY,
  ean             TEXT,
  label           TEXT,
  threshold       REAL NOT NULL,
  created_at      INTEGER NOT NULL,
  last_price      REAL,
  last_checked_at INTEGER,
  alert_armed     INTEGER NOT NULL DEFAULT 1,
  last_alert_at   INTEGER
);

CREATE TABLE IF NOT EXISTS price_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  price      REAL NOT NULL,
  at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history (product_id, at);
`;

/** Open (or create) the database file and apply the schema migrations. */
export function openDatabase(path: string): Database {
  const db = new DatabaseSync(path);
  // WAL improves concurrent read/write durability on the real file; ignored for :memory:.
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}
