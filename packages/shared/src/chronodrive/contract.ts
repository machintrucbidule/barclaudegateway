/**
 * Chronodrive private-API contract types.
 *
 * These are the typed shapes of the requests and responses confirmed in
 * `specifications/api/chronodrive/contract.md`. They live in the shared package so both the backend
 * (Phase 2) and the frontend (Phase 4) compile against the same definitions — an API change then
 * fails at compile time rather than silently at runtime (DECISION-002 rationale).
 *
 * Faithfulness over completeness: only fields the middleware reads are modelled. Unmodelled fields
 * are tolerated at runtime (responses are not exhaustively validated).
 */

// ---------------------------------------------------------------------------------------------
// §2 — Authentication (Reach5 PKCE)
// ---------------------------------------------------------------------------------------------

/** §2.2 — Response of `POST /identity/v1/password/login`. */
export interface PasswordLoginResponse {
  /** Short-lived, single-use Reach5 session token used to complete the PKCE flow. */
  tkn: string;
}

/** §2.4 — Response of `POST /oauth/token`. No `refresh_token` is issued (see §2.4 note). */
export interface OAuthTokenResponse {
  id_token: string;
  access_token: string;
  /** Seconds until the access token expires (observed: 7200). The JWT `exp` claim is authoritative. */
  expires_in: number;
  token_type: string;
}

/** Reach5/OAuth error body (e.g. `login_required` when the session cookie is too old). */
export interface OAuthErrorResponse {
  error: string;
  error_description?: string;
}

// ---------------------------------------------------------------------------------------------
// §5 — Catalogue / cart / shopping lists
// ---------------------------------------------------------------------------------------------

/**
 * Stock availability of a product at the configured drive.
 * `HIGH_STOCK` and `NO_STOCK` are CONFIRMED; `LOW_STOCK` is INFERRED (contract.md §5.1, §5.10).
 */
export type Stock = 'HIGH_STOCK' | 'LOW_STOCK' | 'NO_STOCK';

export interface ProductLabels {
  productLabel?: string;
  brandLabel?: string;
  unitQuantityLabel?: string;
  ticketLabel?: string;
}

/** A product as returned by search-suggestions (§5.1) and list contents (§5.10). */
export interface Product {
  id: string;
  labels: ProductLabels;
  eans: string[];
  prices?: { defaultPrice?: number };
  remainingStock?: number;
  stock?: Stock;
  /** `false` = the product exists but is unavailable at the configured `site_id`. */
  isEligible?: boolean;
  maxCartQuantity?: number;
  flags?: Record<string, boolean>;
}

/** §5.1 — `GET /v1/search-suggestions?searchTerm={ean}`. Empty `products` = EAN not in catalogue. */
export interface SearchSuggestionsResponse {
  keywords: string[];
  products: Product[];
  categories: unknown[];
}

/** §5.2 — `GET /v1/customers/me`. `lastVisitedSite.id` is the dynamic `site_id`. */
export interface CustomerResponse {
  id?: string;
  email?: string;
  lastVisitedSite?: { id: number | string };
}

/** A line in the active cart. */
export interface CartItem {
  productId: string;
  quantity: number;
}

/** §5.3 — `GET /v1/customers/me/carts`. The active cart is `content[0]` with `isOrdered: false`. */
export interface ActiveCartResponse {
  content: Array<{
    id: string;
    items: CartItem[];
    amounts?: { totalCartAmount?: number; totalOrderAmount?: number };
    isOrdered: boolean;
  }>;
}

/** §5.4–5.6 — `POST /v1/carts/{cartId}/items`. `quantity` is a SIGNED DELTA, never an absolute. */
export interface CartItemMutationRequest {
  content: Array<{
    clientOrigin: string;
    productId: string;
    quantity: number;
  }>;
  optimizedMode: boolean;
}

/** Per-product result of a cart mutation. `returnType` must equal `"SUCCESS"`. */
export interface CartItemMutationResult {
  productId: string;
  /** Resulting absolute quantity after applying the delta (0 = removed from cart). */
  quantity: number;
  wishedQuantity?: number;
  remainingStock?: number;
  requestedQuantity?: number;
  returnType: string;
}

export interface CartItemMutationResponse {
  content: CartItemMutationResult[];
}

/** A shopping list summary (§5.7) or single-list response (§5.11). */
export interface ShoppingList {
  id: string;
  name: string;
  nbItems: number;
  hasAvailableProduct: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Page {
  size: number;
  totalElements: number;
  totalPages: number;
  number: number;
  hasNext: boolean;
  hasPrevious: boolean;
  isEmpty: boolean;
}

/** §5.7 — `GET /v1/shopping-lists`. */
export interface ShoppingListsResponse {
  content: ShoppingList[];
  page: Page;
}

/** §5.8–5.9 — `PATCH /v1/shopping-lists/{listId}`. Responds 204 No Content. */
export interface ShoppingListPatchRequest {
  objectsToAdd?: Array<{ productId: string; quantity: number }>;
  objectsToRemove?: Array<{ productId: string }>;
}

/** §5.10 — `GET /v1/shopping-lists/{listId}/products`. */
export interface ShoppingListContentsResponse {
  content: Array<{ quantity: number; product: Product }>;
  page: Page;
}

// ---------------------------------------------------------------------------------------------
// §3 — Per-service API keys
// ---------------------------------------------------------------------------------------------

/**
 * Logical service buckets, each with its own static `x-api-key` (contract.md §3.1). If Chronodrive
 * rotates a key, only the matching service's calls break — the bucket pins the blast radius.
 */
export type XApiKeyService = 'SEARCH' | 'CUSTOMER_CART_READ' | 'CART_WRITE' | 'SHOPPING_LISTS';

// ---------------------------------------------------------------------------------------------
// Error classification (consumed by the backend error model and the Phase 5 detection UI)
// ---------------------------------------------------------------------------------------------

/**
 * How an API failure is classified, mapped to the symptom table in contract.md §7.1. Phase 5 turns
 * these into maintenance-page states and Home Assistant alerts.
 */
export type ErrorCategory =
  | 'auth' // 401 across the board / auth step failed / session expired
  | 'api_key' // 401/403 isolated to one x-api-key service → key rotated
  | 'schema' // 200 but unexpected shape → endpoint changed
  | 'not_found' // product/list not found (business-level, not a breakage)
  | 'rate_limit' // 429
  | 'server' // 5xx
  | 'network' // connection refused/reset/DNS
  | 'timeout' // request exceeded its deadline
  | 'unknown';

/** Snapshot of `x-api-version` headers seen per endpoint (contract.md §7.4 monitors these). */
export type XApiVersions = Record<string, string>;

// ---------------------------------------------------------------------------------------------
// Health self-test (contract.md §7.1) — produced by the backend, consumed by the Phase 4 dashboard
// ---------------------------------------------------------------------------------------------

export type HealthStatus = 'ok' | 'error';

/** Result of probing one read-only endpoint, including the observed `x-api-version`. */
export interface EndpointCheck {
  name: string;
  endpoint: string;
  status: HealthStatus;
  apiVersion?: string;
  detail: string;
  /**
   * Failure classification when `status === 'error'` and the cause was a classified Chronodrive
   * failure. Lets the Phase 5 error monitor decide whether the breakage is critical.
   */
  category?: ErrorCategory;
}

/** Aggregate result of the read-only self-test. `ok` is true only when every check passed. */
export interface HealthReport {
  ok: boolean;
  siteId?: string;
  checks: EndpointCheck[];
  apiVersions: XApiVersions;
  checkedAt: number;
}
