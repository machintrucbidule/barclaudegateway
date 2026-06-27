import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import type { Dispatcher } from 'undici';
import type { AppConfig } from '../config/defaults.js';
import { HttpClient } from '../http/client.js';
import { ApiKeyError, AuthError, NotFoundError, SchemaError } from '../http/errors.js';
import { ChronodriveClient } from './client.js';

const API_ORIGIN = 'https://api.test.local';

const CONFIG: AppConfig = {
  clientId: 'C',
  redirectUri: 'https://www.test.local',
  scope: 'openid',
  identityBaseUrl: 'https://connect.test.local',
  apiBaseUrl: 'https://api.test.local/v1',
  apiKeys: {
    search: 'SEARCH_KEY',
    customerCartRead: 'CCR_KEY',
    cartWrite: 'CW_KEY',
    shoppingLists: 'SL_KEY',
  },
  siteMode: 'DRIVE',
  siteId: '',
  haWebhookUrl: '',
  authMode: 'keepalive',
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

function makeClient(siteId?: string): ChronodriveClient {
  return new ChronodriveClient({
    http: quietClient(),
    config: CONFIG,
    getToken: async () => 'TOKEN',
    siteId,
  });
}

describe('ChronodriveClient (mocked)', () => {
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

  it('derives site_id from /customers/me and caches it (one network call for two reads)', async () => {
    pool
      .intercept({ path: '/v1/customers/me', method: 'GET' })
      .reply(200, { lastVisitedSite: { id: 1016 } });

    const client = makeClient();
    expect(await client.getSiteId()).toBe('1016');
    expect(await client.getSiteId()).toBe('1016'); // would throw if it re-requested
  });

  it('injects auth, per-service key, site headers and Origin/Referer', async () => {
    let headers: Record<string, string> = {};
    pool.intercept({ path: pathIs('/v1/search-suggestions'), method: 'GET' }).reply(
      200,
      (opts) => {
        headers = opts.headers as Record<string, string>;
        return { keywords: [], products: [{ id: '2555', labels: {}, eans: [] }], categories: [] };
      },
      { headers: { 'x-api-version': '1.38.1' } },
    );

    const client = makeClient('1016');
    await client.resolveEan('3183280000933');

    expect(headers.authorization).toBe('Bearer TOKEN');
    expect(headers['x-device-type']).toBe('WEB');
    expect(headers['x-api-key']).toBe('SEARCH_KEY');
    expect(headers['x-chronodrive-site-id']).toBe('1016');
    expect(headers['x-chronodrive-site-mode']).toBe('DRIVE');
    expect(headers.origin).toBe('https://www.test.local');
    expect(headers.referer).toBe('https://www.test.local/');
  });

  it('records the observed x-api-version per endpoint', async () => {
    pool
      .intercept({ path: pathIs('/v1/search-suggestions'), method: 'GET' })
      .reply(
        200,
        { keywords: [], products: [], categories: [] },
        { headers: { 'x-api-version': '1.38.1' } },
      );

    const client = makeClient('1016');
    await client.resolveEan('000');
    expect(client.getApiVersions()['GET /search-suggestions']).toBe('1.38.1');
  });

  it('resolveEan returns the first product, or null when the catalogue has no match', async () => {
    pool.intercept({ path: pathIs('/v1/search-suggestions'), method: 'GET' }).reply(200, {
      keywords: [],
      products: [{ id: '2555', labels: {}, eans: ['3183280000933'] }],
      categories: [],
    });
    pool
      .intercept({ path: pathIs('/v1/search-suggestions'), method: 'GET' })
      .reply(200, { keywords: [], products: [], categories: [] });

    const client = makeClient('1016');
    expect((await client.resolveEan('3183280000933'))?.id).toBe('2555');
    expect(await client.resolveEan('0000000000000')).toBeNull();
  });

  it('updateCartItem sends a signed delta and returns the SUCCESS result', async () => {
    let body: {
      content: Array<{ clientOrigin: string; productId: string; quantity: number }>;
      optimizedMode: boolean;
    } = { content: [], optimizedMode: false };
    pool.intercept({ path: '/v1/carts/CART1/items', method: 'POST' }).reply(200, (opts) => {
      body = JSON.parse(opts.body as string);
      return {
        content: [
          { productId: '2555', quantity: -1, requestedQuantity: -1, returnType: 'SUCCESS' },
        ],
      };
    });

    const client = makeClient('1016');
    const result = await client.updateCartItem({
      cartId: 'CART1',
      productId: '2555',
      quantity: -1,
    });

    expect(body.content[0]?.quantity).toBe(-1);
    expect(body.content[0]?.clientOrigin).toBe('WEB|ARBO|{id}');
    expect(body.optimizedMode).toBe(true);
    expect(result.quantity).toBe(-1);
  });

  it('updateCartItem throws SchemaError when returnType is not SUCCESS', async () => {
    pool
      .intercept({ path: '/v1/carts/CART1/items', method: 'POST' })
      .reply(200, { content: [{ productId: '2555', quantity: 0, returnType: 'ERROR' }] });

    const client = makeClient('1016');
    await expect(
      client.updateCartItem({ cartId: 'CART1', productId: '2555', quantity: 1 }),
    ).rejects.toBeInstanceOf(SchemaError);
  });

  it('addToList and removeFromList send the right PATCH bodies and accept 204', async () => {
    let addBody: { objectsToAdd: unknown } = { objectsToAdd: null };
    let removeBody: { objectsToRemove: unknown } = { objectsToRemove: null };
    pool.intercept({ path: '/v1/shopping-lists/L1', method: 'PATCH' }).reply(204, (opts) => {
      addBody = JSON.parse(opts.body as string);
      return '';
    });
    pool.intercept({ path: '/v1/shopping-lists/L1', method: 'PATCH' }).reply(204, (opts) => {
      removeBody = JSON.parse(opts.body as string);
      return '';
    });

    const client = makeClient('1016');
    await client.addToList('L1', [{ productId: '2555', quantity: 1 }]);
    await client.removeFromList('L1', ['400863']);

    expect(addBody.objectsToAdd).toEqual([{ productId: '2555', quantity: 1 }]);
    expect(removeBody.objectsToRemove).toEqual([{ productId: '400863' }]);
  });

  it('getShoppingLists returns the list array', async () => {
    pool.intercept({ path: pathIs('/v1/shopping-lists'), method: 'GET' }).reply(200, {
      content: [
        {
          id: 'L1',
          name: 'Classiques',
          nbItems: 191,
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

    const client = makeClient('1016');
    const lists = await client.getShoppingLists();
    expect(lists).toHaveLength(1);
    expect(lists[0]?.name).toBe('Classiques');
  });

  it('maps 401 → AuthError, 403 → ApiKeyError, 404 → NotFoundError', async () => {
    pool
      .intercept({ path: pathIs('/v1/search-suggestions'), method: 'GET' })
      .reply(401, { error: 'x' });
    pool
      .intercept({ path: pathIs('/v1/search-suggestions'), method: 'GET' })
      .reply(403, { error: 'x' });
    pool
      .intercept({ path: '/v1/shopping-lists/MISSING', method: 'GET' })
      .reply(404, { error: 'x' });

    const client = makeClient('1016');
    await expect(client.resolveEan('1')).rejects.toBeInstanceOf(AuthError);
    await expect(client.resolveEan('2')).rejects.toBeInstanceOf(ApiKeyError);
    await expect(client.getShoppingList('MISSING')).rejects.toBeInstanceOf(NotFoundError);
  });
});
