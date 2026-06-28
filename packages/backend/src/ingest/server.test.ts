import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import type { Dispatcher } from 'undici';
import type { FastifyInstance } from 'fastify';
import type { Product } from '@barclaudegateway/shared';
import type { AppConfig } from '../config/defaults.js';
import { CONFIG_KEYS } from '../config/defaults.js';
import { HttpClient } from '../http/client.js';
import { ChronodriveClient } from '../chronodrive/client.js';
import { TokenLifecycle } from '../auth/lifecycle.js';
import type { Database } from '../storage/db.js';
import { openDatabase } from '../storage/db.js';
import { ConfigStore } from '../storage/config.js';
import { CredentialStore } from '../storage/credentials.js';
import { DestinationsStore } from '../storage/destinations.js';
import { ScanLog } from '../storage/scanLog.js';
import { EventLog } from '../storage/eventLog.js';
import { IngestPipeline } from './pipeline.js';
import { ScanEventBus } from './scanEvents.js';
import { EventLogBus } from '../logging/eventLogBus.js';
import { EventLogger } from '../logging/eventLogger.js';
import { buildServer } from './server.js';
import { ErrorMonitor } from '../health/errorMonitor.js';
import { HaWebhookNotifier } from '../health/haWebhook.js';
import { PriceTrackingStore } from '../storage/priceTracking.js';
import { PriceScheduler } from '../price/priceScheduler.js';

const API_ORIGIN = 'https://api.test.local';
const EAN = '3183280000933';

const CONFIG: AppConfig = {
  clientId: 'C',
  redirectUri: 'https://www.test.local',
  scope: 'openid',
  identityBaseUrl: 'https://connect.test.local',
  apiBaseUrl: 'https://api.test.local/v1',
  apiKeys: {
    search: 'SK',
    products: 'PK',
    customerCartRead: 'CCR',
    cartWrite: 'CW',
    shoppingLists: 'SL',
  },
  siteMode: 'DRIVE',
  siteId: '',
  haWebhookUrl: '',
  authMode: 'keepalive',
  priceTrackingEnabled: false,
  priceTrackingIntervalHours: 12,
};

const pathIs =
  (full: string) =>
  (p: string): boolean =>
    p.split('?')[0] === full;

const product: Product = {
  id: '2555',
  labels: { productLabel: 'Gros sel de mer', brandLabel: 'LA BALEINE' },
  eans: [EAN],
  prices: { defaultPrice: 0.79 },
  stock: 'HIGH_STOCK',
  isEligible: true,
};

function quietClient(): HttpClient {
  return new HttpClient({
    sleep: async () => {},
    random: () => 0,
    retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
  });
}

