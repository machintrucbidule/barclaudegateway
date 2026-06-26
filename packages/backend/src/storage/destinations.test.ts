import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EnabledDestinations } from '@barclaudegateway/shared';
import type { Database } from './db.js';
import { openDatabase } from './db.js';
import { ConfigStore } from './config.js';
import {
  DEFAULT_ENABLED_DESTINATIONS,
  DestinationsStore,
  ENABLED_DESTINATIONS_KEY,
} from './destinations.js';

describe('DestinationsStore', () => {
  let db: Database;
  let store: DestinationsStore;
  let configStore: ConfigStore;

  beforeEach(() => {
    db = openDatabase(':memory:');
    configStore = new ConfigStore(db);
    store = new DestinationsStore(configStore);
  });

  afterEach(() => {
    db.close();
  });

  it('returns the safe empty default when nothing is stored', () => {
    expect(store.read()).toEqual(DEFAULT_ENABLED_DESTINATIONS);
  });

  it('round-trips a written value', () => {
    const value: EnabledDestinations = {
      cart: true,
      lists: [{ id: '223e153d-3919-4b4e-ab60-dff0011bf94f', name: 'Temp prochaine courses' }],
    };
    store.write(value);
    expect(store.read()).toEqual(value);
  });

  it('falls back to the default on corrupt JSON instead of throwing', () => {
    configStore.set(ENABLED_DESTINATIONS_KEY, '{not valid json');
    expect(store.read()).toEqual(DEFAULT_ENABLED_DESTINATIONS);
  });

  it('falls back to the default on a structurally invalid payload', () => {
    configStore.set(ENABLED_DESTINATIONS_KEY, JSON.stringify({ cart: 'yes', lists: 'nope' }));
    expect(store.read()).toEqual(DEFAULT_ENABLED_DESTINATIONS);
  });
});
