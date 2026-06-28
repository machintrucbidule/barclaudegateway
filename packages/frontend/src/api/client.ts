/**
 * Typed wrappers over the Phase 4 backend API (`/api/*`).
 *
 * Same-origin in every mode: the production backend serves this bundle, and the Vite dev server proxies
 * `/api` to the backend (see vite.config.ts) — so relative URLs always work and there is no CORS. All
 * responses are typed against `@barclaudegateway/shared`, the single source of truth shared with the
 * backend. Credentials are write-only: `putCredentials` sends them, nothing reads a password back.
 */

import type {
  AddTrackedProductInput,
  ApiConfig,
  CheckNowResult,
  ConfigResponse,
  CredentialsInput,
  DestinationsResponse,
  EnabledDestinations,
  ErrorState,
  EventsResponse,
  HealthReport,
  LogCategory,
  PriceHistoryResponse,
  PriceTrackingSettings,
  ScansResponse,
  TrackedProduct,
  TrackedProductsResponse,
} from '@barclaudegateway/shared';

/** Outcome of the config-page "send test" button (a Home Assistant webhook probe). */
export interface WebhookTestResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/** Query for the searchable, paginated scan history (BL-004). */
export interface ScansQuery {
  page?: number;
  /** 10 / 50 / 100 / 500, or `'all'` for every matching row. */
  pageSize?: number | 'all';
  status?: string;
  search?: string;
}

/** Query for the operational-log page (BL-003). */
export interface EventsQuery {
  category?: LogCategory;
  page?: number;
  pageSize?: number;
}

/** An API call that returned a non-2xx status; `message` is the backend's `error` field when present. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return data as T;
}

async function getJson<T>(url: string): Promise<T> {
  return parse<T>(await fetch(url, { headers: { accept: 'application/json' } }));
}

async function sendJson<T>(method: string, url: string, body?: unknown): Promise<T> {
  return parse<T>(
    await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

export const api = {
  getConfig: (): Promise<ConfigResponse> => getJson('/api/config'),
  putConfig: (config: ApiConfig): Promise<ConfigResponse> => sendJson('PUT', '/api/config', config),

  getDestinations: (): Promise<DestinationsResponse> => getJson('/api/config/destinations'),
  putDestinations: (destinations: EnabledDestinations): Promise<EnabledDestinations> =>
    sendJson('PUT', '/api/config/destinations', destinations),
  /** BL-007: force the live list fetch on demand (the "Recharger les listes" button). */
  refreshDestinations: (): Promise<DestinationsResponse> =>
    sendJson('POST', '/api/config/destinations/refresh'),

  putCredentials: (credentials: CredentialsInput): Promise<{ credentials: { set: boolean } }> =>
    sendJson('PUT', '/api/credentials', credentials),
  deleteCredentials: (): Promise<{ credentials: { set: boolean } }> =>
    sendJson('DELETE', '/api/credentials'),

  getScans: (query: ScansQuery = {}): Promise<ScansResponse> => {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize));
    if (query.status) params.set('status', query.status);
    if (query.search) params.set('search', query.search);
    const qs = params.toString();
    return getJson(qs ? `/api/scans?${qs}` : '/api/scans');
  },

  getEvents: (query: EventsQuery = {}): Promise<EventsResponse> => {
    const params = new URLSearchParams();
    if (query.category) params.set('category', query.category);
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize));
    const qs = params.toString();
    return getJson(qs ? `/api/events?${qs}` : '/api/events');
  },

  getHealth: (): Promise<HealthReport> => getJson('/api/health'),
  /** BL-006: force an on-demand login + full probe (the "connect now" buttons). */
  connectNow: (): Promise<HealthReport> => sendJson('POST', '/api/health/connect'),

  getErrorState: (): Promise<ErrorState> => getJson('/api/error-state'),
  sendHaWebhookTest: (): Promise<WebhookTestResult> => sendJson('POST', '/api/notify/test'),

  // BL-012 — price tracking (internal mirror of the local `/api/v1/price-tracking/*` surface).
  getTrackedProducts: (): Promise<TrackedProductsResponse> => getJson('/api/price-tracking'),
  addTrackedProduct: (input: AddTrackedProductInput): Promise<TrackedProduct> =>
    sendJson('POST', '/api/price-tracking', input),
  updateThreshold: (productId: string, threshold: number): Promise<TrackedProduct> =>
    sendJson('PUT', `/api/price-tracking/${encodeURIComponent(productId)}`, { threshold }),
  removeTrackedProduct: (productId: string): Promise<{ removed: string }> =>
    sendJson('DELETE', `/api/price-tracking/${encodeURIComponent(productId)}`),
  getPriceHistory: (productId: string): Promise<PriceHistoryResponse> =>
    getJson(`/api/price-tracking/${encodeURIComponent(productId)}/history`),
  getPriceSettings: (): Promise<PriceTrackingSettings> => getJson('/api/price-tracking/settings'),
  putPriceSettings: (settings: PriceTrackingSettings): Promise<PriceTrackingSettings> =>
    sendJson('PUT', '/api/price-tracking/settings', settings),
  checkPricesNow: (): Promise<CheckNowResult> => sendJson('POST', '/api/price-tracking/check-now'),
};
