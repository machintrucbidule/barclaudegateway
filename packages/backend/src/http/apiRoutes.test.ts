import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getGlobalDispatcher, MockAgent, request, setGlobalDispatcher } from 'undici';
import type { Dispatcher } from 'undici';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config/defaults.js';
import { HttpClient } from '../http/client.js';
import { ChronodriveClient } from '../chronodrive/client.js';
import type { Database } from '../storage/db.js';
import { openDatabase } from '../storage/db.js';
import { ConfigStore } from '../storage/config.js';
import { CredentialStore } from '../storage/credentials.js';
import { DestinationsStore } from '../storage/destinations.js';
import { ScanLog } from '../storage/scanLog.js';
import { IngestPipeline } from '../ingest/pipeline.js';
import { ScanEventBus } from '../ingest/scanEvents.js';
import { buildServer } from '../ingest/server.js';
import { ErrorMonitor } from '../health/errorMonitor.js';
import { HaWebhookNotifier } from '../health/haWebhook.js';

const API_ORIGIN = 'https://api.test.local';
const SECRET_PASSWORD = 'sup3r-s3cret-pw';

const CONFIG: AppConfig = {
  clientId: 'C',
  redirectUri: 'https://www.test.local',
  scope: 'openid',
  identityBaseUrl: 'https://connect.test.local',
  apiBaseUrl: 'https://api.test.local/v1',
  apiKeys: { search: 'SK', customerCartRead: 'CCR', cartWrite: 'CW', shoppingLists: 'SL' },
  siteMode: 'DRIVE',
  siteId: '1016',
  haWebhookUrl: '',
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
  destinations: DestinationsStore;
  credentialStore: CredentialStore;
  scanLog: ScanLog;
  events: ScanEventBus;
  errorMonitor: ErrorMonitor;
}

function buildHarness(): Harness {
  const db = openDatabase(':memory:');
  const configStore = new ConfigStore(db);
  configStore.seedDefaults();
  const destinations = new DestinationsStore(configStore);
  const scanLog = new ScanLog(db);
  const credentialStore = new CredentialStore(db, Buffer.alloc(32));
  const events = new ScanEventBus();
  const chronodrive = new ChronodriveClient({
    http: quietClient(),
    config: CONFIG,
    getToken: async () => 'TOKEN',
    siteId: '1016',
  });
  const pipeline = new IngestPipeline({ chronodrive, scanLog, destinations, events });
  const errorMonitor = new ErrorMonitor();
  const haWebhook = new HaWebhookNotifier({
    getUrl: () => configStore.readAppConfig().haWebhookUrl,
  });
  const app = buildServer({
    pipeline,
    chronodrive,
    configStore,
    destinations,
    credentialStore,
    scanLog,
    events,
    errorMonitor,
    haWebhook,
  });
  return { app, db, destinations, credentialStore, scanLog, events, errorMonitor };
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

  it('GET /api/scans returns the journal count + recent rows, with no secrets', async () => {
    h.scanLog.append({ ean: '111', outcome: 'added', message: 'Added "X"' });
    h.scanLog.append({ ean: '222', outcome: 'not_found', message: 'EAN not in catalogue' });
    // A credential is set so we can prove it never leaks into the scans response.
    h.credentialStore.save({ email: 'user@example.com', password: SECRET_PASSWORD });

    const res = await h.app.inject({ method: 'GET', url: '/api/scans?limit=10' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(2);
    expect(body.scans).toHaveLength(2);
    expect(body.scans[0].ean).toBe('222'); // newest first
    expect(res.body).not.toContain(SECRET_PASSWORD);
  });

  it('GET /api/health runs the self-test', async () => {
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
});
