/**
 * Phase 4 local-UI API contract (`/api/*`).
 *
 * These are the request/response shapes exchanged between the React UI and the Fastify backend. They
 * live in the shared package so both sides compile against the same definitions. Security rule
 * (contract.md §8): credentials are write-only — the password is never serialised back to the browser;
 * only a `set` flag is exposed. The per-service `x-api-key`s are NOT secret (they ship in Chronodrive's
 * public bundle) and are returned/edited normally.
 */

import type { ErrorCategory, ShoppingList } from '../chronodrive/contract.js';
import type { EnabledDestinations, ScanRecord } from '../ingest/contract.js';

/** Static Chronodrive API parameters, editable in the config page. Mirrors the backend's stored config. */
export interface ApiConfig {
  clientId: string;
  redirectUri: string;
  scope: string;
  identityBaseUrl: string;
  apiBaseUrl: string;
  apiKeys: {
    search: string;
    customerCartRead: string;
    cartWrite: string;
    shoppingLists: string;
  };
  siteMode: string;
  /** Optional `x-chronodrive-site-id` override; empty string = dynamic detection. */
  siteId: string;
  /**
   * Optional Home Assistant webhook URL (Phase 5). Empty by default: when set, a critical API error
   * POSTs a secret-free alert there so the user is notified without watching the UI (CLARIFY-05).
   */
  haWebhookUrl: string;
}

/** `GET /api/config`: the editable params plus a write-only credentials indicator (never the password). */
export interface ConfigResponse extends ApiConfig {
  credentials: { set: boolean };
}

/** `PUT /api/credentials` body. Write-only: stored encrypted, never echoed back. */
export interface CredentialsInput {
  email: string;
  password: string;
}

/** `GET /api/config/destinations`: the saved set plus the live choices needed to render every checkbox. */
export interface DestinationsResponse {
  enabled: EnabledDestinations;
  available: {
    cart: { name: string };
    lists: ShoppingList[];
  };
  /** Present when the live shopping-list fetch failed (e.g. no credentials configured yet). */
  listsError?: { category: string; message: string };
}

/** `GET /api/scans` envelope: total journalled count plus the most recent rows (newest first). */
export interface ScansResponse {
  count: number;
  scans: ScanRecord[];
}

/**
 * A critical API breakage observed by the backend error monitor (Phase 5). Secret-free: the
 * `message` is built from safe metadata only (status, endpoint), never tokens/cookies/passwords.
 */
export interface ErrorStateError {
  category: ErrorCategory;
  /** Endpoint label the failure relates to, when known (no query secrets). */
  endpoint?: string;
  message: string;
  /** Observed `x-api-version`, when the failing source is the health self-test. */
  apiVersion?: string;
  /** Epoch-ms the error was recorded. */
  at: number;
}

/**
 * `GET /api/error-state` (and the `/api/error-state/stream` SSE payload): whether a critical error is
 * currently active. `active` is false when the surface has auto-cleared after a recovery.
 */
export interface ErrorState {
  active: boolean;
  error?: ErrorStateError;
}
