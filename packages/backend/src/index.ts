import type { ApiVersion } from '@barclaudegateway/shared';

export * from './config/defaults.js';
export * from './config/env.js';
export * from './http/client.js';
export * from './http/errors.js';
export * from './logging/redact.js';
export * from './auth/index.js';
export * from './storage/index.js';
export * from './chronodrive/index.js';
export * from './health/index.js';
export * from './ingest/index.js';
export * from './bootstrap.js';

/** Application version, kept in sync with package.json. Starts at 0.0.1 (Phase 1). */
const APP_VERSION = '0.0.1';

/**
 * Phase 1 placeholder entry point. The real backend (HTTP server, Chronodrive auth engine, token
 * lifecycle and API client) is built starting in Phase 2. For now this only proves the workspace
 * compiles and can import the shared contract types.
 */
export function describeRuntime(apiVersion: ApiVersion = 'unknown'): string {
  return `BarclaudeGateway backend v${APP_VERSION} (Chronodrive x-api-version: ${apiVersion})`;
}
