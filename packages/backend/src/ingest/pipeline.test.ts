import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import type { Dispatcher } from 'undici';
import type { EnabledDestinations, Product } from '@barclaudegateway/shared';
import type { AppConfig } from '../config/defaults.js';
import { HttpClient } from '../http/client.js';
import { ChronodriveClient } from '../chronodrive/client.js';
import type { Database } from '../storage/db.js';
import { openDatabase } from '../storage/db.js';
import { ConfigStore } from '../storage/config.js';
import { DestinationsStore } from '../storage/destinations.js';
import { ScanLog } from '../storage/scanLog.js';
import { DebounceGate } from './debounce.js';
import { IngestPipeline } from './pipeline.js';

const API_ORIGIN = 'https://api.test.local';
const EAN = '3183280000933';
const SITE_ID = '1016';

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
};

const pathIs =
  (full: string) =>
  (p: string): boolean =>
    p.split('?')[0] === full;

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: '2555',
    labels: { productLabel: 'Gros sel de mer', brandLabel: 'LA BALEINE' },
    eans: [EAN],
    prices: { defaultPrice: 0.79 },
    remainingStock: 30,
    stock: 'HIGH_STOCK',
    isEligible: true,
    maxCartQuantity: 999,
    ...overrides,
  };
}

const LIST: EnabledDestinations['lists'][number] = { id: 'LIST-1', name: 'Classiques' };

function quietClient(): HttpClient {
  return new HttpClient({
    sleep: async () => {},
    random: () => 0,
    retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
  });
}

