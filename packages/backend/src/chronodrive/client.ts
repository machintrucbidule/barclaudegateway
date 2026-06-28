/**
 * Typed Chronodrive API client (contract.md §3–§5).
 *
 * Wraps the confirmed operations behind typed methods, injecting the per-service `x-api-key`, the
 * dynamic `x-chronodrive-site-id`, and the browser-origin headers the gateway expects (`Origin`/
 * `Referer` — required by the auth host and sent defensively here too, per the 2026-06-26 live
 * finding, contract.md §3). The access token is fetched per call from an injected provider (the
 * token lifecycle), so refreshes are transparent. Observed `x-api-version` values are recorded so
 * Phase 5 can detect Chronodrive deploys.
 */

import type {
  ActiveCartResponse,
  CartItemMutationResponse,
  CartItemMutationResult,
  CustomerResponse,
  Product,
  ProductsSearchResponse,
  SearchSuggestionsResponse,
  ShoppingList,
  ShoppingListContentsResponse,
  ShoppingListsResponse,
  XApiKeyService,
  XApiVersions,
} from '@barclaudegateway/shared';
import type { AppConfig } from '../config/defaults.js';
import type { HttpClient, HttpResponse } from '../http/client.js';
import {
  ApiKeyError,
  AuthError,
  ChronodriveError,
  NotFoundError,
  SchemaError,
} from '../http/errors.js';

/** Tracking string accepted verbatim by the cart endpoint (contract.md §5.4). */
const CART_CLIENT_ORIGIN = 'WEB|ARBO|{id}';

/** A known-stable EAN used by the read-only health self-test (contract.md §5.1 example). */
export const HEALTH_CHECK_EAN = '3183280000933';

export type TokenProvider = () => Promise<string>;

export interface ChronodriveClientDeps {
  http: HttpClient;
  config: AppConfig;
  getToken: TokenProvider;
  /** Pre-seed the site id to skip the lookup (tests). */
  siteId?: string;
}

function apiKeyFor(config: AppConfig, service: XApiKeyService): string {
  switch (service) {
    case 'SEARCH':
      return config.apiKeys.search;
    case 'PRODUCTS':
      return config.apiKeys.products;
    case 'CUSTOMER_CART_READ':
      return config.apiKeys.customerCartRead;
    case 'CART_WRITE':
      return config.apiKeys.cartWrite;
    case 'SHOPPING_LISTS':
      return config.apiKeys.shoppingLists;
  }
}

export class ChronodriveClient {
  private readonly http: HttpClient;
  private readonly config: AppConfig;
  private readonly getToken: TokenProvider;
  private readonly origin: string;
  private siteId: string | undefined;
  private readonly apiVersions: Map<string, string> = new Map();

  constructor(deps: ChronodriveClientDeps) {
    this.http = deps.http;
    this.config = deps.config;
    this.getToken = deps.getToken;
    this.origin = new URL(deps.config.redirectUri).origin;
    this.siteId = deps.siteId;
  }

  /** Snapshot of the latest `x-api-version` seen per endpoint (contract.md §7.4). */
  getApiVersions(): XApiVersions {
    return Object.fromEntries(this.apiVersions);
  }

  private url(path: string): string {
    return `${this.config.apiBaseUrl}${path}`;
  }

