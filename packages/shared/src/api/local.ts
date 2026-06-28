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

// ---------------------------------------------------------------------------------------------
// BATCH-8 (BL-010) — products & nutrition (the macronome cluster)
// ---------------------------------------------------------------------------------------------

/**
 * Normalized nutrition for a product (the essential set, upstream contract.md §5.12.1). Values are
 * per the `base` (observed `"100 g"`); a field is **absent** when the manufacturer did not declare it.
 */
export interface ProductNutrition {
  /** Reference base for the values, e.g. `"100 g"` (code 563). */
  base?: string;
  energyKj?: number;
  energyKcal?: number;
  /** Fat (lipides), g. */
  fat?: number;
  /** Of which saturates, g. */
  saturates?: number;
  /** Carbohydrate (glucides), g. */
  carbohydrate?: number;
  /** Of which sugars, g. */
  sugars?: number;
  fibre?: number;
  /** Protein (protéines), g. */
  protein?: number;
  /** Salt (sel), g. */
  salt?: number;
  /** Nutri-Score grade `A`–`E` (code 520). */
  nutriScore?: string;
  /** Allergen statement, free text (code 383). */
  allergens?: string;
  /** Origin, free text (code 759). */
  origin?: string;
}

/** Absolute product image URLs (relative §5.12 paths prefixed with the static media host). */
export interface ProductImageUrls {
  thumbnails: string[];
  views: string[];
  zooms: string[];
}

/** Normalized price block (€), from upstream §5.12 `prices`. */
export interface ProductPrice {
  default?: number;
  /** €/kg or €/L. */
  perUnitMeasure?: number;
  /** EU "lowest price in the last 30 days". */
  lastPeriodLowest?: number;
  vatRate?: number;
}

/** Shared identity/availability fields between the lean summary and the full sheet. */
interface ProductBase {
  id: string;
  eans: string[];
  /** Product label, e.g. "Mozzarella di bufala campana AOP". */
  name?: string;
  brand?: string;
  /** Human net quantity, e.g. "125 g". */
  unitQuantityLabel?: string;
  /** Net weight in kg (from §5.12 `packaging.weight`). */
  weightKg?: number;
  price: ProductPrice;
  stock?: string;
  remainingStock?: number;
  isEligible?: boolean;
}

/** `GET /api/v1/products/{eanOrId}` — the full normalized product sheet (with nutrition + ingredients). */
export interface NormalizedProduct extends ProductBase {
  nutrition: ProductNutrition;
  ingredients?: string;
  images: ProductImageUrls;
}

/** A lean search-result item (no nutrition/ingredients — fetch the sheet for those). */
export interface ProductSummary extends ProductBase {
  /** One representative image URL (first `views`, else first `thumbnails`), when available. */
  image?: string;
}

/** Pagination echoed from upstream §5.13. */
export interface ProductSearchPage {
  number: number;
  size: number;
  totalElements: number;
  totalPages: number;
  hasNext: boolean;
}

/** `GET /api/v1/search?q=` — a page of product summaries. */
export interface ProductSearchResponse {
  products: ProductSummary[];
  page: ProductSearchPage;
}

// ---------------------------------------------------------------------------------------------
// BATCH-9 (BL-011) — cart, lists, recipe-fill (UC1/5/6/9/10)
// ---------------------------------------------------------------------------------------------

/** One line of the normalized cart or list: a quantity + the product summary + the line total. */
export interface NormalizedCartLine {
  quantity: number;
  product: ProductSummary;
  /** Line total in € (`defaultPrice × quantity`), when upstream provided it. */
  lineTotal?: number;
}

/** Cart-level totals (the budget view), projected from upstream §5.3 `amounts`. */
export interface CartTotals {
  cartAmount?: number;
  orderAmount?: number;
  discountAmount?: number;
  depositAmount?: number;
  loyaltyEarned?: number;
}

/** `GET /api/v1/cart` — the current cart: line items + totals. */
export interface NormalizedCart {
  id: string;
  items: NormalizedCartLine[];
  totals: CartTotals;
}

/**
 * `GET /api/v1/cart/nutrition` — the budget + nutrition aggregate (UC10). `totalPrice` is the cart total
 * (authoritative, from `amounts`); the `nutrition` macros are summed across lines as
 * `per-100g × (weightKg × 10) × quantity`. A line missing weight **or** nutrition is counted in
 * `incompleteLines` and excluded from the macro sum (still counted toward the price).
 */
export interface CartNutritionAggregate {
  totalPrice?: number;
  lineCount: number;
  /** Lines that could not contribute macros (no net weight or no declared nutrition). */
  incompleteLines: number;
  nutrition: ProductNutrition;
}

/**
 * How a write designates a product (BL-011, DECISION-025). Provide exactly one of `id` / `ean` / `name`
 * (priority `id` → `ean` → `name`); a `name` resolves to the first `/search` hit. `quantity` is a signed
 * delta for the cart (default `+1`); for a list it is the desired quantity.
 */
export interface ItemRef {
  id?: string;
  ean?: string;
  name?: string;
  quantity?: number;
}

/** Per-item outcome of resolving an {@link ItemRef} to a Chronodrive product id. */
export interface ItemResolution {
  ref: ItemRef;
  status: 'resolved' | 'not_found';
  productId?: string;
  /** The matched product label (helps the caller confirm a fuzzy `name` match). */
  matchedName?: string;
}

/** `POST /api/v1/cart/items` / `POST /api/v1/lists/{id}/items` body. */
export interface ItemsRequest {
  items: ItemRef[];
}

/** `DELETE /api/v1/lists/{id}/items` body — product ids to remove. */
export interface ListItemsDeleteRequest {
  ids: string[];
}

/** `POST /api/v1/cart/items` response: what resolved + the deltas applied. */
export interface CartWriteResult {
  resolutions: ItemResolution[];
  applied: Array<{ productId: string; quantity: number }>;
}

/** `POST|DELETE /api/v1/lists/{id}/items` response. */
export interface ListWriteResult {
  resolutions: ItemResolution[];
  applied: string[];
}

/** A shopping-list summary as exposed by `GET /api/v1/lists` (mirrors upstream `ShoppingList`). */
export interface ListSummary {
  id: string;
  name: string;
  nbItems: number;
  hasAvailableProduct: boolean;
}

/** `GET /api/v1/lists/{id}` — a list with its (first page of) contents. */
export interface NormalizedList {
  id: string;
  name: string;
  items: NormalizedCartLine[];
  page: ProductSearchPage;
}

/** `POST /api/v1/recipe-fill` body: resolve a set of items into either the cart or a named list. */
export interface RecipeFillRequest {
  target: { cart: true } | { listId: string };
  items: ItemRef[];
}

/** `POST /api/v1/recipe-fill` response. */
export interface RecipeFillResult {
  target: { cart: true } | { listId: string };
  resolutions: ItemResolution[];
  /** Count of items actually pushed to the target. */
  added: number;
}
