import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import type { Dispatcher } from 'undici';
import type { AppConfig } from '../config/defaults.js';
import { HttpClient } from '../http/client.js';
import { ChronodriveClient, HEALTH_CHECK_EAN } from '../chronodrive/client.js';
import { runHealthSelfTest } from './selfTest.js';

const API_ORIGIN = 'https://api.test.local';

const CONFIG: AppConfig = {
  clientId: 'C',
  redirectUri: 'https://www.test.local',
  scope: 'openid',
  identityBaseUrl: 'https://connect.test.local',
  apiBaseUrl: 'https://api.test.local/v1',
  apiKeys: {
    search: 'S',
    products: 'P',
    customerCartRead: 'C',
    cartWrite: 'W',
    shoppingLists: 'L',
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

function client(): ChronodriveClient {
  return new ChronodriveClient({
    http: new HttpClient({
      sleep: async () => {},
      random: () => 0,
      retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
    }),
    config: CONFIG,
    getToken: async () => 'TOKEN',
  });
}

describe('runHealthSelfTest', () => {
  let mockAgent: MockAgent;
  let original: Dispatcher;
  let pool: ReturnType<MockAgent['get']>;

  beforeEach(() => {
    original = getGlobalDispatcher();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
    pool = mockAgent.get(API_ORIGIN);
  });

  afterEach(async () => {
    await mockAgent.close();
    setGlobalDispatcher(original);
  });

  it('reports ok with the site id and per-endpoint versions when every endpoint responds', async () => {
    pool
      .intercept({ path: '/v1/customers/me', method: 'GET' })
      .reply(200, { lastVisitedSite: { id: 1016 } }, { headers: { 'x-api-version': '1.4.0' } });
    pool.intercept({ path: pathIs('/v1/search-suggestions'), method: 'GET' }).reply(
      200,
      {
        keywords: [HEALTH_CHECK_EAN],
        products: [
          {
            id: '2555',
            labels: { productLabel: 'Sel' },
            eans: [HEALTH_CHECK_EAN],
            stock: 'HIGH_STOCK',
            isEligible: true,
          },
        ],
        categories: [],
      },
      { headers: { 'x-api-version': '1.38.1' } },
    );
    pool
      .intercept({ path: pathIs('/v1/customers/me/carts'), method: 'GET' })
      .reply(200, { content: [{ id: 'cart1', items: [], isOrdered: false }] });
    pool.intercept({ path: pathIs('/v1/shopping-lists'), method: 'GET' }).reply(200, {
      content: [
        {
          id: 'L1',
          name: 'Classiques',
          nbItems: 1,
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

    const report = await runHealthSelfTest(client(), { now: () => 1234 });
    expect(report.ok).toBe(true);
    expect(report.configured).toBe(true);
    expect(report.siteId).toBe('1016');
    expect(report.checkedAt).toBe(1234);
    expect(report.checks).toHaveLength(4);
    expect(report.checks.every((c) => c.status === 'ok')).toBe(true);
    expect(report.apiVersions['GET /search-suggestions']).toBe('1.38.1');
    const customerCheck = report.checks.find((c) => c.endpoint === 'GET /customers/me');
    expect(customerCheck?.apiVersion).toBe('1.4.0');
  });

  it('marks a single failing endpoint without hiding the others', async () => {
    pool
      .intercept({ path: '/v1/customers/me', method: 'GET' })
      .reply(200, { lastVisitedSite: { id: 1016 } });
    // Known EAN returns no product → that check fails.
    pool
      .intercept({ path: pathIs('/v1/search-suggestions'), method: 'GET' })
      .reply(200, { keywords: [], products: [], categories: [] });
    pool
      .intercept({ path: pathIs('/v1/customers/me/carts'), method: 'GET' })
      .reply(200, { content: [{ id: 'cart1', items: [], isOrdered: false }] });
    pool.intercept({ path: pathIs('/v1/shopping-lists'), method: 'GET' }).reply(200, {
      content: [],
      page: {
        size: 0,
        totalElements: 0,
        totalPages: 0,
        number: 1,
        hasNext: false,
        hasPrevious: false,
        isEmpty: true,
      },
    });

    const report = await runHealthSelfTest(client());
    expect(report.ok).toBe(false);
    const search = report.checks.find((c) => c.endpoint === 'GET /search-suggestions');
    expect(search?.status).toBe('error');
    expect(search?.detail).toContain('no product');
    // The other three still ran and passed.
    expect(report.checks.filter((c) => c.status === 'ok')).toHaveLength(3);
  });

  it('short-circuits without any connection when not configured', async () => {
    // No interceptors registered: if it tried to connect, disableNetConnect would make the test fail.
    const report = await runHealthSelfTest(client(), {
      isConfigured: () => false,
      now: () => 7,
    });
    expect(report).toEqual({
      ok: false,
      configured: false,
      checks: [],
      apiVersions: {},
      checkedAt: 7,
    });
  });

  it('skips with idle:true (no connection) when lazy and no live session (BL-006)', async () => {
    // No interceptors registered: if it tried to connect, disableNetConnect would fail the test.
    const report = await runHealthSelfTest(client(), {
      isConfigured: () => true,
      hasSession: () => false,
      now: () => 9,
    });
    expect(report).toEqual({
      ok: false,
      configured: true,
      idle: true,
      checks: [],
      apiVersions: {},
      checkedAt: 9,
    });
  });

  it('runs normally when a live session exists (hasSession true)', async () => {
    pool
      .intercept({ path: '/v1/customers/me', method: 'GET' })
      .reply(200, { lastVisitedSite: { id: 1016 } });
    pool.intercept({ path: pathIs('/v1/search-suggestions'), method: 'GET' }).reply(200, {
      keywords: [HEALTH_CHECK_EAN],
      products: [
        { id: '1', labels: { productLabel: 'Sel' }, eans: [HEALTH_CHECK_EAN], isEligible: true },
      ],
      categories: [],
    });
    pool
      .intercept({ path: pathIs('/v1/customers/me/carts'), method: 'GET' })
      .reply(200, { content: [{ id: 'c', items: [], isOrdered: false }] });
    pool.intercept({ path: pathIs('/v1/shopping-lists'), method: 'GET' }).reply(200, {
      content: [],
      page: {
        size: 0,
        totalElements: 0,
        totalPages: 0,
        number: 1,
        hasNext: false,
        hasPrevious: false,
        isEmpty: true,
      },
    });

    const report = await runHealthSelfTest(client(), {
      isConfigured: () => true,
      hasSession: () => true,
    });
    expect(report.idle).toBeUndefined();
    expect(report.ok).toBe(true);
    expect(report.checks).toHaveLength(4);
  });

  it('reports an error check when the token/auth fails (401)', async () => {
    pool
      .intercept({ path: '/v1/customers/me', method: 'GET' })
      .reply(401, { error: 'expired' })
      .persist();
    pool
      .intercept({ path: pathIs('/v1/search-suggestions'), method: 'GET' })
      .reply(401, { error: 'expired' })
      .persist();
    pool
      .intercept({ path: pathIs('/v1/customers/me/carts'), method: 'GET' })
      .reply(401, { error: 'expired' })
      .persist();
    pool
      .intercept({ path: pathIs('/v1/shopping-lists'), method: 'GET' })
      .reply(401, { error: 'expired' })
      .persist();

    const report = await runHealthSelfTest(client());
    expect(report.ok).toBe(false);
    expect(report.checks.every((c) => c.status === 'error')).toBe(true);
    expect(report.checks[0]?.detail).toContain('auth');
    // The failing check carries its classification so the Phase 5 error monitor can act on it.
    expect(report.checks[0]?.category).toBe('auth');
  });
});