  private async buildHeaders(
    service: XApiKeyService,
    withSite: boolean,
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${await this.getToken()}`,
      'x-device-type': 'WEB',
      'x-api-key': apiKeyFor(this.config, service),
      origin: this.origin,
      referer: `${this.origin}/`,
    };
    if (withSite) {
      headers['x-chronodrive-site-id'] = await this.getSiteId();
      headers['x-chronodrive-site-mode'] = this.config.siteMode;
    }
    return headers;
  }

  private record<T>(endpoint: string, res: HttpResponse<T>): HttpResponse<T> {
    if (res.apiVersion) this.apiVersions.set(endpoint, res.apiVersion);
    return res;
  }

  /** Classify a non-OK status into the error taxonomy (contract.md §7.1). */
  private check<T>(
    res: HttpResponse<T>,
    endpoint: string,
    okStatuses: number[] = [200],
  ): HttpResponse<T> {
    if (okStatuses.includes(res.status)) return res;
    switch (res.status) {
      case 401:
        throw new AuthError(`Unauthorized on ${endpoint} (token expired or auth changed)`, {
          status: 401,
          endpoint,
        });
      case 403:
        throw new ApiKeyError(`Forbidden on ${endpoint} (x-api-key rotated?)`, {
          status: 403,
          endpoint,
        });
      case 404:
        throw new NotFoundError(`Not found: ${endpoint}`, { status: 404, endpoint });
      default:
        throw new ChronodriveError('unknown', `Unexpected status ${res.status} from ${endpoint}`, {
          status: res.status,
          endpoint,
        });
    }
  }

  // ---- §5.2 customer + dynamic site id ---------------------------------------------------------

  /** §5.2 — Customer profile. */
  async getCustomer(): Promise<CustomerResponse> {
    const endpoint = 'GET /customers/me';
    const res = this.record(
      endpoint,
      await this.http.requestJson<CustomerResponse>(this.url('/customers/me'), {
        endpoint,
        headers: await this.buildHeaders('CUSTOMER_CART_READ', false),
      }),
    );
    return this.check(res, endpoint).data;
  }

  /** Dynamic `site_id` from `lastVisitedSite.id` (cached after first lookup, §4). */
  async getSiteId(): Promise<string> {
    if (this.siteId !== undefined) return this.siteId;
    const customer = await this.getCustomer();
    const id = customer.lastVisitedSite?.id;
    if (id === undefined || id === null) {
      throw new SchemaError('No lastVisitedSite.id in /customers/me', {
        endpoint: 'GET /customers/me',
      });
    }
    this.siteId = String(id);
    return this.siteId;
  }

  // ---- §5.1 search ----------------------------------------------------------------------------

  /** §5.1 — Resolve an EAN to its product, or `null` if the catalogue has no match. */
  async resolveEan(ean: string): Promise<Product | null> {
    const endpoint = 'GET /search-suggestions';
    const res = this.record(
      endpoint,
      await this.http.requestJson<SearchSuggestionsResponse>(this.url('/search-suggestions'), {
        endpoint,
        query: { searchTerm: ean },
        headers: await this.buildHeaders('SEARCH', true),
      }),
    );
    this.check(res, endpoint);
    return res.data.products?.[0] ?? null;
  }

  // ---- §5.12–5.14 products (full sheet / search / batch) --------------------------------------

  /** §5.12 — Full product sheet by Chronodrive product id (nutrition, weight, prices, images). */
  async getProduct(id: string): Promise<Product> {
    const endpoint = 'GET /products/{id}';
    const res = this.record(
      endpoint,
      await this.http.requestJson<Product>(this.url(`/products/${encodeURIComponent(id)}`), {
        endpoint,
        headers: await this.buildHeaders('PRODUCTS', true),
      }),
    );
    return this.check(res, endpoint).data;
  }

  /** §5.13 — Rich paginated catalogue search; `content[]` are full product objects. */
  async searchProducts(searchTerm: string, page = 1, size = 20): Promise<ProductsSearchResponse> {
    const endpoint = 'GET /products?searchTerm';
    const res = this.record(
      endpoint,
      await this.http.requestJson<ProductsSearchResponse>(this.url('/products'), {
        endpoint,
        query: { searchTerm, page, size },
        headers: await this.buildHeaders('PRODUCTS', true),
      }),
    );
    return this.check(res, endpoint).data;
  }

  /** §5.13 — Resolve an EAN to its full product in one call, or `null` if not in the catalogue. */
  async getProductByEan(ean: string): Promise<Product | null> {
    const res = await this.searchProducts(ean, 1, 1);
    return res.content?.[0] ?? null;
  }

  /**
   * §5.14 — Batch fetch full products by id (repeated `?ids=` params). The shared HTTP client's `query`
   * is single-valued, so the repeated-id query string is built here. Returns `[]` for an empty input.
   */
  async getProductsByIds(ids: string[]): Promise<Product[]> {
    if (ids.length === 0) return [];
    const endpoint = 'GET /products?ids';
    const qs = ids.map((id) => `ids=${encodeURIComponent(id)}`).join('&');
    const res = this.record(
      endpoint,
      await this.http.requestJson<ProductsSearchResponse | Product[]>(this.url(`/products?${qs}`), {
        endpoint,
        headers: await this.buildHeaders('PRODUCTS', true),
      }),
    );
    this.check(res, endpoint);
    // §5.14 returns a list of products; tolerate either a bare array or a `{ content }` envelope.
    const data = res.data;
    return Array.isArray(data) ? data : (data.content ?? []);
  }

  // ---- §5.3–5.6 cart --------------------------------------------------------------------------

  /** §5.3 — Active cart (the `content[0]` entry with `isOrdered: false`). */
  async getActiveCart(): Promise<ActiveCartResponse> {
    const endpoint = 'GET /customers/me/carts';
    const res = this.record(
      endpoint,
      await this.http.requestJson<ActiveCartResponse>(this.url('/customers/me/carts'), {
        endpoint,
        query: { withCoupons: true },
        headers: await this.buildHeaders('CUSTOMER_CART_READ', true),
      }),
    );
    return this.check(res, endpoint).data;
  }

  /** Resolve the active cart's id, throwing if none is open. */
  async getActiveCartId(): Promise<string> {
    const cart = await this.getActiveCart();
    const active = cart.content?.find((c) => !c.isOrdered) ?? cart.content?.[0];
    if (!active) throw new NotFoundError('No active cart', { endpoint: 'GET /customers/me/carts' });
    return active.id;
  }

  /**
   * §5.4–5.6 — Apply SIGNED DELTAS to one or more cart lines in a single batch call (`+1` adds, `-1`
   * removes, reaching 0 deletes the line). Never an absolute quantity. Returns each line's result and
   * throws if any line is not `SUCCESS`.
   */
  async updateCartItems(
    cartId: string,
    items: Array<{ productId: string; quantity: number }>,
  ): Promise<CartItemMutationResult[]> {
    const endpoint = 'POST /carts/{cartId}/items';
    const res = this.record(
      endpoint,
      await this.http.requestJson<CartItemMutationResponse>(this.url(`/carts/${cartId}/items`), {
        method: 'POST',
        endpoint,
        headers: await this.buildHeaders('CART_WRITE', true),
        body: {
          content: items.map((item) => ({
            clientOrigin: CART_CLIENT_ORIGIN,
            productId: item.productId,
            quantity: item.quantity,
          })),
          optimizedMode: true,
        },
      }),
    );
    this.check(res, endpoint);
    const results = res.data.content ?? [];
    const bad = results.find((r) => r.returnType !== 'SUCCESS');
    if (results.length === 0 || bad) {
      throw new SchemaError(
        `Cart mutation did not return SUCCESS (got ${bad?.returnType ?? 'no result'})`,
        { status: res.status, endpoint },
      );
    }
    return results;
  }

  /** §5.4–5.6 — Single-line signed-delta convenience over {@link updateCartItems}. */
  async updateCartItem(args: {
    cartId: string;
    productId: string;
    quantity: number;
  }): Promise<CartItemMutationResult> {
    const [result] = await this.updateCartItems(args.cartId, [
      { productId: args.productId, quantity: args.quantity },
    ]);
    return result as CartItemMutationResult;
  }

  // ---- §5.7–5.11 shopping lists ---------------------------------------------------------------

  /** §5.7 — All shopping lists (first page, ample size). */
  async getShoppingLists(): Promise<ShoppingList[]> {
    const endpoint = 'GET /shopping-lists';
    const res = this.record(
      endpoint,
      await this.http.requestJson<ShoppingListsResponse>(this.url('/shopping-lists'), {
        endpoint,
        query: { page: 1, size: 50 },
        headers: await this.buildHeaders('SHOPPING_LISTS', true),
      }),
    );
    return this.check(res, endpoint).data.content;
  }

  /** §5.11 — A single shopping list (cheap validity check for a cached UUID). */
  async getShoppingList(listId: string): Promise<ShoppingList> {
    const endpoint = 'GET /shopping-lists/{listId}';
    const res = this.record(
      endpoint,
      await this.http.requestJson<ShoppingList>(this.url(`/shopping-lists/${listId}`), {
        endpoint,
        headers: await this.buildHeaders('SHOPPING_LISTS', true),
      }),
    );
    return this.check(res, endpoint).data;
  }

  /** §5.10 — A page of a list's products. */
  async getListContents(
    listId: string,
    page = 1,
    size = 50,
  ): Promise<ShoppingListContentsResponse> {
    const endpoint = 'GET /shopping-lists/{listId}/products';
    const res = this.record(
      endpoint,
      await this.http.requestJson<ShoppingListContentsResponse>(
        this.url(`/shopping-lists/${listId}/products`),
        {
          endpoint,
          query: { withEmerch: true, page, size },
          headers: await this.buildHeaders('SHOPPING_LISTS', true),
        },
      ),
    );
    return this.check(res, endpoint).data;
  }

  /** §5.8 — Add products to a list (PATCH `objectsToAdd`, responds 204). */
  async addToList(
    listId: string,
    items: Array<{ productId: string; quantity: number }>,
  ): Promise<void> {
    const endpoint = 'PATCH /shopping-lists/{listId} (add)';
    const res = this.record(
      endpoint,
      await this.http.requestJson<unknown>(this.url(`/shopping-lists/${listId}`), {
        method: 'PATCH',
        endpoint,
        headers: await this.buildHeaders('SHOPPING_LISTS', true),
        body: { objectsToAdd: items },
      }),
    );
    this.check(res, endpoint, [200, 204]);
  }

  /** §5.9 — Remove products from a list (PATCH `objectsToRemove`, responds 204). */
  async removeFromList(listId: string, productIds: string[]): Promise<void> {
    const endpoint = 'PATCH /shopping-lists/{listId} (remove)';
    const res = this.record(
      endpoint,
      await this.http.requestJson<unknown>(this.url(`/shopping-lists/${listId}`), {
        method: 'PATCH',
        endpoint,
        headers: await this.buildHeaders('SHOPPING_LISTS', true),
        body: { objectsToRemove: productIds.map((productId) => ({ productId })) },
      }),
    );
    this.check(res, endpoint, [200, 204]);
  }
}
