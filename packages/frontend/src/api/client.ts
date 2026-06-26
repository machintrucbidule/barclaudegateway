/**
 * Typed wrappers over the Phase 4 backend API (`/api/*`).
 *
 * Same-origin in every mode: the production backend serves this bundle, and the Vite dev server proxies
 * `/api` to the backend (see vite.config.ts) — so relative URLs always work and there is no CORS. All
 * responses are typed against `@barclaudegateway/shared`, the single source of truth shared with the
 * backend. Credentials are write-only: `putCredentials` sends them, nothing reads a password back.
 */

import type {
  ApiConfig,
  ConfigResponse,
  CredentialsInput,
  DestinationsResponse,
  EnabledDestinations,
  ErrorState,
  HealthReport,
  ScansResponse,
} from '@barclaudegateway/shared';

/** Outcome of the config-page "send test" button (a Home Assistant webhook probe). */
export interface WebhookTestResult {
  ok: boolean;
  status?: number;
  error?: string;
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

  putCredentials: (credentials: CredentialsInput): Promise<{ credentials: { set: boolean } }> =>
    sendJson('PUT', '/api/credentials', credentials),
  deleteCredentials: (): Promise<{ credentials: { set: boolean } }> =>
    sendJson('DELETE', '/api/credentials'),

  getScans: (limit?: number): Promise<ScansResponse> =>
    getJson(limit === undefined ? '/api/scans' : `/api/scans?limit=${String(limit)}`),

  getHealth: (): Promise<HealthReport> => getJson('/api/health'),

  getErrorState: (): Promise<ErrorState> => getJson('/api/error-state'),
  sendHaWebhookTest: (): Promise<WebhookTestResult> => sendJson('POST', '/api/notify/test'),
};