describe('IngestPipeline (mocked HTTP)', () => {
  let mockAgent: MockAgent;
  let original: Dispatcher;
  let pool: ReturnType<MockAgent['get']>;
  let db: Database;
  let scanLog: ScanLog;
  let destinations: DestinationsStore;
  let client: ChronodriveClient;

  beforeEach(() => {
    original = getGlobalDispatcher();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
    pool = mockAgent.get(API_ORIGIN);

    db = openDatabase(':memory:');
    const configStore = new ConfigStore(db);
    scanLog = new ScanLog(db);
    destinations = new DestinationsStore(configStore);
    client = new ChronodriveClient({
      http: quietClient(),
      config: CONFIG,
      getToken: async () => 'TOKEN',
      siteId: SITE_ID,
    });
  });

  afterEach(async () => {
    db.close();
    await mockAgent.close();
    setGlobalDispatcher(original);
  });

  function makePipeline(now?: () => number): IngestPipeline {
    return new IngestPipeline({
      chronodrive: client,
      scanLog,
      destinations,
      debounce: new DebounceGate(3_000, now),
    });
  }

  const interceptSearch = (body: { products: Product[] }): void => {
    pool.intercept({ path: pathIs('/v1/search-suggestions'), method: 'GET' }).reply(200, body);
  };
  const interceptActiveCart = (): void => {
    pool
      .intercept({ path: pathIs('/v1/customers/me/carts'), method: 'GET' })
      .reply(200, { content: [{ id: 'CART-1', items: [], isOrdered: false }] });
  };
  const interceptCartAdd = (status = 200): void => {
    pool
      .intercept({ path: pathIs('/v1/carts/CART-1/items'), method: 'POST' })
      .reply(
        status,
        status === 200
          ? { content: [{ productId: '2555', quantity: 1, returnType: 'SUCCESS' }] }
          : {},
      );
  };
  const interceptListAdd = (status = 204): void => {
    pool
      .intercept({ path: pathIs('/v1/shopping-lists/LIST-1'), method: 'PATCH' })
      .reply(status, '');
  };

  it('found + orderable → added, writes cart and list', async () => {
    destinations.write({ cart: true, lists: [LIST] });
    interceptSearch({ products: [product()] });
    interceptActiveCart();
    interceptCartAdd();
    interceptListAdd();

    const res = await makePipeline().handle(EAN);

    expect(res.status).toBe('added');
    expect(res.ean).toBe(EAN);
    expect(res.product?.label).toBe('Gros sel de mer');
    expect(res.destinations).toEqual([
      { kind: 'cart', id: 'CART-1', name: 'Panier', result: 'written' },
      { kind: 'list', id: 'LIST-1', name: 'Classiques', result: 'written' },
    ]);
    expect(scanLog.recent(1)[0]).toMatchObject({ ean: EAN, outcome: 'added' });
  });

  it('EAN absent from catalogue → not_found, logged, no writes', async () => {
    destinations.write({ cart: true, lists: [LIST] });
    interceptSearch({ products: [] });

    const res = await makePipeline().handle(EAN);

    expect(res.status).toBe('not_found');
    expect(res.destinations).toBeUndefined();
    expect(scanLog.recent(1)[0]).toMatchObject({ outcome: 'not_found' });
  });

  it('ineligible → added_to_lists_only, cart skipped, list still written', async () => {
    destinations.write({ cart: true, lists: [LIST] });
    interceptSearch({ products: [product({ isEligible: false })] });
    interceptListAdd();

    const res = await makePipeline().handle(EAN);

    expect(res.status).toBe('added_to_lists_only');
    expect(res.reason).toBe('ineligible');
    expect(res.destinations).toEqual([
      { kind: 'cart', name: 'Panier', result: 'skipped_unavailable', detail: 'ineligible' },
      { kind: 'list', id: 'LIST-1', name: 'Classiques', result: 'written' },
    ]);
    expect(scanLog.recent(1)[0]).toMatchObject({ outcome: 'added_to_lists_only' });
  });

  it('out of stock → added_to_lists_only with reason out_of_stock, cart skipped', async () => {
    destinations.write({ cart: true, lists: [LIST] });
    interceptSearch({ products: [product({ stock: 'NO_STOCK' })] });
    interceptListAdd();

    const res = await makePipeline().handle(EAN);

    expect(res.status).toBe('added_to_lists_only');
    expect(res.reason).toBe('out_of_stock');
    expect(res.destinations?.[0]).toEqual({
      kind: 'cart',
      name: 'Panier',
      result: 'skipped_unavailable',
      detail: 'out_of_stock',
    });
  });

  it('repeated EAN within the window → duplicate_ignored, resolves only once', async () => {
    destinations.write({ cart: true, lists: [LIST] });
    interceptSearch({ products: [product()] });
    interceptActiveCart();
    interceptCartAdd();
    interceptListAdd();
    const resolveSpy = vi.spyOn(client, 'resolveEan');

    const pipeline = makePipeline(() => 1_000); // frozen clock → second scan is inside the window
    const first = await pipeline.handle(EAN);
    const second = await pipeline.handle(EAN);

    expect(first.status).toBe('added');
    expect(second.status).toBe('duplicate_ignored');
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    // Only the first scan is journaled; the debounced repeat is not.
    expect(scanLog.count()).toBe(1);
  });

  it('Chronodrive error while resolving → error with category, logged', async () => {
    destinations.write({ cart: true, lists: [LIST] });
    pool.intercept({ path: pathIs('/v1/search-suggestions'), method: 'GET' }).reply(500, {});

    const res = await makePipeline().handle(EAN);

    expect(res.status).toBe('error');
    expect(res.category).toBe('server');
    expect(scanLog.recent(1)[0]).toMatchObject({ outcome: 'error' });
  });

  it('cart ok but list write fails → partial', async () => {
    destinations.write({ cart: true, lists: [LIST] });
    interceptSearch({ products: [product()] });
    interceptActiveCart();
    interceptCartAdd();
    interceptListAdd(500);

    const res = await makePipeline().handle(EAN);

    expect(res.status).toBe('partial');
    expect(res.category).toBe('server');
    expect(res.destinations?.find((d) => d.kind === 'cart')?.result).toBe('written');
    expect(res.destinations?.find((d) => d.kind === 'list')?.result).toBe('failed');
  });

  it('no destination enabled → error with a clear message', async () => {
    destinations.write({ cart: false, lists: [] });
    interceptSearch({ products: [product()] });

    const res = await makePipeline().handle(EAN);

    expect(res.status).toBe('error');
    expect(res.message).toMatch(/No destination enabled/);
  });
});
