import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_CONFIG } from './config/defaults.js';
import type { Services } from './bootstrap.js';
import { createServices } from './bootstrap.js';

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
});
