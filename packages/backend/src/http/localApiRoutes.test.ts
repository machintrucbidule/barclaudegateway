import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { CONFIG_KEYS } from '../config/defaults.js';
import type { Database } from '../storage/db.js';
import { openDatabase } from '../storage/db.js';
import { ConfigStore } from '../storage/config.js';
import { EventLog } from '../storage/eventLog.js';
import { EventLogBus } from '../logging/eventLogBus.js';
import { EventLogger } from '../logging/eventLogger.js';
import { HttpClient } from './client.js';
import { ChronodriveClient } from '../chronodrive/client.js';
import { localApiRoutes } from './localApiRoutes.js';

const KEY = 'test-local-api-key';

interface Harness {
  app: FastifyInstance;
  db: Database;
  configStore: ConfigStore;
  eventLog: EventLog;
}

function buildHarness(): Harness {
  const db = openDatabase(':memory:');
  const configStore = new ConfigStore(db);
  configStore.seedDefaults();
  configStore.set(CONFIG_KEYS.localApiKey, KEY);
  const eventLog = new EventLog(db);
  const emit = new EventLogger(eventLog, new EventLogBus()).emit;
  // A client built but never called by these guard/stub tests (product routes are covered elsewhere).
  const chronodrive = new ChronodriveClient({
    http: new HttpClient(),
    config: configStore.readAppConfig(),
    getToken: async () => 'TOKEN',
    siteId: '1',
  });

  const app = Fastify();
  void app.register(localApiRoutes, {
    prefix: '/api/v1',
    deps: { configStore, emit, chronodrive },
  });
  return { app, db, configStore, eventLog };
}

describe('localApiRoutes (Layer B, BL-008)', () => {
  let h: Harness;

  beforeEach(() => {
    h = buildHarness();
  });

  afterEach(async () => {
    await h.app.close();
    h.db.close();
  });

  it('rejects a request with no X-API-Key (401)', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/ping' });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
  });

  it('rejects a request with a wrong X-API-Key (401)', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/ping',
      headers: { 'x-api-key': 'nope' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('reaches the ping stub with the right X-API-Key (200)', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/ping',
      headers: { 'x-api-key': KEY },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', version: 1 });
  });

  it('is locked (401) while the stored key is empty, even with a header', async () => {
    h.configStore.set(CONFIG_KEYS.localApiKey, '');
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/ping',
      headers: { 'x-api-key': KEY },
    });
    expect(res.statusCode).toBe(401);
  });

  it('journals every served request as an api_local event (BL-009)', async () => {
    await h.app.inject({ method: 'GET', url: '/api/v1/ping', headers: { 'x-api-key': KEY } });
    await h.app.inject({ method: 'GET', url: '/api/v1/ping' }); // rejected → warn

    const events = h.eventLog.query({ category: 'api_local', page: 1, pageSize: 50 });
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.type === 'local_api_request')).toBe(true);
    // Newest first: the rejected call (warn) then the accepted one (info).
    expect(events[0]?.level).toBe('warn');
    expect(events[1]?.level).toBe('info');
    // Secret-free: the key never appears in a journalled message.
    expect(events.some((e) => e.message.includes(KEY))).toBe(false);
  });

  it('returns a JSON 404 for an unknown path under the prefix', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/nope',
      headers: { 'x-api-key': KEY },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not_found');
  });
});
