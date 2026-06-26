/**
 * Shared contract types between the backend and the frontend.
 *
 * This package is intentionally minimal for the Phase 1 skeleton: it only proves that both sides
 * can import the same types. The real Chronodrive contract types land in Phase 2, derived from
 * `specifications/api/chronodrive/contract.md`.
 */

/**
 * Value of the Chronodrive `x-api-version` response header. Changes to this signal a backend
 * deploy on Chronodrive's side and must be monitored (see PROJECT_CONTEXT.md).
 */
export type ApiVersion = string;

/** Application version, kept in sync with package.json. Starts at 0.0.1 (Phase 1). */
export const APP_VERSION = '0.0.1';
