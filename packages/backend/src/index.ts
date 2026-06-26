import type { ApiVersion } from '@barclaudegateway/shared';

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
