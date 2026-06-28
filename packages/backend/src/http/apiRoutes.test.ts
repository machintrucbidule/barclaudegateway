import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getGlobalDispatcher, MockAgent, request, setGlobalDispatcher } from 'undici';
import type { Dispatcher } from 'undici';
import type { FastifyInstance } from 'fastify';
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
import { IngestPipeline } from '../ingest/pipeline.js';
import { ScanEventBus } from '../ingest/scanEvents.js';
import { EventLogBus } from '../logging/eventLogBus.js';
import { EventLogger } from '../logging/eventLogger.js';
import { buildServer } from '../ingest/server.js';
import { ErrorMonitor } from '../health/errorMonitor.js';
import { HaWebhookNotifier } from '../health/haWebhook.js';
import { PriceTrackingStore } from '../storage/priceTracking.js';
import { PriceScheduler } from '../price/priceScheduler.js';

const API_ORIGIN = 'https://api.test.local';
const SECRET_PASSWORD = 'sup3r-s3cret-pw';

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
  siteId: '1016',
  haWebhookUrl: '',
  authMode: 'keepalive',
  priceTrackingEnabled: false,
  priceTrackingIntervalHours: 12,
};

const pathIs =
  (full: string) =>
  (p: string): boolean =>
    p.split('?')[0] === full;

function quietClient(): HttpClient {
  return new HttpClient({
    sleep: async () => {},
    random: () => 0,
    retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
  });
}

interface Harness {
  app: FastifyInstance;
  db: Database;
  configStore: ConfigStore;
  destinations: DestinationsStore;
  credentialStore: CredentialStore;
  scanLog: ScanLog;
  events: ScanEventBus;
  eventLog: EventLog;
  eventBus: EventLogBus;
  errorMonitor: ErrorMonitor;
  priceTracking: PriceTrackingStore;
}

