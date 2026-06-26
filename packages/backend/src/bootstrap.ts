/**
 * Application composition root.
 *
 * Wires the storage layer to the auth lifecycle: opens the database, seeds the static config, builds
 * the credential store and scan log, and constructs a {@link TokenLifecycle} whose credentials come
 * from the encrypted store (so a full re-login uses the stored email/password). No network call is
 * made here — login happens lazily on the first `auth.getAccessToken()`.
 */

import type { AuthConfig } from './auth/login.js';
import { TokenLifecycle } from './auth/lifecycle.js';
import { ChronodriveClient } from './chronodrive/client.js';
import type { AppConfig } from './config/defaults.js';
import type { EnvConfig } from './config/env.js';
import { HttpClient } from './http/client.js';
import type { Database } from './storage/db.js';
import { openDatabase } from './storage/db.js';
import { ConfigStore } from './storage/config.js';
import { createCredentialsLoader, CredentialStore } from './storage/credentials.js';
import { ScanLog } from './storage/scanLog.js';

export interface Services {
  db: Database;
  config: AppConfig;
  configStore: ConfigStore;
  credentialStore: CredentialStore;
  scanLog: ScanLog;
  http: HttpClient;
  auth: TokenLifecycle;
  chronodrive: ChronodriveClient;
}

export interface CreateServicesOptions {
  /** Override the HTTP client (e.g. with tuned retry/timeout). */
  http?: HttpClient;
}

export function createServices(env: EnvConfig, options: CreateServicesOptions = {}): Services {
  const db = openDatabase(env.dbPath);
  const configStore = new ConfigStore(db);
  configStore.seedDefaults();
  const config = configStore.readAppConfig();

  const credentialStore = new CredentialStore(db, env.masterKey);
  const scanLog = new ScanLog(db);
  const http = options.http ?? new HttpClient();

  const authConfig: AuthConfig = {
    identityBaseUrl: config.identityBaseUrl,
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    scope: config.scope,
  };
  const auth = new TokenLifecycle({
    http,
    config: authConfig,
    loadCredentials: createCredentialsLoader(credentialStore),
  });

  const chronodrive = new ChronodriveClient({
    http,
    config,
    getToken: () => auth.getAccessToken(),
    // A non-empty override pins the store and skips the dynamic `lastVisitedSite.id` lookup (Phase 4).
    ...(config.siteId ? { siteId: config.siteId } : {}),
  });

  return { db, config, configStore, credentialStore, scanLog, http, auth, chronodrive };
}
