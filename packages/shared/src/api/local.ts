/**
 * Local "Layer B" API contract (BL-008, DECISION-022/023).
 *
 * This is the **output** contract: the personal local API this gateway *exposes* (search, product sheet,
 * cart, lists, recipe-fill, price-tracking) so other devices/apps — notably the macronome integration —
 * can query Chronodrive through it. It is distinct from the **upstream** Chronodrive contract we consume
 * (`specifications/api/chronodrive/contract.md`) and from the Phase-4 internal UI API (`./contract.ts`,
 * mounted at `/api/*`).
 *
 * Full endpoint catalogue: `specifications/api/local/contract.md`. BATCH-7 ships only the foundation —
 * the versioned prefix, the `X-API-Key` guard, and a `GET /api/v1/ping` health stub; the data endpoints
 * are added in BATCH-8..10.
 *
 * Security: local-only (Cloudflare Tunnel isolation unchanged), guarded by a single shared key sent in
 * the `X-API-Key` header. The key is **auto-generated and backend-managed** (not user-editable); a
 * missing/wrong key yields HTTP 401. The key itself is never returned by any Layer-B endpoint.
 */

/** Versioned route prefix for the local API, kept separate from the UI `/api/*` and the ESP `POST /v1/scan`. */
export const LOCAL_API_PREFIX = '/api/v1';

/** Request header carrying the shared local-API key (lower-cased, as Fastify normalises header names). */
export const LOCAL_API_KEY_HEADER = 'x-api-key';

/**
 * Error envelope returned by every Layer-B endpoint on a non-2xx outcome. Secret-free: `message` is a
 * short human-readable summary built from safe metadata only (never tokens/cookies/passwords/keys).
 */
export interface LocalApiError {
  error: string;
  /** Optional machine-readable code (e.g. `unauthorized`, `not_found`, `upstream_error`). */
  code?: string;
}

/** `GET /api/v1/ping` response — the BATCH-7 health stub proving the key guard + routing work. */
export interface LocalApiStatus {
  status: 'ok';
  /** Local-API major version (the `/v1` in the prefix). */
  version: number;
}