function buildHarness(): Harness {
  const db = openDatabase(':memory:');
  const configStore = new ConfigStore(db);
  configStore.seedDefaults();
  // Default to keep-alive so the pre-BL-006 health tests keep their connect-on-read behaviour; the
  // lazy-mode tests flip it explicitly via configStore.set.
  configStore.set(CONFIG_KEYS.authMode, 'keepalive');
  const destinations = new DestinationsStore(configStore);
  const scanLog = new ScanLog(db);
  const eventLog = new EventLog(db);
  const eventBus = new EventLogBus();
  const emit = new EventLogger(eventLog, eventBus).emit;
  const credentialStore = new CredentialStore(db, Buffer.alloc(32));
  const events = new ScanEventBus();
  const chronodrive = new ChronodriveClient({
    http: quietClient(),
    config: CONFIG,
    getToken: async () => 'TOKEN',
    siteId: '1016',
  });
  // BL-006: a no-session lifecycle — hasLiveSession() is false unless a test sets one, so the lazy
  // health gate reports idle without forcing a connection.
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
  const app = buildServer({
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
  return {
    app,
    db,
    configStore,
    destinations,
    credentialStore,
    scanLog,
    events,
    eventLog,
    eventBus,
    errorMonitor,
    priceTracking,
  };
}

describe('api routes (fastify.inject)', () => {
  let mockAgent: MockAgent;
  let original: Dispatcher;
  let pool: ReturnType<MockAgent['get']>;
  let h: Harness;

  beforeEach(() => {
    original = getGlobalDispatcher();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
    pool = mockAgent.get(API_ORIGIN);
    h = buildHarness();
  });

  afterEach(async () => {
    await h.app.close();
    h.db.close();
    await mockAgent.close();
    setGlobalDispatcher(original);
  });

  it('GET /api/config returns the static params + credentials flag, never a password', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/config' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.clientId).toBe('DrJyWDmbpV6yYP8ndN8m'); // seeded default
    expect(body.credentials).toEqual({ set: false });
    // The response must never carry a password field, masked or otherwise.
    expect(res.body).not.toContain('password');
  });

  it('PUT /api/credentials is write-only: flips the set flag, never echoes the password', async () => {
    const put = await h.app.inject({
      method: 'PUT',
      url: '/api/credentials',
      payload: { email: 'user@example.com', password: SECRET_PASSWORD },
    });
    expect(put.statusCode).toBe(200);
    expect(put.body).not.toContain(SECRET_PASSWORD);
    expect(put.json()).toEqual({ credentials: { set: true } });

    const get = await h.app.inject({ method: 'GET', url: '/api/config' });
    expect(get.json().credentials).toEqual({ set: true });
    expect(get.body).not.toContain(SECRET_PASSWORD);
  });

  it('PUT /api/credentials rejects a missing field', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/credentials',
      payload: { email: 'user@example.com' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT /api/config persists static params (incl. site_id) and reads them back', async () => {
    const next = { ...CONFIG, siteId: '9999', apiKeys: { ...CONFIG.apiKeys, search: 'rotated' } };
    const put = await h.app.inject({ method: 'PUT', url: '/api/config', payload: next });
    expect(put.statusCode).toBe(200);
    expect(put.json().siteId).toBe('9999');

    const get = await h.app.inject({ method: 'GET', url: '/api/config' });
    expect(get.json()).toMatchObject({ siteId: '9999', apiKeys: { search: 'rotated' } });
  });

  it('PUT /api/config rejects an invalid URL', async () => {
    const bad = { ...CONFIG, apiBaseUrl: 'not-a-url' };
    const res = await h.app.inject({ method: 'PUT', url: '/api/config', payload: bad });
    expect(res.statusCode).toBe(400);
  });

  it('PUT /api/config round-trips the Home Assistant webhook URL (set then clear)', async () => {
    const withUrl = { ...CONFIG, haWebhookUrl: 'https://ha.test.local/api/webhook/abc' };
    const put = await h.app.inject({ method: 'PUT', url: '/api/config', payload: withUrl });
    expect(put.statusCode).toBe(200);
    expect(put.json().haWebhookUrl).toBe('https://ha.test.local/api/webhook/abc');

    const cleared = { ...CONFIG, haWebhookUrl: '' };
    const put2 = await h.app.inject({ method: 'PUT', url: '/api/config', payload: cleared });
    expect(put2.json().haWebhookUrl).toBe('');
  });

  it('PUT /api/config rejects a non-URL Home Assistant webhook', async () => {
    const bad = { ...CONFIG, haWebhookUrl: 'not-a-url' };
    const res = await h.app.inject({ method: 'PUT', url: '/api/config', payload: bad });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/error-state is inactive by default and turns active after a critical scan', async () => {
    const before = await h.app.inject({ method: 'GET', url: '/api/error-state' });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toEqual({ active: false });

    h.errorMonitor.ingestScan({
      at: 1,
      response: { status: 'error', ean: '999', category: 'auth', message: 'auth failed' },
    });

    const after = await h.app.inject({ method: 'GET', url: '/api/error-state' });
    expect(after.json()).toMatchObject({
      active: true,
      error: { category: 'auth', message: 'auth failed' },
    });
  });

  it('POST /api/notify/test is a no-op (ok:false) when no webhook URL is configured', async () => {
    const res = await h.app.inject({ method: 'POST', url: '/api/notify/test' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(false);
  });

  it('POST /api/notify/test posts a sample alert to the configured webhook', async () => {
    const haPool = mockAgent.get('https://ha.test.local');
    haPool.intercept({ path: '/api/webhook/abc', method: 'POST' }).reply(200, {});
    await h.app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: { ...CONFIG, haWebhookUrl: 'https://ha.test.local/api/webhook/abc' },
    });

    const res = await h.app.inject({ method: 'POST', url: '/api/notify/test' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it('PUT /api/config/destinations round-trips through enabled_destinations', async () => {
    const payload = { cart: true, lists: [{ id: 'L1', name: 'Classiques' }] };
    const put = await h.app.inject({
      method: 'PUT',
      url: '/api/config/destinations',
      payload,
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual(payload);
    // The store (canonical source) reflects the write.
    expect(h.destinations.read()).toEqual(payload);
  });

  it('GET /api/config/destinations merges the saved set with the live list choices', async () => {
    h.destinations.write({ cart: true, lists: [] });
    pool.intercept({ path: pathIs('/v1/shopping-lists'), method: 'GET' }).reply(200, {
      content: [
        {
          id: 'L1',
          name: 'Classiques',
          nbItems: 3,
          hasAvailableProduct: true,
          createdAt: '',
          updatedAt: '',
        },
      ],
      page: {},
    });

    const res = await h.app.inject({ method: 'GET', url: '/api/config/destinations' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toEqual({ cart: true, lists: [] });
    expect(body.available.cart).toEqual({ name: 'Panier' });
    expect(body.available.lists).toHaveLength(1);
    expect(body.available.lists[0].name).toBe('Classiques');
    // Keep-alive (default harness) auto-fetches as today: never idle (BL-007).
    expect(body.listsIdle).toBeUndefined();
  });

  it('GET /api/config/destinations is idle (no fetch) in lazy mode with no live session (BL-007)', async () => {
    h.credentialStore.save({ email: 'user@example.com', password: SECRET_PASSWORD });
    h.destinations.write({ cart: true, lists: [{ id: 'L1', name: 'Classiques' }] });
    h.configStore.set(CONFIG_KEYS.authMode, 'lazy');
    // No interceptors registered: a live fetch would fail (disableNetConnect) → it must not be attempted.
    const res = await h.app.inject({ method: 'GET', url: '/api/config/destinations' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.listsIdle).toBe(true);
    expect(body.listsError).toBeUndefined();
    // The saved/known lists are still returned for display; the live set was not fetched.
    expect(body.enabled).toEqual({ cart: true, lists: [{ id: 'L1', name: 'Classiques' }] });
    expect(body.available.lists).toEqual([]);
  });

  it('POST /api/config/destinations/refresh forces the live fetch even in lazy mode (BL-007)', async () => {
    h.credentialStore.save({ email: 'user@example.com', password: SECRET_PASSWORD });
    h.configStore.set(CONFIG_KEYS.authMode, 'lazy');
    pool.intercept({ path: pathIs('/v1/shopping-lists'), method: 'GET' }).reply(200, {
      content: [
        {
          id: 'L1',
          name: 'Classiques',
          nbItems: 3,
          hasAvailableProduct: true,
          createdAt: '',
          updatedAt: '',
        },
      ],
      page: {},
    });

    const res = await h.app.inject({ method: 'POST', url: '/api/config/destinations/refresh' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.listsIdle).toBeUndefined();
    expect(body.available.lists).toHaveLength(1);
    expect(body.available.lists[0].name).toBe('Classiques');
  });

  it('GET /api/config/destinations still renders when the live list fetch fails', async () => {
    pool.intercept({ path: pathIs('/v1/shopping-lists'), method: 'GET' }).reply(500, {});
    const res = await h.app.inject({ method: 'GET', url: '/api/config/destinations' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.available.lists).toEqual([]);
    expect(body.listsError).toBeDefined();
    expect(body.listsError.category).toBe('server');
  });

  it('GET /api/scans returns the total + page of rows (newest first), with no secrets', async () => {
    h.scanLog.append({ ean: '111', outcome: 'added', message: 'Added "X"' });
    h.scanLog.append({ ean: '222', outcome: 'not_found', message: 'EAN not in catalogue' });
    // A credential is set so we can prove it never leaks into the scans response.
    h.credentialStore.save({ email: 'user@example.com', password: SECRET_PASSWORD });

    const res = await h.app.inject({ method: 'GET', url: '/api/scans' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body).toMatchObject({ page: 1, pageSize: 100 });
    expect(body.scans).toHaveLength(2);
    expect(body.scans[0].ean).toBe('222'); // newest first
    expect(res.body).not.toContain(SECRET_PASSWORD);
  });

  it('GET /api/scans paginates with page/pageSize and reports the full total (BL-004)', async () => {
    for (let i = 0; i < 7; i += 1) h.scanLog.append({ ean: `E${String(i)}`, outcome: 'added' });

    const p1 = (await h.app.inject({ method: 'GET', url: '/api/scans?pageSize=10&page=1' })).json();
    // pageSize=10 is a valid option; only 7 rows exist.
    expect(p1.total).toBe(7);
    expect(p1.scans).toHaveLength(7);

    // An out-of-range pageSize falls back to the default; page 2 of size 5 holds the remainder.
    const p2 = (await h.app.inject({ method: 'GET', url: '/api/scans?pageSize=50&page=2' })).json();
    expect(p2.total).toBe(7);
    expect(p2.scans).toHaveLength(0); // page 2 of 50 is empty when only 7 rows exist
  });

  it('GET /api/scans filters by status and searches by EAN/message (BL-004)', async () => {
    h.scanLog.append({ ean: '111', outcome: 'added', message: 'Added "Milk"' });
    h.scanLog.append({ ean: '222', outcome: 'not_found', message: 'EAN not in catalogue' });
    h.scanLog.append({ ean: '333', outcome: 'added', message: 'Added "Bread"' });

    const byStatus = (
      await h.app.inject({ method: 'GET', url: '/api/scans?status=not_found' })
    ).json();
    expect(byStatus.total).toBe(1);
    expect(byStatus.scans[0].ean).toBe('222');

    const bySearchEan = (
      await h.app.inject({ method: 'GET', url: '/api/scans?search=333' })
    ).json();
    expect(bySearchEan.total).toBe(1);
    expect(bySearchEan.scans[0].ean).toBe('333');

    const bySearchMsg = (
      await h.app.inject({ method: 'GET', url: '/api/scans?search=Bread' })
    ).json();
    expect(bySearchMsg.total).toBe(1);
    expect(bySearchMsg.scans[0].ean).toBe('333');
  });

  it('GET /api/scans?pageSize=all returns every matching row on one page (BL-004)', async () => {
    for (let i = 0; i < 12; i += 1) h.scanLog.append({ ean: `E${String(i)}`, outcome: 'added' });
    const all = (await h.app.inject({ method: 'GET', url: '/api/scans?pageSize=all' })).json();
    expect(all.total).toBe(12);
    expect(all.scans).toHaveLength(12);
  });

  it('GET /api/events returns recent events, filterable by category (BL-003)', async () => {
    h.eventLog.append({
      category: 'auth',
      type: 'login_complete',
      level: 'info',
      message: 'login',
    });
    h.eventLog.append({ category: 'scan', type: 'scan_complete', level: 'info', message: 'scan' });
    h.eventLog.append({ category: 'other', type: 'startup', level: 'info', message: 'startup' });

    const all = (await h.app.inject({ method: 'GET', url: '/api/events' })).json();
    expect(all.total).toBe(3);
    expect(all.events).toHaveLength(3);
    expect(all.events[0].category).toBe('other'); // newest first

    const auth = (await h.app.inject({ method: 'GET', url: '/api/events?category=auth' })).json();
    expect(auth.total).toBe(1);
    expect(auth.events[0].type).toBe('login_complete');
  });

  it('mounts the local API (BL-008): /api/v1/ping is key-guarded, /api/* + /v1/scan are not', async () => {
    // No key set in the harness → the local API is locked.
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/ping' })).statusCode).toBe(401);

    // The internal UI API and the ESP scan endpoint require no key (unchanged).
    expect((await h.app.inject({ method: 'GET', url: '/api/config' })).statusCode).toBe(200);
    expect((await h.app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);

    // With the managed key set, the right header reaches the stub.
    h.configStore.set(CONFIG_KEYS.localApiKey, 'INTEG-KEY');
    const ok = await h.app.inject({
      method: 'GET',
      url: '/api/v1/ping',
      headers: { 'x-api-key': 'INTEG-KEY' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ status: 'ok', version: 1 });

    // The served call is journalled as an api_local event, filterable on /logs (BL-009).
    const apiLocal = (
      await h.app.inject({ method: 'GET', url: '/api/events?category=api_local' })
    ).json();
    expect(apiLocal.total).toBeGreaterThanOrEqual(1);
    expect(apiLocal.events[0].type).toBe('local_api_request');
  });

  it('GET /api/config never exposes the managed local_api_key, and PUT does not clobber it', async () => {
    h.configStore.set(CONFIG_KEYS.localApiKey, 'MANAGED-KEY');

    const before = (await h.app.inject({ method: 'GET', url: '/api/config' })).json();
    expect(before.localApiKey).toBeUndefined();

    // A normal config write must leave the app-managed key intact.
    await h.app.inject({ method: 'PUT', url: '/api/config', payload: CONFIG });
    expect(h.configStore.readAppConfig().localApiKey).toBe('MANAGED-KEY');

    const after = (await h.app.inject({ method: 'GET', url: '/api/config' })).json();
    expect(after.localApiKey).toBeUndefined();
  });

  it('GET /api/events accepts the new chronodrive category filter (BL-009)', async () => {
    h.eventLog.append({
      category: 'chronodrive',
      type: 'product_lookup',
      level: 'info',
      message: 'upstream',
    });
    const res = (
      await h.app.inject({ method: 'GET', url: '/api/events?category=chronodrive' })
    ).json();
    expect(res.total).toBe(1);
    expect(res.events[0].category).toBe('chronodrive');
  });

  it('local API: search + product sheet (BL-010), guarded, logged as chronodrive', async () => {
    h.configStore.set(CONFIG_KEYS.localApiKey, 'LK');
    const FULL_PRODUCT = {
      id: '91574',
      labels: { productLabel: 'Mozzarella', brandLabel: 'AUCHAN', unitQuantityLabel: '125 g' },
      eans: ['3596710335510'],
      prices: { defaultPrice: 1.79, lastPeriodLowestPrice: 1.79 },
      stock: 'HIGH_STOCK',
      isEligible: true,
      packaging: { unit: 'kg', weight: 0.125 },
      images: { views: ['img/PM/P/0/74/0P_91574.gif'] },
      characteristics: {
        ingredients: 'LAIT…',
        features: [
          { code: '563', value: '100 g' },
          { code: '243', value: '262' },
          { code: '168', value: '13' },
          { code: '520', value: 'C' },
        ],
      },
    };
    const searchBody = {
      page: {
        size: 20,
        totalElements: 1,
        totalPages: 1,
        number: 1,
        hasNext: false,
        isEmpty: false,
      },
      content: [FULL_PRODUCT],
    };

    // No key → 401, before any upstream call.
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/products/91574' })).statusCode).toBe(
      401,
    );

    // Missing q → 400.
    const bad = await h.app.inject({
      method: 'GET',
      url: '/api/v1/search',
      headers: { 'x-api-key': 'LK' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('bad_request');

    // Search (keyword) → 200 summaries.
    pool.intercept({ path: pathIs('/v1/products'), method: 'GET' }).reply(200, searchBody);
    const search = await h.app.inject({
      method: 'GET',
      url: '/api/v1/search?q=mozzarella',
      headers: { 'x-api-key': 'LK' },
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().products[0]).toMatchObject({ id: '91574', weightKg: 0.125 });
    expect(search.json().products[0].image).toContain('static1.chronodrive.com');

    // Product by EAN → 200 normalized with mapped nutrition.
    pool.intercept({ path: pathIs('/v1/products'), method: 'GET' }).reply(200, searchBody);
    const byEan = await h.app.inject({
      method: 'GET',
      url: '/api/v1/products/3596710335510',
      headers: { 'x-api-key': 'LK' },
    });
    expect(byEan.statusCode).toBe(200);
    expect(byEan.json().nutrition).toMatchObject({ energyKcal: 262, protein: 13, nutriScore: 'C' });
    expect(byEan.json().weightKg).toBe(0.125);

    // Product by id → 200.
    pool.intercept({ path: '/v1/products/91574', method: 'GET' }).reply(200, FULL_PRODUCT);
    const byId = await h.app.inject({
      method: 'GET',
      url: '/api/v1/products/91574',
      headers: { 'x-api-key': 'LK' },
    });
    expect(byId.statusCode).toBe(200);
    expect(byId.json().id).toBe('91574');

    // Unknown EAN (empty upstream content) → clean 404.
    pool.intercept({ path: pathIs('/v1/products'), method: 'GET' }).reply(200, {
      page: { size: 1, totalElements: 0, totalPages: 0, number: 1, hasNext: false, isEmpty: true },
      content: [],
    });
    const missing = await h.app.inject({
      method: 'GET',
      url: '/api/v1/products/0000000000000',
      headers: { 'x-api-key': 'LK' },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('not_found');

    // The upstream calls were journalled as `chronodrive` (API Chronodrive) and are filterable.
    const cd = (
      await h.app.inject({ method: 'GET', url: '/api/events?category=chronodrive' })
    ).json();
    expect(cd.total).toBeGreaterThanOrEqual(1);
    expect(['product_search', 'product_lookup']).toContain(cd.events[0].type);
  });

  it('local API: cart read + nutrition aggregate (BL-011)', async () => {
    h.configStore.set(CONFIG_KEYS.localApiKey, 'LK');
    const CART = {
      content: [
        {
          id: 'CART-1',
          isOrdered: false,
          amounts: { totalCartAmount: 3.58, totalOrderAmount: 3.58 },
          items: [
            {
              quantity: 2,
              product: {
                id: '91574',
                labels: { productLabel: 'Mozzarella' },
                eans: ['3596710335510'],
                prices: { defaultPrice: 1.79, totalAmount: 3.58 },
                packaging: { weight: 0.125 },
                characteristics: {
                  features: [
                    { code: '243', value: '262' },
                    { code: '168', value: '13' },
                  ],
                },
              },
            },
          ],
        },
      ],
    };
    pool.intercept({ path: pathIs('/v1/customers/me/carts'), method: 'GET' }).reply(200, CART);
    pool.intercept({ path: pathIs('/v1/customers/me/carts'), method: 'GET' }).reply(200, CART);

    const cart = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      headers: { 'x-api-key': 'LK' },
    });
    expect(cart.statusCode).toBe(200);
    expect(cart.json().id).toBe('CART-1');
    expect(cart.json().items[0]).toMatchObject({ quantity: 2, lineTotal: 3.58 });

    const nut = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart/nutrition',
      headers: { 'x-api-key': 'LK' },
    });
    expect(nut.statusCode).toBe(200);
    expect(nut.json().totalPrice).toBe(3.58);
    expect(nut.json().nutrition.energyKcal).toBe(655); // 262 × (0.125×10) × 2
  });

  it('local API: cart write resolves id / ean / name + reports not_found (BL-011)', async () => {
    h.configStore.set(CONFIG_KEYS.localApiKey, 'LK');
    // searchTerm-aware product search (ean + name resolution).
    pool
      .intercept({ path: pathIs('/v1/products'), method: 'GET' })
      .reply(200, (opts) => {
        const term = new URL(`http://x${opts.path}`).searchParams.get('searchTerm');
        const page = { size: 1, totalElements: 1, totalPages: 1, number: 1, hasNext: false };
        if (term === '3596710335510')
          return { page, content: [{ id: '222', labels: {}, eans: [] }] };
        if (term === 'mozzarella') return { page, content: [{ id: '333', labels: {}, eans: [] }] };
        return { page: { ...page, totalElements: 0 }, content: [] };
      })
      .persist();
    pool
      .intercept({ path: pathIs('/v1/customers/me/carts'), method: 'GET' })
      .reply(200, { content: [{ id: 'CART-1', isOrdered: false, items: [], amounts: {} }] })
      .persist();
    let postBody: { content: Array<{ productId: string; quantity: number }> } = { content: [] };
    pool
      .intercept({ path: '/v1/carts/CART-1/items', method: 'POST' })
      .reply(200, (opts) => {
        postBody = JSON.parse(opts.body as string);
        return {
          content: postBody.content.map((c) => ({ ...c, returnType: 'SUCCESS' })),
        };
      })
      .persist();

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { 'x-api-key': 'LK' },
      payload: {
        items: [
          { id: '111', quantity: 2 },
          { ean: '3596710335510' },
          { name: 'mozzarella' },
          { name: 'zzz-nope' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.applied).toHaveLength(3); // id + ean + name resolved
    expect(body.resolutions.map((r: { status: string }) => r.status)).toEqual([
      'resolved',
      'resolved',
      'resolved',
      'not_found',
    ]);
    expect(postBody.content[0]).toMatchObject({ productId: '111', quantity: 2 });
  });

  it('local API: lists read + add + recipe-fill to cart (BL-011)', async () => {
    h.configStore.set(CONFIG_KEYS.localApiKey, 'LK');
    pool.intercept({ path: pathIs('/v1/shopping-lists'), method: 'GET' }).reply(200, {
      content: [
        {
          id: 'L1',
          name: 'Classiques',
          nbItems: 2,
          hasAvailableProduct: true,
          createdAt: '',
          updatedAt: '',
        },
      ],
      page: {
        size: 1,
        totalElements: 1,
        totalPages: 1,
        number: 1,
        hasNext: false,
        hasPrevious: false,
        isEmpty: false,
      },
    });
    pool.intercept({ path: '/v1/shopping-lists/L1', method: 'PATCH' }).reply(204, '').persist();
    pool
      .intercept({ path: pathIs('/v1/products'), method: 'GET' })
      .reply(200, {
        page: { size: 1, totalElements: 1, totalPages: 1, number: 1, hasNext: false },
        content: [{ id: '777', labels: { productLabel: 'Lait' }, eans: [] }],
      })
      .persist();
    pool
      .intercept({ path: pathIs('/v1/customers/me/carts'), method: 'GET' })
      .reply(200, { content: [{ id: 'CART-1', isOrdered: false, items: [], amounts: {} }] })
      .persist();
    pool
      .intercept({ path: '/v1/carts/CART-1/items', method: 'POST' })
      .reply(200, { content: [{ productId: '777', quantity: 1, returnType: 'SUCCESS' }] })
      .persist();

    const lists = await h.app.inject({
      method: 'GET',
      url: '/api/v1/lists',
      headers: { 'x-api-key': 'LK' },
    });
    expect(lists.statusCode).toBe(200);
    expect(lists.json().lists[0]).toMatchObject({ id: 'L1', name: 'Classiques' });

    const addToList = await h.app.inject({
      method: 'POST',
      url: '/api/v1/lists/L1/items',
      headers: { 'x-api-key': 'LK' },
      payload: { items: [{ name: 'lait' }] },
    });
    expect(addToList.statusCode).toBe(200);
    expect(addToList.json().applied).toEqual(['777']);

    const recipe = await h.app.inject({
      method: 'POST',
      url: '/api/v1/recipe-fill',
      headers: { 'x-api-key': 'LK' },
      payload: { target: { cart: true }, items: [{ id: '777', quantity: 2 }, { name: 'lait' }] },
    });
    expect(recipe.statusCode).toBe(200);
    expect(recipe.json().added).toBe(2);

    // The cart/list exchanges are journalled as `chronodrive`.
    const cd = (
      await h.app.inject({ method: 'GET', url: '/api/events?category=chronodrive' })
    ).json();
    expect(cd.events.some((e: { type: string }) => e.type === 'recipe_fill')).toBe(true);
  });

  it('local API: cart endpoints stay key-guarded (BL-011)', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/cart' })).statusCode).toBe(401);
    expect(
      (await h.app.inject({ method: 'POST', url: '/api/v1/cart/items', payload: {} })).statusCode,
    ).toBe(401);
  });

  it('price tracking: full CRUD on the internal /api/price-tracking surface (BL-012)', async () => {
    // Adding by EAN resolves the product via the Products search.
    pool
      .intercept({ path: pathIs('/v1/products'), method: 'GET' })
      .reply(200, {
        page: { size: 1, totalElements: 1, totalPages: 1, number: 1, hasNext: false },
        content: [{ id: '91574', labels: { productLabel: 'Mozzarella' }, eans: ['3596710335510'] }],
      })
      .persist();

    const add = await h.app.inject({
      method: 'POST',
      url: '/api/price-tracking',
      payload: { ean: '3596710335510', threshold: 1.5 },
    });
    expect(add.statusCode).toBe(200);
    expect(add.json()).toMatchObject({
      productId: '91574',
      label: 'Mozzarella',
      threshold: 1.5,
      armed: true,
    });

    const list = await h.app.inject({ method: 'GET', url: '/api/price-tracking' });
    expect(list.json().products).toHaveLength(1);

    const put = await h.app.inject({
      method: 'PUT',
      url: '/api/price-tracking/91574',
      payload: { threshold: 1.2 },
    });
    expect(put.json().threshold).toBe(1.2);

    const history = await h.app.inject({ method: 'GET', url: '/api/price-tracking/91574/history' });
    expect(history.json()).toEqual({ productId: '91574', history: [] });

    // Settings round-trip + apply.
    expect(
      (await h.app.inject({ method: 'GET', url: '/api/price-tracking/settings' })).json(),
    ).toEqual({
      enabled: false,
      intervalHours: 12,
    });
    const settings = await h.app.inject({
      method: 'PUT',
      url: '/api/price-tracking/settings',
      payload: { enabled: true, intervalHours: 6 },
    });
    expect(settings.json()).toEqual({ enabled: true, intervalHours: 6 });
    expect(h.configStore.readAppConfig().priceTrackingEnabled).toBe(true);

    const del = await h.app.inject({ method: 'DELETE', url: '/api/price-tracking/91574' });
    expect(del.json()).toEqual({ removed: '91574' });

    // No products left → check-now is a no-op summary (no upstream call).
    const check = await h.app.inject({ method: 'POST', url: '/api/price-tracking/check-now' });
    expect(check.json()).toEqual({ checked: 0, alerts: 0 });

    // Bad input.
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/price-tracking',
          payload: { threshold: 1 },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('price tracking: the local /api/v1 surface is key-guarded (BL-012)', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/price-tracking' })).statusCode).toBe(
      401,
    );
    h.configStore.set(CONFIG_KEYS.localApiKey, 'LK');
    const ok = await h.app.inject({
      method: 'GET',
      url: '/api/v1/price-tracking',
      headers: { 'x-api-key': 'LK' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ products: [] });
  });

  it('PUT /api/config journals a config_change event (BL-003)', async () => {
    await h.app.inject({ method: 'PUT', url: '/api/config', payload: CONFIG });
    const events = h.eventLog.query({ page: 1, pageSize: 50 });
    expect(events.some((e) => e.type === 'config_change')).toBe(true);
  });

  it('GET /api/health runs the self-test when configured', async () => {
    h.credentialStore.save({ email: 'user@example.com', password: SECRET_PASSWORD });
    pool
      .intercept({ path: pathIs('/v1/search-suggestions'), method: 'GET' })
      .reply(200, { products: [{ id: 'P', labels: {}, eans: [], stock: 'HIGH_STOCK' }] });
    pool
      .intercept({ path: pathIs('/v1/customers/me/carts'), method: 'GET' })
      .reply(200, { content: [{ id: 'CART-1', items: [], isOrdered: false }] });
    pool
      .intercept({ path: pathIs('/v1/shopping-lists'), method: 'GET' })
      .reply(200, { content: [], page: {} });

    const res = await h.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('checks');
    expect(res.json().checks.length).toBeGreaterThan(0);
  });

  it('GET /api/health skips the probe (configured:false, no checks) when not configured', async () => {
    // No interceptors: the self-test must not attempt any connection.
    const res = await h.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ configured: false, checks: [] });
  });

  it('round-trips authMode through PUT/GET /api/config (BL-006)', async () => {
    const lazy = { ...CONFIG, authMode: 'lazy' as const };
    const put = await h.app.inject({ method: 'PUT', url: '/api/config', payload: lazy });
    expect(put.statusCode).toBe(200);
    expect(put.json().authMode).toBe('lazy');
    const get = await h.app.inject({ method: 'GET', url: '/api/config' });
    expect(get.json().authMode).toBe('lazy');
  });

  it('PUT /api/config rejects an invalid authMode (BL-006)', async () => {
    const bad = { ...CONFIG, authMode: 'sometimes' };
    const res = await h.app.inject({ method: 'PUT', url: '/api/config', payload: bad });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/health is idle (no connection) in lazy mode with no live session (BL-006)', async () => {
    h.credentialStore.save({ email: 'user@example.com', password: SECRET_PASSWORD });
    h.configStore.set(CONFIG_KEYS.authMode, 'lazy');
    // No interceptors registered: a connection attempt would fail (disableNetConnect).
    const res = await h.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ configured: true, idle: true, checks: [] });
  });

  it('POST /api/health/connect forces a probe even in lazy mode (BL-006)', async () => {
    h.credentialStore.save({ email: 'user@example.com', password: SECRET_PASSWORD });
    h.configStore.set(CONFIG_KEYS.authMode, 'lazy');
    pool
      .intercept({ path: pathIs('/v1/search-suggestions'), method: 'GET' })
      .reply(200, { products: [{ id: 'P', labels: {}, eans: [], stock: 'HIGH_STOCK' }] });
    pool
      .intercept({ path: pathIs('/v1/customers/me/carts'), method: 'GET' })
      .reply(200, { content: [{ id: 'CART-1', items: [], isOrdered: false }] });
    pool
      .intercept({ path: pathIs('/v1/shopping-lists'), method: 'GET' })
      .reply(200, { content: [], page: {} });

    const res = await h.app.inject({ method: 'POST', url: '/api/health/connect' });
    expect(res.statusCode).toBe(200);
    expect(res.json().idle).toBeUndefined();
    expect(res.json().checks.length).toBeGreaterThan(0);
  });
});

describe('api SSE stream (real socket)', () => {
  let h: Harness;
  let base: string;

  beforeEach(async () => {
    h = buildHarness();
    base = await h.app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    await h.app.close();
    h.db.close();
  });

  it('GET /api/scans/stream sets event-stream headers and relays a published scan', async () => {
    const res = await request(`${base}/api/scans/stream`);
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/event-stream');

    // The handler has subscribed by the time the response headers arrive; publish then read.
    h.events.publish({ at: 1, response: { status: 'added', ean: '999', message: 'ok' } });

    let buffer = '';
    for await (const chunk of res.body) {
      buffer += chunk.toString();
      if (buffer.includes('data:')) break;
    }
    expect(buffer).toContain('"ean":"999"');
    res.body.destroy();
  });

  it('GET /api/events/stream sets event-stream headers and relays a published event', async () => {
    const res = await request(`${base}/api/events/stream`);
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/event-stream');

    h.eventBus.publish({
      id: 1,
      at: 1,
      category: 'auth',
      type: 'login_complete',
      level: 'info',
      message: 'login ok',
    });

    let buffer = '';
    for await (const chunk of res.body) {
      buffer += chunk.toString();
      if (buffer.includes('data:')) break;
    }
    expect(buffer).toContain('"type":"login_complete"');
    res.body.destroy();
  });
});
