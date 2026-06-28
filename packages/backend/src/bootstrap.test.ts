import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG_KEYS, DEFAULT_APP_CONFIG } from './config/defaults.js';
import type { LogEventInput } from '@barclaudegateway/shared';
import type { Services } from './bootstrap.js';
import { createServices, ensureLocalApiKey } from './bootstrap.js';
import { openDatabase } from './storage/db.js';
import { ConfigStore } from './storage/config.js';

describe('createServices', () => {
  let services: Services;

  afterEach(() => {
    services.auth.stop();
    services.db.close();
  });

  it('wires storage to the auth lifecycle without any network call', () => {
    services = createServices({
      masterKey: randomBytes(32),
      dbPath: ':memory:',
      port: 8090,
      host: '0.0.0.0',
    });

    // Config seeded and read back.
    expect(services.config.clientId).toBe(DEFAULT_APP_CONFIG.clientId);

    // Credentials round-trip through the encrypted store the lifecycle will use.
    services.credentialStore.save({ email: 'u@example.com', password: 'p' });
    expect(services.credentialStore.load()).toEqual({ email: 'u@example.com', password: 'p' });

    // Scan log is usable and bounded.
    services.scanLog.append({ ean: '123', outcome: 'added' });
    expect(services.scanLog.count()).toBe(1);

    // No session yet — login is lazy.
    expect(services.auth.getSession()).toBeNull();
  });

  it('auto-generates a local API key on first boot (BL-008)', () => {
    services = createServices({
      masterKey: randomBytes(32),
      dbPath: ':memory:',
      port: 8090,
      host: '0.0.0.0',
    });

    // The managed key is populated and reflected in the typed config.
    expect(services.config.localApiKey).toBeTruthy();
    expect(services.configStore.get(CONFIG_KEYS.localApiKey)).toBe(services.config.localApiKey);

    // It surfaced exactly once in the operational logs, carrying the key for retrieval.
    const generated = services.eventLog
      .query({ page: 1, pageSize: 50 })
      .filter((e) => e.type === 'local_api_key_generated');
    expect(generated).toHaveLength(1);
    expect(generated[0]?.detail?.localApiKey).toBe(services.config.localApiKey);
  });
});

describe('ensureLocalApiKey', () => {
  it('generates + persists + emits once, then is idempotent', () => {
    const db = openDatabase(':memory:');
    try {
      const configStore = new ConfigStore(db);
      configStore.seedDefaults();
      const emitted: LogEventInput[] = [];
      const emit = (e: LogEventInput): void => {
        emitted.push(e);
      };

      const key = ensureLocalApiKey(configStore, emit);
      expect(key).toBeTruthy();
      expect(configStore.get(CONFIG_KEYS.localApiKey)).toBe(key);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]?.type).toBe('local_api_key_generated');
      expect(emitted[0]?.category).toBe('other');

      // Second call: the existing key is returned untouched and nothing new is emitted.
      const again = ensureLocalApiKey(configStore, emit);
      expect(again).toBe(key);
      expect(emitted).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
