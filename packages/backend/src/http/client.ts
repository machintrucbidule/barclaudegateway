/**
 * Thin HTTP transport over undici.
 *
 * Responsibilities kept generic so both the auth engine (connect.chronodrive.com) and the API client
 * (api.chronodrive.com) reuse it:
 *  - inject caller-supplied headers and JSON-serialize object bodies;
 *  - enforce a per-attempt timeout;
 *  - retry transient failures (network / timeout / 5xx / 429) with exponential backoff + jitter,
 *    honouring `Retry-After`; never retry 401 or business 4xx (those are the caller's to interpret);
 *  - surface the raw `Set-Cookie` array (needed to capture `__Host-SESSION`, contract.md §2.4) and
 *    the `x-api-version` header (deploy signal, §7.4);
 *  - classify exhausted failures into the {@link ChronodriveError} taxonomy.
 *
 * undici's global dispatcher is used so tests can intercept everything with `MockAgent`.
 */

import type { IncomingHttpHeaders } from 'node:http';
import { request as undiciRequest } from 'undici';
import { NetworkError, RateLimitError, SchemaError, ServerError, TimeoutError } from './errors.js';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RetryPolicy {
  /** Total attempts including the first. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 300,
  maxDelayMs: 5_000,
};

export interface HttpClientOptions {
  timeoutMs?: number;
  retry?: Partial<RetryPolicy>;
  /** Injectable for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter source for deterministic tests. */
  random?: () => number;
}

export interface HttpRequestOptions {
  method?: HttpMethod;
  headers?: Record<string, string>;
  /** Object bodies are JSON-serialized; string bodies are sent as-is. */
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Human label used in error messages (no secrets). Defaults to the URL path. */
  endpoint?: string;
}

export interface HttpResponse<T> {
  status: number;
  data: T;
  headers: IncomingHttpHeaders;
  apiVersion?: string;
  /** Raw `Set-Cookie` entries, normalized to an array (possibly empty). */
  setCookie: string[];
}

interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  apiVersion?: string;
  setCookie: string[];
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toSetCookieArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function parseRetryAfter(headers: IncomingHttpHeaders): number | undefined {
  const raw = headerValue(headers['retry-after']);
  if (raw === undefined) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

export class HttpClient {
  private readonly timeoutMs: number;
  private readonly retry: RetryPolicy;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(options: HttpClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.retry = { ...DEFAULT_RETRY, ...options.retry };
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
  }

  /** Send a request and parse the response body as JSON. Empty bodies yield `undefined`. */
  async requestJson<T>(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse<T>> {
    const raw = await this.execute(url, options);
    const data = this.parseJson<T>(raw, options.endpoint ?? url);
    return {
      status: raw.status,
      data,
      headers: raw.headers,
      apiVersion: raw.apiVersion,
      setCookie: raw.setCookie,
    };
  }

  /** Send a request and return the response body as text (used for the HTML auth-code page, §2.3). */
  async requestText(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse<string>> {
    const raw = await this.execute(url, options);
    return {
      status: raw.status,
      data: raw.text,
      headers: raw.headers,
      apiVersion: raw.apiVersion,
      setCookie: raw.setCookie,
    };
  }

  private parseJson<T>(raw: RawResponse, endpoint: string): T {
    if (raw.text.trim() === '') {
      return undefined as T;
    }
    try {
      return JSON.parse(raw.text) as T;
    } catch (cause) {
      throw new SchemaError(`Invalid JSON from ${endpoint} (status ${raw.status})`, {
        status: raw.status,
        endpoint,
        cause,
      });
    }
  }

  private buildUrl(url: string, query: HttpRequestOptions['query']): string {
    if (!query) return url;
    const u = new URL(url);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) u.searchParams.set(key, String(value));
    }
    return u.toString();
  }

  private backoffDelay(attempt: number): number {
    const exponential = this.retry.baseDelayMs * 2 ** (attempt - 1);
    const capped = Math.min(this.retry.maxDelayMs, exponential);
    // Full jitter on the lower half keeps a deterministic floor while spreading retries.
    return Math.round(capped * (0.5 + this.random() * 0.5));
  }

  private async execute(url: string, options: HttpRequestOptions): Promise<RawResponse> {
    const method = options.method ?? 'GET';
    const endpoint = options.endpoint ?? new URL(url).pathname;
    const target = this.buildUrl(url, options.query);

    const headers: Record<string, string> = { ...options.headers };
    let body: string | undefined;
    if (options.body !== undefined) {
      if (typeof options.body === 'string') {
        body = options.body;
      } else {
        body = JSON.stringify(options.body);
        if (!('content-type' in headers) && !('Content-Type' in headers)) {
          headers['content-type'] = 'application/json';
        }
      }
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt += 1) {
      try {
        const res = await undiciRequest(target, {
          method,
          headers,
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        const status = res.statusCode;
        const apiVersion = headerValue(res.headers['x-api-version']);
        const setCookie = toSetCookieArray(res.headers['set-cookie']);

        if (status === 429 || status >= 500) {
          // Drain the body so the socket can be reused, then decide whether to retry.
          await res.body.dump();
          const retryAfter = status === 429 ? parseRetryAfter(res.headers) : undefined;
          if (attempt < this.retry.maxAttempts) {
            const delay =
              retryAfter !== undefined ? retryAfter * 1_000 : this.backoffDelay(attempt);
            await this.sleep(delay);
            continue;
          }
          throw status === 429
            ? new RateLimitError(`Rate limited by ${endpoint}`, retryAfter, { status, endpoint })
            : new ServerError(`Server error ${status} from ${endpoint}`, { status, endpoint });
        }

        const text = await res.body.text();
        return { status, headers: res.headers, text, apiVersion, setCookie };
      } catch (error) {
        // RateLimit/Server errors thrown above are terminal — do not re-loop on them.
        if (error instanceof RateLimitError || error instanceof ServerError) {
          throw error;
        }
        lastError = error;
        const isTimeout =
          error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        if (attempt < this.retry.maxAttempts) {
          await this.sleep(this.backoffDelay(attempt));
          continue;
        }
        if (isTimeout) {
          throw new TimeoutError(`Request to ${endpoint} timed out after ${this.timeoutMs}ms`, {
            endpoint,
            cause: error,
          });
        }
        throw new NetworkError(`Network error calling ${endpoint}`, { endpoint, cause: error });
      }
    }

    // Unreachable: the loop either returns or throws. Satisfies the type checker.
    throw new NetworkError(`Network error calling ${endpoint}`, { endpoint, cause: lastError });
  }
}