describe('ingest server (fastify.inject)', () => {
  let mockAgent: MockAgent;
  let original: Dispatcher;
  let pool: ReturnType<MockAgent['get']>;
  let db: Database;
  let app: FastifyInstance;
  let credentialStore: CredentialStore;
  let eventLog: EventLog;

  beforeEach(() => {
    original = getGlobalDispatcher();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
    pool = mockAgent.get(API_ORIGIN);

    db = openDatabase(':memory:');
    const configStore = new ConfigStore(db);
    configStore.seedDefaults();
    // These tests predate BL-006 and assert the connect-on-read /health behaviour → pin keep-alive
    // (a fresh DB would otherwise seed `lazy` and gate /health into the idle state).
    configStore.set(CONFIG_KEYS.authMode, 'keepalive');
    const destinations = new DestinationsStore(configStore);
    destinations.write({ cart: true, lists: [] });
    const scanLog = new ScanLog(db);
    eventLog = new EventLog(db);
    const eventBus = new EventLogBus();
    const emit = new EventLogger(eventLog, eventBus).emit;
    credentialStore = new CredentialStore(db, Buffer.alloc(32));
    // Configured by default so /health runs the real checks; the not-configured case is tested below.
    credentialStore.save({ email: 'tester@example.com', password: 'pw' });
    const events = new ScanEventBus();
    const chronodrive = new ChronodriveClient({
      http: quietClient(),
      config: CONFIG,
      getToken: async () => 'TOKEN',
      siteId: '1016',
    });
    const auth = new TokenLifecycle({
      http: quietClient(),
      config: {
        identityBaseUrl: CONFIG.identityBaseUrl,
        clientId: CONFIG.clientId,
        redirectUri: CONFIG.redirectUri,
        scope: CONFIG.scope,
      },
      loadCredentials: async () => ({ email: 'e', password: 'p' }),
    });
    const pipeline = new IngestPipeline({ chronodrive, scanLog, destinations, events, emit });
    const errorMonitor = new ErrorMonitor();
    const haWebhook = new HaWebhookNotifier({
      getUrl: () => configStore.readAppConfig().haWebhookUrl,
    });
    const priceTracking = new PriceTrackingStore(db);
    const priceScheduler = new PriceScheduler({
      chronodrive,
      store: priceTracking,
      notifier: haWebhook,
      configStore,
      emit,
    });
    app = buildServer({
      pipeline,
      chronodrive,
      auth,
      configStore,
      destinations,
      credentialStore,
      scanLog,
      events,
      eventLog,
      eventBus,
      emit,
      errorMonitor,
      haWebhook,
      priceTracking,
      priceScheduler,
    });
  });

  afterEach(async () => {
    await app.close();
    db.close();
    await mockAgent.close();
    setGlobalDispatcher(original);
  });

  it('POST /v1/scan with a valid EAN → 200 and a ScanResponse', async () => {
    pool
      .intercept({ path: pathIs('/v1/search-suggestions'), method: 'GET' })
      .reply(200, { products: [product] });
    pool
      .intercept({ path: pathIs('/v1/customers/me/carts'), method: 'GET' })
      .reply(200, { content: [{ id: 'CART-1', items: [], isOrdered: false }] });
    pool
      .intercept({ path: pathIs('/v1/carts/CART-1/items'), method: 'POST' })
      .reply(200, { content: [{ productId: '2555', quantity: 1, returnType: 'SUCCESS' }] });

    const res = await app.inject({ method: 'POST', url: '/v1/scan', payload: { ean: EAN } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'added', ean: EAN, product: { id: '2555' } });

    // BL-003: the scan produced an ordered set of operational-log lines (not just the final outcome).
    const scanEvents = eventLog
      .query({ category: 'scan', page: 1, pageSize: 50 })
      .reverse() // query is newest-first; reverse to assert chronological order
      .map((e) => e.type);
    expect(scanEvents).toEqual([
      'ean_read',
      'search_request',
      'product_resolved',
      'cart_write',
      'scan_complete',
    ]);
  });

  it('POST /v1/scan with an invalid EAN → 400 invalid_ean, Chronodrive untouched', async () => {
    // No interceptors registered: if the pipeline called Chronodrive the test would error.
    const res = await app.inject({ method: 'POST', url: '/v1/scan', payload: { ean: '123' } });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ status: 'invalid_ean', ean: '123' });
  });

  it('POST /v1/scan with malformed JSON → 400 invalid_ean', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/scan',
      headers: { 'content-type': 'application/json' },
      payload: '{ not valid json',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ status: 'invalid_ean' });
  });

  it('POST /v1/scan when Chronodrive fails → 502 error with category', async () => {
    pool.intercept({ path: pathIs('/v1/search-suggestions'), method: 'GET' }).reply(500, {});

    const res = await app.inject({ method: 'POST', url: '/v1/scan', payload: { ean: EAN } });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ status: 'error', category: 'server' });
  });

  it('GET /health → 200 when every read-only check passes', async () => {
    pool
      .intercept({ path: pathIs('/v1/search-suggestions'), method: 'GET' })
      .reply(200, { products: [product] });
    pool
      .intercept({ path: pathIs('/v1/customers/me/carts'), method: 'GET' })
      .reply(200, { content: [{ id: 'CART-1', items: [], isOrdered: false }] });
    pool
      .intercept({ path: pathIs('/v1/shopping-lists'), method: 'GET' })
      .reply(200, { content: [], page: {} });

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it('GET /health → 200 with configured:false and no checks when not configured', async () => {
    // No interceptors: if the self-test tried to connect, disableNetConnect would fail the test.
    credentialStore.clear();
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false, configured: false, checks: [] });
  });

  it('GET /livez → 200 without touching Chronodrive', async () => {
    // No interceptors registered: if /livez called Chronodrive, disableNetConnect would error.
    const res = await app.inject({ method: 'GET', url: '/livez' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
