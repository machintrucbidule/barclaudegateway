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

/** One coded characteristic (§5.12.1). `value` is a string for nutrients, a boolean for label flags. */
export interface ProductFeature {
  code: string;
  value: string | boolean;
}

/** §5.12 product prices (extended in 1.5.0). All optional — the scan path only reads `defaultPrice`. */
export interface ProductPrices {
  defaultPrice?: number;
  /** €/kg or €/L. */
  pricePerUnitMeasure?: number;
  /** EU "lowest price in the last 30 days" — useful for price-drop detection. */
  lastPeriodLowestPrice?: number;
  vatRate?: number;
  depositPrice?: number;
  /** §5.3 cart line: the line total (`defaultPrice × quantity`), present on a populated cart's items. */
  totalAmount?: number;
  /** §5.3 cart line: the line's total deposit (consigne). */
  totalDepositAmount?: number;
}

/** §5.12 packaging block. `weight`/`unitMeasure` are in `unit` (kg or L). */
export interface ProductPackaging {
  unit?: string;
  unitMeasure?: number;
  /** Net weight in `unit` (e.g. 0.125 kg). */
  weight?: number;
}

/** §5.12 relative image paths (prefix with `https://static1.chronodrive.com/`). */
export interface ProductImages {
  thumbnails?: string[];
  views?: string[];
  zooms?: string[];
}

/** §5.12 composition. `features[]` carries coded nutrition (§5.12.1); `allergens` is often `[]`. */
export interface ProductCharacteristics {
  origin?: string;
  ingredients?: string;
  allergens?: string[];
  features?: ProductFeature[];
}

/**
 * A product as returned by search-suggestions (§5.1) and list contents (§5.10), and — with the
 * extended fields below populated — by the Products service (§5.12/§5.13/§5.14, 1.5.0). All extended
 * fields are optional, so the lightweight `/search-suggestions` and scan-path usages are unaffected.
 */
export interface Product {
  id: string;
  labels: ProductLabels;
  eans: string[];
  prices?: ProductPrices;
  remainingStock?: number;
  stock?: Stock;
  /** `false` = the product exists but is unavailable at the configured `site_id`. */
  isEligible?: boolean;
  maxCartQuantity?: number;
  flags?: Record<string, boolean>;
  /** §5.12: net weight / packaging. */
  packaging?: ProductPackaging;
  /** §5.12: relative image paths. */
  images?: ProductImages;
  /** §5.12: ingredients, allergens, origin, and the coded nutrition `features[]` (§5.12.1). */
  characteristics?: ProductCharacteristics;
}

/** §5.13/§5.14 — `GET /v1/products?searchTerm=` (paginated) / `?ids=` (batch). `content[]` are full products. */
export interface ProductsSearchResponse {
  page: Page;
  content: Product[];
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

/**
 * A line in the active cart. An empty cart has `items: []`; a populated cart (§5.3 non-empty schema,
 * 1.5.0) carries the full §5.12 `product` per line (incl. nutrition `features`) plus the per-line
 * `prices.totalAmount`. `productId`/`quantity` are kept for the lightweight historical shape.
 */
export interface CartLineItem {
  quantity: number;
  wishedQuantity?: number;
  /** Present on the populated cart schema (the product id is `product.id`). */
  productId?: string;
  product?: Product;
}

/** Cart-level totals (§5.3 `amounts`) — the budget view. All optional. */
export interface CartAmounts {
  totalCartAmount?: number;
  totalOrderAmount?: number;
  totalCartAmountWithoutDiscount?: number;
  totalDiscountAmount?: number;
  totalDepositAmount?: number;
  totalLoyaltyEarnedAmount?: number;
}

/** §5.3 — `GET /v1/customers/me/carts`. The active cart is `content[0]` with `isOrdered: false`. */
export interface ActiveCartResponse {
  content: Array<{
    id: string;
    items: CartLineItem[];
    amounts?: CartAmounts;
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
export type XApiKeyService =
  | 'SEARCH'
  | 'PRODUCTS'
  | 'CUSTOMER_CART_READ'
  | 'CART_WRITE'
  | 'SHOPPING_LISTS';

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
  | 'not_configured' // no Chronodrive credentials saved yet → not an error, just unconfigured
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
  /**
   * Whether Chronodrive credentials are saved. `false` means the self-test was skipped entirely (no
   * connection attempted) because nothing is configured yet — an informational state, not a failure.
   * Absent/true means credentials are present and the checks ran.
   */
  configured?: boolean;
  /**
   * `true` when the self-test was skipped because the auth policy is `lazy` and there is no live
   * session (BL-006) — no connection was attempted; an informational "dormant while idle" state, not
   * a failure. Absent in keep-alive mode and whenever the checks actually ran.
   */
  idle?: boolean;
  siteId?: string;
  checks: EndpointCheck[];
  apiVersions: XApiVersions;
  checkedAt: number;
}
