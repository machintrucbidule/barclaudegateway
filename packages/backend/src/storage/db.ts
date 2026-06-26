/**
 * SQLite storage via Node's built-in `node:sqlite` (DECISION-003, design gate).
 *
 * Single file on a Docker volume in production, `:memory:` in tests. Three tables:
 *  - `config`      — static Chronodrive API params (seeded from code, editable in Phase 4);
 *  - `credentials` — the AES-256-GCM encrypted email/password (single row);
 *  - `scan_log`    — bounded scan journal (retention enforced in scanLog.ts).
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
