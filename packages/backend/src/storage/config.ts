/**
 * Read/write access to the `config` table (static Chronodrive API params).
 *
 * On first run, {@link ConfigStore.seedDefaults} inserts the known-good values from
 * `config/defaults.ts`; existing rows are never overwritten (INSERT OR IGNORE), so Phase 4 edits
 * survive restarts.
 */

import type { AppConfig } from '../config/defaults.js';
import { appConfigFromMap, appConfigToEntries, DEFAULT_APP_CONFIG } from '../config/defaults.js';
import type { Database } from './db.js';

export class ConfigStore {
  constructor(private readonly db: Database) {}

  get(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM config WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  /** Upsert a single config value. */
  set(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  /** Insert the default values without overwriting any existing row. Idempotent. */
  seedDefaults(config: AppConfig = DEFAULT_APP_CONFIG): void {
    const stmt = this.db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
    for (const [key, value] of appConfigToEntries(config)) {
      stmt.run(key, value);
    }
  }

  /** Build the typed {@link AppConfig} from the table, throwing if a required key is missing. */
  readAppConfig(): AppConfig {
    const rows = this.db.prepare('SELECT key, value FROM config').all() as Array<{
      key: string;
      value: string;
    }>;
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return appConfigFromMap(map);
  }
}
