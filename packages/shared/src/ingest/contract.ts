/**
 * Ingestion contract — the synchronous request/response shapes exchanged between the ESP32/ESPHome
 * scanner and the middleware (Phase 3, DECISION-001).
 *
 * These types live in the shared package so the backend (Phase 3) and the frontend (Phase 4) compile
 * against the same definitions. The response is intentionally rich: ESPHome maps `status` (+`reason`)
 * to LED colours and a buzzer pattern without any app change (CLARIFY-04). See
 * `docs/esphome-contract.md` for the firmware-facing mapping.
 */

import type { ErrorCategory, Stock } from '../chronodrive/contract.js';

/** Request body of `POST /api/v1/scan`. The raw barcode as emitted by the scanner. */
export interface ScanRequest {
  ean: string;
}

/**
 * Outcome of a scan, rich enough to drive distinct physical feedback (CLARIFY-04):
 * - `added`               — product found, orderable, written to every enabled destination.
 * - `added_to_lists_only` — found but unavailable (out-of-stock/ineligible): lists written, cart
 *                           skipped (CLARIFY-08). See `reason`.
 * - `duplicate_ignored`   — same EAN repeated inside the debounce window (CLARIFY-07); no action.
 * - `not_found`           — EAN absent from the Chronodrive catalogue (CLARIFY-01).
 * - `partial`             — at least one destination written AND at least one failed.
 * - `error`               — no destination written; a Chronodrive/network failure (see `category`).
 * - `invalid_ean`         — the barcode failed validation; Chronodrive was never queried.
 */
export type ScanStatus =
  | 'added'
  | 'added_to_lists_only'
  | 'duplicate_ignored'
  | 'not_found'
  | 'partial'
  | 'error'
  | 'invalid_ean';

/** Why a found product was kept out of the cart (`added_to_lists_only`). */
export type ScanReason = 'out_of_stock' | 'ineligible';

/** Per-destination outcome, so the firmware/UI can see exactly what happened. */
export interface DestinationResult {
  kind: 'cart' | 'list';
  /** Cart id or list id. */
  id?: string;
  /** Human label: `Panier` for the cart, the list name for a list. */
  name?: string;
  result: 'written' | 'skipped_unavailable' | 'failed';
  /** Short, secret-free explanation when `failed` or `skipped_unavailable`. */
  detail?: string;
}

/** A compact, secret-free product summary echoed back for display/logging. */
export interface ScanProductSummary {
  id: string;
  label?: string;
  brand?: string;
  price?: number;
  stock?: Stock;
  isEligible?: boolean;
}

/** Synchronous response of `POST /api/v1/scan`. ESPHome reads `status` first; the HTTP code is secondary. */
export interface ScanResponse {
  status: ScanStatus;
  ean: string;
  /** Set when `status === 'added_to_lists_only'`. */
  reason?: ScanReason;
  /** Set when `status === 'error' | 'partial'` — the failure category (contract.md §7.1 taxonomy). */
  category?: ErrorCategory;
  product?: ScanProductSummary;
  destinations?: DestinationResult[];
  /** Human-readable, secret-free message (EANs are allowed; tokens/cookies/passwords are not). */
  message?: string;
}

/**
 * The destinations a single scan feeds, edited in the Phase 4 config UI (CLARIFY-02/03). Non-exclusive:
 * the cart and any number of lists can be enabled at once. Persisted as JSON in the SQLite `config`
 * table under the `enabled_destinations` key.
 */
export interface EnabledDestinations {
  /** Whether the active Chronodrive cart receives the scan. */
  cart: boolean;
  /** Shopping lists that receive the scan (id + name, names cached for display). */
  lists: Array<{ id: string; name: string }>;
}

/**
 * One row of the bounded scan journal, as returned by `GET /api/scans` (Phase 4 dashboard/logs).
 * `outcome` holds the {@link ScanStatus} string the scan was recorded under.
 */
export interface ScanRecord {
  id: number;
  /** Epoch-ms the scan was journalled. */
  createdAt: number;
  ean: string;
  outcome: string;
  message: string | null;
}

/**
 * A scan pushed live to the Phase 4 Logs page over SSE (`GET /api/scans/stream`). The pipeline emits
 * one at every terminal outcome it journals (added / lists-only / not-found / error / partial), so the
 * UI shows the same rich detail live that the synchronous scanner received. Debounced repeats are not
 * journalled and therefore not streamed.
 */
export interface ScanEvent {
  /** Epoch-ms the scan completed. */
  at: number;
  /** The full synchronous response produced for this scan. */
  response: ScanResponse;
}
