import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import type { Dispatcher } from 'undici';
import { HaWebhookNotifier } from './haWebhook.js';

const HA_ORIGIN = 'https://ha.test.local';
const HA_PATH = '/api/webhook/abc';
const HA_URL = `${HA_ORIGIN}${HA_PATH}`;

describe('HaWebhookNotifier', () => {
  let mockAgent: MockAgent;
  let original: Dispatcher;
  let posted: Array<Record<string, unknown>>;

  beforeEach(() => {
    original = getGlobalDispatcher();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
    posted = [];
    mockAgent
      .get(HA_ORIGIN)
      .intercept({ path: HA_PATH, method: 'POST' })
      .reply((opts) => {
        posted.push(JSON.parse(String(opts.body)) as Record<string, unknown>);
        return { statusCode: 200, data: {} };
      })
      .persist();
  });

  afterEach(async () => {
    await mockAgent.close();
    setGlobalDispatcher(original);
  });

  it('posts a secret-free alert once per incident and respects the cooldown', async () => {
    let t = 1_000;
    const notifier = new HaWebhookNotifier({
      getUrl: () => HA_URL,
      now: () => t,
      cooldownMs: 60_000,
    });

    await notifier.notify({
      category: 'auth',
      endpoint: 'GET /customers/me',
      message: 'auth failed',
      at: 1_000,
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      source: 'BarclaudeGateway',
      severity: 'critical',
      category: 'auth',
      endpoint: 'GET /customers/me',
      message: 'auth failed',
      test: false,
    });
    // The payload must never carry secrets.
    const serialized = JSON.stringify(posted[0]);
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('token');

    // Same incident inside the cooldown → suppressed.
    t = 1_500;
    await notifier.notify({
      category: 'auth',
      endpoint: 'GET /customers/me',
      message: 'auth failed again',
      at: 1_500,
    });
    expect(posted).toHaveLength(1);

    // Same incident after the cooldown → fires again.
    t = 1_000 + 60_000 + 1;
    await notifier.notify({
      category: 'auth',
      endpoint: 'GET /customers/me',
      message: 'still failing',
      at: t,
    });
    expect(posted).toHaveLength(2);
  });

  it('fires immediately for a different incident, without waiting for the cooldown', async () => {
    const notifier = new HaWebhookNotifier({
      getUrl: () => HA_URL,
      now: () => 2_000,
      cooldownMs: 60_000,
    });
    await notifier.notify({
      category: 'auth',
      endpoint: 'GET /customers/me',
      message: 'a',
      at: 2_000,
    });
    await notifier.notify({
      category: 'server',
      endpoint: 'GET /search-suggestions',
      message: 'b',
      at: 2_000,
    });
    expect(posted).toHaveLength(2);
    expect(posted[1]).toMatchObject({ category: 'server' });
  });

  it('is a no-op when no URL is configured', async () => {
    const notifier = new HaWebhookNotifier({ getUrl: () => '' });
    await notifier.notify({ category: 'auth', message: 'auth failed', at: 1 });
    expect(posted).toHaveLength(0);
  });

  it('sendTest posts a clearly-marked sample and reports success', async () => {
    const notifier = new HaWebhookNotifier({ getUrl: () => HA_URL, now: () => 5 });
    const result = await notifier.sendTest();
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ test: true, severity: 'critical' });
  });

  it('sendTest returns ok:false when no URL is configured', async () => {
    const notifier = new HaWebhookNotifier({ getUrl: () => '' });
    const result = await notifier.sendTest();
    expect(result.ok).toBe(false);
    expect(posted).toHaveLength(0);
  });

  it('notifyPriceDrop posts a secret-free price_drop payload (BL-012)', async () => {
    const notifier = new HaWebhookNotifier({ getUrl: () => HA_URL, now: () => 9 });
    const result = await notifier.notifyPriceDrop({
      productId: '91574',
      label: 'Mozzarella',
      price: 1.49,
      threshold: 1.5,
      at: 9,
    });
    expect(result.ok).toBe(true);
    expect(posted[0]).toMatchObject({
      source: 'BarclaudeGateway',
      severity: 'info',
      kind: 'price_drop',
      productId: '91574',
      price: 1.49,
      threshold: 1.5,
      test: false,
    });
    const serialized = JSON.stringify(posted[0]);
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('token');
  });

  it('notifyPriceDrop is a no-op when no URL is configured', async () => {
    const notifier = new HaWebhookNotifier({ getUrl: () => '' });
    const result = await notifier.notifyPriceDrop({
      productId: 'P',
      price: 1,
      threshold: 2,
      at: 0,
    });
    expect(result.ok).toBe(false);
    expect(posted).toHaveLength(0);
  });
});
