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
    products: string;
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
  /**
   * Auth-token lifecycle policy (BL-006): `lazy` authenticates only when a scan needs it (fewer
   * background calls); `keepalive` keeps the token warm with a ~2h refresh timer (snappier scans).
   */
  authMode: 'lazy' | 'keepalive';
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
  /**
   * BL-007: `true` when the live list set was deliberately NOT fetched (lazy mode + no live session) —
   * the cached/known lists are shown and a manual refresh is offered, so opening the config page never
   * forces a login while idle. Distinct from `listsError`, which signals a real failure.
   */
  listsIdle?: boolean;
}

/**
 * `GET /api/scans` envelope (BL-004): one page of the scan history (newest first) plus the pagination
 * metadata. `total` is the number of rows matching the active status/search filter (the whole set, not
 * just this page); `pageSize` is the requested page size (the sentinel {@link SCANS_PAGE_SIZE_ALL} means
 * "all matching rows on a single page").
 */
export interface ScansResponse {
  scans: ScanRecord[];
  total: number;
  page: number;
  pageSize: number;
}

/** Page-size sentinel for "all matching rows" (BL-004 page-size selector option "all"). */
export const SCANS_PAGE_SIZE_ALL = 'all';

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
