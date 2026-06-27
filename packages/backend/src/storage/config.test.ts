import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG_KEYS, DEFAULT_APP_CONFIG } from '../config/defaults.js';
import type { Database } from './db.js';
import { openDatabase } from './db.js';
import { ConfigStore } from './config.js';

describe('ConfigStore', () => {
  let db: Database;
  let store: ConfigStore;

  beforeEach(() => {
    db = openDatabase(':memory:');
    store = new ConfigStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('seeds the default static config and reads it back typed', () => {
    store.seedDefaults();
    const config = store.readAppConfig();
    expect(config.clientId).toBe(DEFAULT_APP_CONFIG.clientId);
    expect(config.apiKeys.search).toBe(DEFAULT_APP_CONFIG.apiKeys.search);
    expect(config.identityBaseUrl).toBe('https://connect.chronodrive.com');
    expect(config.siteMode).toBe('DRIVE');
  });

  it('does not overwrite existing values on re-seed (Phase 4 edits survive)', () => {
    store.seedDefaults();
    store.set(CONFIG_KEYS.apiKeySearch, 'rotated-key');
    store.seedDefaults(); // simulate a restart
    expect(store.get(CONFIG_KEYS.apiKeySearch)).toBe('rotated-key');
  });

  it('upserts a single value', () => {
    store.set(CONFIG_KEYS.siteMode, 'DRIVE');
    expect(store.get(CONFIG_KEYS.siteMode)).toBe('DRIVE');
    store.set(CONFIG_KEYS.siteMode, 'PICKUP');
    expect(store.get(CONFIG_KEYS.siteMode)).toBe('PICKUP');
  });

  it('throws when reading an incomplete config', () => {
    store.set(CONFIG_KEYS.clientId, 'only-this');
    expect(() => store.readAppConfig()).toThrow(/Missing config key/);
  });

  it('round-trips the Home Assistant webhook URL, defaulting to empty', () => {
    store.seedDefaults();
    expect(store.readAppConfig().haWebhookUrl).toBe('');
    store.set(CONFIG_KEYS.haWebhookUrl, 'https://ha.local/api/webhook/abc');
    expect(store.readAppConfig().haWebhookUrl).toBe('https://ha.local/api/webhook/abc');
  });

  it('seeds a fresh database to lazy auth mode (BL-006)', () => {
    store.seedDefaults();
    expect(store.get(CONFIG_KEYS.authMode)).toBe('lazy');
    expect(store.readAppConfig().authMode).toBe('lazy');
  });

  it('does not seed auth_mode into an upgraded database, resolving it to keepalive (BL-006)', () => {
    // Simulate a pre-BL-006 database: seed every key EXCEPT auth_mode, so the table is non-empty.
    for (const [key, value] of Object.entries({
      [CONFIG_KEYS.clientId]: 'C',
      [CONFIG_KEYS.redirectUri]: 'https://r',
      [CONFIG_KEYS.scope]: 'openid',
      [CONFIG_KEYS.identityBaseUrl]: 'https://id',
      [CONFIG_KEYS.apiBaseUrl]: 'https://api',
      [CONFIG_KEYS.apiKeySearch]: 'S',
      [CONFIG_KEYS.apiKeyCustomerCartRead]: 'C',
      [CONFIG_KEYS.apiKeyCartWrite]: 'W',
      [CONFIG_KEYS.apiKeyShoppingLists]: 'L',
      [CONFIG_KEYS.siteMode]: 'DRIVE',
      [CONFIG_KEYS.siteId]: '',
      [CONFIG_KEYS.haWebhookUrl]: '',
    })) {
      store.set(key, value);
    }
    store.seedDefaults(); // simulate the upgrade boot
    // The seed must NOT have inserted auth_mode (which would flip prod to lazy)…
    expect(store.get(CONFIG_KEYS.authMode)).toBeUndefined();
    // …and the missing key resolves to keep-alive (today's behaviour).
    expect(store.readAppConfig().authMode).toBe('keepalive');
  });

  it('round-trips auth_mode and coerces an invalid value to keepalive (BL-006)', () => {
    store.seedDefaults();
    store.set(CONFIG_KEYS.authMode, 'keepalive');
    expect(store.readAppConfig().authMode).toBe('keepalive');
    store.set(CONFIG_KEYS.authMode, 'lazy');
    expect(store.readAppConfig().authMode).toBe('lazy');
    store.set(CONFIG_KEYS.authMode, 'bogus');
    expect(store.readAppConfig().authMode).toBe('keepalive');
  });

  it('treats a pre-Phase-5 database (no ha_webhook_url row) as an empty URL', () => {
    // Seed every key except the new one, mimicking a database created before Phase 5.
    for (const [key, value] of Object.entries({
      [CONFIG_KEYS.clientId]: 'C',
      [CONFIG_KEYS.redirectUri]: 'https://r',
      [CONFIG_KEYS.scope]: 'openid',
      [CONFIG_KEYS.identityBaseUrl]: 'https://id',
      [CONFIG_KEYS.apiBaseUrl]: 'https://api',
      [CONFIG_KEYS.apiKeySearch]: 'S',
      [CONFIG_KEYS.apiKeyCustomerCartRead]: 'C',
      [CONFIG_KEYS.apiKeyCartWrite]: 'W',
      [CONFIG_KEYS.apiKeyShoppingLists]: 'L',
      [CONFIG_KEYS.siteMode]: 'DRIVE',
      [CONFIG_KEYS.siteId]: '',
    })) {
      store.set(key, value);
    }
    expect(store.readAppConfig().haWebhookUrl).toBe('');
  });
});
