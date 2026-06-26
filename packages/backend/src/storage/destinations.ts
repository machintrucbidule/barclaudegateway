/**
 * Read/write the enabled-scan-destinations config (CLARIFY-02/03).
 *
 * A single scan feeds every enabled destination — the cart and/or any number of shopping lists. The
 * set is stored as JSON in the existing `config` table under one key, so it survives restarts and is
 * editable by the Phase 4 UI. Phase 3 needs the read side plus a minimal setter (used by tests and a
 * seed); the full checkbox editor is Phase 4.
 *
 * Default is the safe empty set `{ cart: false, lists: [] }` — nothing is touched until the user
 * explicitly enables a destination, so a fresh install never adds to the real cart by accident.
 */

import type { EnabledDestinations } from '@barclaudegateway/shared';
import type { ConfigStore } from './config.js';

/** Config-table key holding the JSON-encoded {@link EnabledDestinations}. */
export const ENABLED_DESTINATIONS_KEY = 'enabled_destinations';

export const DEFAULT_ENABLED_DESTINATIONS: EnabledDestinations = { cart: false, lists: [] };

function isValid(value: unknown): value is EnabledDestinations {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.cart !== 'boolean') return false;
  if (!Array.isArray(candidate.lists)) return false;
  return candidate.lists.every(
    (l) =>
      typeof l === 'object' &&
      l !== null &&
      typeof (l as Record<string, unknown>).id === 'string' &&
      typeof (l as Record<string, unknown>).name === 'string',
  );
}

export class DestinationsStore {
  constructor(private readonly configStore: ConfigStore) {}

  /** Current enabled destinations, falling back to the safe empty default if unset or corrupt. */
  read(): EnabledDestinations {
    const raw = this.configStore.get(ENABLED_DESTINATIONS_KEY);
    if (raw === undefined) return { ...DEFAULT_ENABLED_DESTINATIONS };
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isValid(parsed)) return parsed;
    } catch {
      // Corrupt JSON falls through to the safe default rather than crashing the scan pipeline.
    }
    return { ...DEFAULT_ENABLED_DESTINATIONS };
  }

  /** Persist the enabled destinations (used by the Phase 4 UI and by tests/seeds). */
  write(destinations: EnabledDestinations): void {
    this.configStore.set(ENABLED_DESTINATIONS_KEY, JSON.stringify(destinations));
  }
}
