/**
 * Application composition root.
 *
 * Wires the storage layer to the auth lifecycle: opens the database, seeds the static config, builds
 * the credential store and scan log, and constructs a {@link TokenLifecycle} whose credentials come
 * from the encrypted store (so a full re-login uses the stored email/password). No network call is
 * made here — login happens lazily on the first `auth.getAccessToken()`.
 */

import { randomBytes } from 'node:crypto';
import type { AuthConfig } from './auth/login.js';
import { TokenLifecycle } from './auth/lifecycle.js';
import { ChronodriveClient } from './chronodrive/client.js';
import type { AppConfig } from './config/defaults.js';
import { CONFIG_KEYS } from './config/defaults.js';
import type { EnvConfig } from './config/env.js';
import { HttpClient } from './http/client.js';
import type { Database } from './storage/db.js';
import { openDatabase } from './storage/db.js';
import { ConfigStore } from './storage/config.js';
import { createCredentialsLoader, CredentialStore } from './storage/credentials.js';
import { ScanLog } from './storage/scanLog.js';
import { EventLog } from './storage/eventLog.js';
import { EventLogBus } from './logging/eventLogBus.js';
import { EventLogger } from './logging/eventLogger.js';
import type { EmitEvent } from './logging/eventLogger.js';

export interface Services {
  db: Database;
  config: AppConfig;
  configStore: ConfigStore;
  credentialStore: CredentialStore;
  scanLog: ScanLog;
  /** BL-003: the bounded operational-log journal (auth/scan/system events). */
  eventLog: EventLog;
  /** BL-003: the live operational-log bus the `/api/events/stream` SSE route subscribes to. */
  eventBus: EventLogBus;
  /** BL-003: the single emit point — redact → persist → publish a {@link LogEvent}. */
  emit: EmitEvent;
  http: HttpClient;
  auth: TokenLifecycle;
  chronodrive: ChronodriveClient;
}

export interface CreateServicesOptions {
  /** Override the HTTP client (e.g. with tuned retry/timeout). */
  http?: HttpClient;
}

/**
 * Ensure the local "Layer B" API has a key (BL-008/DECISION-023). The key is **app-managed**: when it is
 * empty (a fresh install, or an upgraded DB that predates BL-008) the backend generates one, persists it
 * directly to the `config` table (never via the user-facing config writer), and surfaces it **once** — a
 * `local_api_key_generated` operational-log event plus a console line — so it can be copied into a
 * client's `X-API-Key` header. The key is intentionally NOT redacted (that is its retrieval channel).
 * Idempotent: a present key is returned untouched and nothing is logged.
 */
export function ensureLocalApiKey(configStore: ConfigStore, emit: EmitEvent): string {
  const existing = configStore.get(CONFIG_KEYS.localApiKey);
  if (existing !== undefined && existing.length > 0) return existing;

  const key = randomBytes(24).toString('base64url');
  configStore.set(CONFIG_KEYS.localApiKey, key);
  emit({
    category: 'other',
    type: 'local_api_key_generated',
    level: 'warn',
    message: 'Local API key generated — set it as the X-API-Key header on your local-API clients.',
    detail: { localApiKey: key },
  });
  // Also print once to stdout so it is grabbable from the container logs (Portainer).
  console.log(`[BarclaudeGateway] Local API key generated. X-API-Key: ${key}`);
  return key;
}

export function createServices(env: EnvConfig, options: CreateServicesOptions = {}): Services {
  const db = openDatabase(env.dbPath);
  const configStore = new ConfigStore(db);
  configStore.seedDefaults();

  const credentialStore = new CredentialStore(db, env.masterKey);
  const scanLog = new ScanLog(db);
  const eventLog = new EventLog(db);
  const eventBus = new EventLogBus();
  const eventLogger = new EventLogger(eventLog, eventBus);
  const emit = eventLogger.emit;
  const http = options.http ?? new HttpClient();

  // BL-008: generate the local-API key on first boot (needs `emit`, hence after the logger is built),
  // then read the typed config so `config.localApiKey` reflects the freshly persisted value.
  ensureLocalApiKey(configStore, emit);
  const config = configStore.readAppConfig();

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
    emit,
    // BL-006: only keep-alive arms the background refresh timer; lazy refreshes purely on demand.
    keepAlive: config.authMode === 'keepalive',
  });

  const chronodrive = new ChronodriveClient({
    http,
    config,
    getToken: () => auth.getAccessToken(),
    // A non-empty override pins the store and skips the dynamic `lastVisitedSite.id` lookup (Phase 4).
    ...(config.siteId ? { siteId: config.siteId } : {}),
  });

  return {
    db,
    config,
    configStore,
    credentialStore,
    scanLog,
    eventLog,
    eventBus,
    emit,
    http,
    auth,
    chronodrive,
  };
}
