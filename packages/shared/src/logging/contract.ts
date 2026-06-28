/**
 * Operational-logging contract (BL-003, DECISION-018).
 *
 * A `LogEvent` is one line of the persisted operational log: an auth exchange, a per-step scan detail,
 * a token refresh, or a system event (self-test, startup, config change, HA alert). These types live in
 * the shared package so the backend (which emits + persists them) and the frontend (the operational-logs
 * page) compile against the same definitions.
 *
 * This is internal journaling, NOT a Chronodrive API behaviour — `contract.md` is unaffected (same
 * rationale as DECISION-016). Every event is secret-free: the `message` and `detail` pass through
 * `logging/redact.ts` before persistence and streaming (contract.md §8) — no token, cookie, password or
 * authorization code ever reaches a `LogEvent`.
 */

/**
 * Broad area a log line belongs to, used by the page filter (Authentification / Scan d'objet / Autre /
 * API Chronodrive / API interne). `other` is the catch-all for everything that is neither auth nor scan
 * (health self-test, startup, config/credentials changes, Home Assistant alerts).
 *
 * The widened local-API surface (BL-009/DECISION-022) adds two categories so the new exchanges are
 * filterable: `chronodrive` = an **upstream** call we make to the Chronodrive API ("API Chronodrive");
 * `api_local` = an **inbound** request served by our own local "Layer B" API ("API interne").
 */
export type LogCategory = 'auth' | 'scan' | 'other' | 'chronodrive' | 'api_local';

/** Severity of a log line. `error` marks a failing step shown prominently on the page. */
export type LogLevel = 'info' | 'warn' | 'error';

/**
 * The specific event kind. Grouped by {@link LogCategory}:
 * - auth:  the three PKCE steps, the captured session, a completed login, the periodic silent refresh,
 *          a full re-login, and a `login_required` (session too old → full re-login needed).
 * - scan:  the ordered steps of one scan — barcode read, search request, product resolved or not found,
 *          each cart/list write, and the terminal outcome.
 * - other: a health self-test run, app startup, a config or credentials change, an HA webhook send, and
 *          the boot-time local-API-key generation.
 * - chronodrive: an upstream Chronodrive query made by the local API (product lookup/search, cart/list
 *          read, price check) — added with BL-009; the call sites land in BATCH-8..10.
 * - api_local: an inbound request served by the local "Layer B" API (the generic per-request line, plus
 *          the recipe-fill composite) — added with BL-009.
 */
export type LogEventType =
  | 'login_step1'
  | 'login_step2'
  | 'login_step3'
  | 'session_captured'
  | 'login_complete'
  | 'silent_refresh'
  | 'full_relogin'
  | 'login_required'
  | 'ean_read'
  | 'search_request'
  | 'product_resolved'
  | 'product_not_found'
  | 'cart_write'
  | 'list_write'
  | 'scan_complete'
  | 'self_test'
  | 'startup'
  | 'config_change'
  | 'credentials_change'
  | 'ha_alert'
  // other: boot-time local-API key generation (BL-008).
  | 'local_api_key_generated'
  // chronodrive (upstream local-API queries; wired in BATCH-8..10).
  | 'product_lookup'
  | 'product_search'
  | 'cart_read'
  | 'list_read'
  | 'price_check'
  // api_local (inbound local-API requests).
  | 'local_api_request'
  | 'recipe_fill';

/**
 * An event as emitted by the application, before it is persisted. The store assigns the `id` and, when
 * `at` is omitted, the timestamp. `detail` is an optional structured payload (redacted before storage).
 */
export interface LogEventInput {
  category: LogCategory;
  type: LogEventType;
  level: LogLevel;
  /** Human-readable, secret-free summary of the step (EANs/endpoints allowed; secrets are not). */
  message: string;
  /** Optional structured context, secret-free (redacted before persistence/stream). */
  detail?: Record<string, unknown>;
  /** Epoch-ms; defaults to the moment the store records it when omitted. */
  at?: number;
}

/** A persisted/streamed log line: a {@link LogEventInput} plus the assigned `id` and resolved `at`. */
export interface LogEvent extends LogEventInput {
  id: number;
  at: number;
}

/**
 * `GET /api/events` envelope: a page of operational-log lines (newest first) plus the total matching the
 * category filter, so the page can render a pager and seed the live tail.
 */
export interface EventsResponse {
  events: LogEvent[];
  /** Total rows matching the category filter (the whole set, not just this page). */
  total: number;
  page: number;
  pageSize: number;
}
