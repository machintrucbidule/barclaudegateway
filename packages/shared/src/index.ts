/**
 * Shared contract types between the backend and the frontend.
 *
 * The Chronodrive private-API contract types live in `./chronodrive/contract` and are re-exported
 * here so both sides import them from `@barclaudegateway/shared` (DECISION-002, DECISION-006).
 */

export * from './chronodrive/contract.js';
export * from './ingest/contract.js';
export * from './api/contract.js';
export * from './api/local.js';
export * from './logging/contract.js';

/**
 * Value of the Chronodrive `x-api-version` response header. Changes to this signal a backend
 * deploy on Chronodrive's side and must be monitored (see PROJECT_CONTEXT.md).
 */
export type ApiVersion = string;

/** Application version, kept in sync with package.json. Starts at 0.0.1 (Phase 1). */
export const APP_VERSION = '0.0.1';
