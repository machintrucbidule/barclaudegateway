import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LogEvent } from '@barclaudegateway/shared';
import type { Database } from '../storage/db.js';
import { openDatabase } from '../storage/db.js';
import { EventLog } from '../storage/eventLog.js';
import { EventLogBus } from './eventLogBus.js';
import { EventLogger } from './eventLogger.js';

describe('EventLogger', () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('persists an event AND publishes the stored (id-bearing) event to the bus', () => {
    const store = new EventLog(db);
    const bus = new EventLogBus();
    const logger = new EventLogger(store, bus);

    const published: LogEvent[] = [];
    bus.subscribe((e) => published.push(e));

    logger.record({ category: 'auth', type: 'login_complete', level: 'info', message: 'ok' });

    expect(store.count()).toBe(1);
    expect(published).toHaveLength(1);
    expect(published[0]?.id).toBeGreaterThan(0);
    expect(published[0]?.type).toBe('login_complete');
  });

  it('redacts secrets in the detail before storage and streaming (contract.md §8)', () => {
    const store = new EventLog(db);
    const bus = new EventLogBus();
    const logger = new EventLogger(store, bus);

    const published: LogEvent[] = [];
    bus.subscribe((e) => published.push(e));

    logger.record({
      category: 'auth',
      type: 'login_step3',
      level: 'info',
      message: 'token exchanged',
      detail: { access_token: 'SECRET-TOKEN', cookie: 'sess=abc', endpoint: 'POST /oauth/token' },
    });

    const stored = store.query({ page: 1, pageSize: 10 })[0];
    expect(stored?.detail).toMatchObject({
      access_token: '[REDACTED]',
      cookie: '[REDACTED]',
      endpoint: 'POST /oauth/token',
    });
    expect(JSON.stringify(stored)).not.toContain('SECRET-TOKEN');
    expect(JSON.stringify(published[0])).not.toContain('SECRET-TOKEN');
  });
});
