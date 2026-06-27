/**
 * Process environment → typed runtime config.
 *
 * Per the design gate, the only secret carried by the environment is the AES master key
 * (`BCG_MASTER_KEY`); everything else (Chronodrive client_id, x-api-keys, base URLs) lives in the
 * SQLite `config` table. The key is never written to disk. Absence is a hard, clear failure — there
 * is no silent fallback, because without it the stored credentials cannot be decrypted (§8).
 *
 * First-run assist (BL-002, refines DECISION-008): when the key is absent, `loadEnv` throws a
 * {@link MissingMasterKeyError}; the entry point then prints a freshly generated candidate key with
 * copy-and-restart instructions ({@link formatFirstRunKeyHelp}) and exits non-zero. The key is still
 * env-injected and never written to `/data` or the DB — the print is a one-time convenience.
 */

import { randomBytes } from 'node:crypto';

/**
 * Thrown by {@link loadEnv} when `BCG_MASTER_KEY` is absent or blank. Distinct from a generic startup
 * failure so the entry point can offer the first-run assist (generate + print a candidate key) instead
 * of a bare stack trace.
 */
export class MissingMasterKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingMasterKeyError';
  }
}

export interface EnvConfig {
  /** 32-byte AES-256 key. */
  masterKey: Buffer;
  /** Path to the SQLite file. */
  dbPath: string;
  /** TCP port the ingestion HTTP server listens on (Phase 3). */
  port: number;
  /** Bind address; defaults to all interfaces so the ESP32 on the LAN can reach it. */
  host: string;
}

// 8090, not the conventional 8080: that port is commonly taken on the target homelab host.
const DEFAULT_PORT = 8090;
const DEFAULT_HOST = '0.0.0.0';

/** Parse a port from the environment, falling back to the default and rejecting nonsense. */
export function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`BCG_PORT must be an integer in 1..65535 (got "${raw}")`);
  }
  return port;
}

const HEX_64 = /^[0-9a-fA-F]{64}$/;

/** Decode a master key supplied as 64 hex chars or base64; must yield exactly 32 bytes. */
export function parseMasterKey(raw: string): Buffer {
  const key = HEX_64.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      'BCG_MASTER_KEY must decode to 32 bytes (64 hex chars or base64 of 32 bytes). ' +
        `Got ${key.length} bytes. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  return key;
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  const raw = env.BCG_MASTER_KEY;
  if (!raw || raw.trim() === '') {
    throw new MissingMasterKeyError(
      'BCG_MASTER_KEY is required (32-byte AES key, hex or base64). It is never written to disk.',
    );
  }
  return {
    masterKey: parseMasterKey(raw.trim()),
    dbPath: env.BCG_DB_PATH?.trim() || './data/barclaudegateway.sqlite',
    port: parsePort(env.BCG_PORT),
    host: env.BCG_HOST?.trim() || DEFAULT_HOST,
  };
}

/** Convenience for docs/ops: a fresh hex master key. */
export function generateMasterKeyHex(): string {
  return randomBytes(32).toString('hex');
}

/**
 * First-run assist (BL-002): a copy-and-restart message embedding a freshly generated candidate key.
 * Pure — it only formats a string (no filesystem or DB access), so the printed key is never persisted;
 * the operator must still set it in the environment for the app to start (DECISION-008 preserved).
 */
export function formatFirstRunKeyHelp(key: string = generateMasterKeyHex()): string {
  return [
    'BCG_MASTER_KEY is not set — the app cannot start without it.',
    '',
    'Here is a freshly generated 32-byte key you can use:',
    '',
    `    BCG_MASTER_KEY=${key}`,
    '',
    'Next steps:',
    '  1. Copy the value above into the BCG_MASTER_KEY environment variable',
    '     (Portainer stack env, your compose .env, or the container env).',
    '  2. Restart the container / app.',
    '',
    'Important: this key is NOT written to disk or the database — keep it somewhere safe.',
    'It decrypts your stored Chronodrive credentials; lose it and they become unreadable.',
    'You may also generate your own with:  openssl rand -hex 32',
  ].join('\n');
}
