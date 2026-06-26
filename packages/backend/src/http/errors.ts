/**
 * Error taxonomy for Chronodrive interactions, mapped to the symptom table in contract.md §7.1.
 *
 * Every error carries a {@link ErrorCategory} so Phase 5 can route it to a maintenance-page state
 * or a Home Assistant alert without re-parsing messages. Construction never embeds secrets — callers
 * build messages from safe metadata only (status, endpoint), redacting bodies via `redactSecrets`.
 */

import type { ErrorCategory } from '@barclaudegateway/shared';

export interface ChronodriveErrorOptions {
  /** HTTP status, when the failure came from a response. */
  status?: number;
  /** Endpoint path or label the failure relates to (no query secrets). */
  endpoint?: string;
  /** Underlying cause (e.g. a network exception), preserved for diagnostics. */
  cause?: unknown;
}

/** Base class for every classified Chronodrive failure. */
export class ChronodriveError extends Error {
  readonly category: ErrorCategory;
  readonly status?: number;
  readonly endpoint?: string;

  constructor(category: ErrorCategory, message: string, options: ChronodriveErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.category = category;
    this.status = options.status;
    this.endpoint = options.endpoint;
  }
}

/** 401 across the board, an auth-step failure, or a refresh that could not recover. */
export class AuthError extends ChronodriveError {
  constructor(message: string, options: ChronodriveErrorOptions = {}) {
    super('auth', message, options);
  }
}

/**
 * The Reach5 session is too old (Step 2 returned `login_required`). Recoverable only by a full
 * 3-step re-login with stored credentials.
 */
export class LoginRequiredError extends AuthError {
  constructor(
    message = 'Reach5 session expired (login_required)',
    options: ChronodriveErrorOptions = {},
  ) {
    super(message, options);
  }
}

/** 401/403 isolated to one `x-api-key` service → that static key was likely rotated (§3.1). */
export class ApiKeyError extends ChronodriveError {
  constructor(message: string, options: ChronodriveErrorOptions = {}) {
    super('api_key', message, options);
  }
}

/** 200 but the response shape did not match the contract → an endpoint changed. */
export class SchemaError extends ChronodriveError {
  constructor(message: string, options: ChronodriveErrorOptions = {}) {
    super('schema', message, options);
  }
}

/** Product or list not found — a business-level outcome, not an API breakage. */
export class NotFoundError extends ChronodriveError {
  constructor(message: string, options: ChronodriveErrorOptions = {}) {
    super('not_found', message, options);
  }
}

/**
 * No Chronodrive credentials saved yet. NOT a breakage and NOT an auth failure: the operator simply
 * has not configured them. Kept out of the critical set so it never raises the maintenance surface;
 * the UI shows an informational "configure me" message instead.
 */
export class NotConfiguredError extends ChronodriveError {
  constructor(message: string, options: ChronodriveErrorOptions = {}) {
    super('not_configured', message, options);
  }
}

/** HTTP 429. Carries the parsed `Retry-After` (seconds) when present. */
export class RateLimitError extends ChronodriveError {
  readonly retryAfterSeconds?: number;
  constructor(message: string, retryAfterSeconds?: number, options: ChronodriveErrorOptions = {}) {
    super('rate_limit', message, options);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** HTTP 5xx that survived all retries. */
export class ServerError extends ChronodriveError {
  constructor(message: string, options: ChronodriveErrorOptions = {}) {
    super('server', message, options);
  }
}

/** Connection-level failure (refused, reset, DNS) that survived all retries. */
export class NetworkError extends ChronodriveError {
  constructor(message: string, options: ChronodriveErrorOptions = {}) {
    super('network', message, options);
  }
}

/** The request exceeded its deadline. */
export class TimeoutError extends ChronodriveError {
  constructor(message: string, options: ChronodriveErrorOptions = {}) {
    super('timeout', message, options);
  }
}
