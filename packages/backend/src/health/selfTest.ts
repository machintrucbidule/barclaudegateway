/**
 * Read-only health self-test (contract.md §7.1).
 *
 * Exercises each confirmed endpoint with a GET (no mutations) and reports per-endpoint status plus
 * the observed `x-api-version`. Meant to run on startup and periodically; Phase 5 turns failures
 * into maintenance-page states. Errors are caught per check so one failure doesn't hide the others.
 */

import type { EndpointCheck, HealthReport } from '@barclaudegateway/shared';
import { ChronodriveError } from '../http/errors.js';
import type { ChronodriveClient } from '../chronodrive/client.js';
import { HEALTH_CHECK_EAN } from '../chronodrive/client.js';

// The health-report shapes live in the shared package so the Phase 4 dashboard compiles against the
// same definitions; re-export them here so existing backend imports keep resolving from `./selfTest`.
export type { EndpointCheck, HealthReport, HealthStatus } from '@barclaudegateway/shared';

function describeError(error: unknown): string {
  if (error instanceof ChronodriveError) {
    const status = error.status !== undefined ? ` status=${error.status}` : '';
    return `[${error.category}${status}] ${error.message}`.slice(0, 200);
  }
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}

/**
 * Run the read-only checks against the live (or mocked) Chronodrive API and aggregate the result.
 * `ok` is true only when every check passed.
 */
export async function runHealthSelfTest(
  client: ChronodriveClient,
  now: () => number = Date.now,
): Promise<HealthReport> {
  const checks: EndpointCheck[] = [];

  const run = async (name: string, endpoint: string, fn: () => Promise<string>): Promise<void> => {
    try {
      const detail = await fn();
      checks.push({ name, endpoint, status: 'ok', detail });
    } catch (error) {
      // Carry the failure category when it is a classified Chronodrive error, so the Phase 5 error
      // monitor can tell a critical breakage from a benign one without re-parsing the message.
      const category = error instanceof ChronodriveError ? error.category : undefined;
      checks.push({ name, endpoint, status: 'error', detail: describeError(error), category });
    }
  };

  let siteId: string | undefined;

  await run('Customer profile', 'GET /customers/me', async () => {
    siteId = await client.getSiteId();
    return `site_id=${siteId}`;
  });

  await run('EAN search', 'GET /search-suggestions', async () => {
    const product = await client.resolveEan(HEALTH_CHECK_EAN);
    if (!product)
      throw new Error(`Known EAN ${HEALTH_CHECK_EAN} returned no product (catalogue change?)`);
    return `resolved "${product.labels.productLabel ?? product.id}" (stock=${product.stock ?? '?'}, eligible=${product.isEligible ?? '?'})`;
  });

  await run('Active cart', 'GET /customers/me/carts', async () => {
    const cart = await client.getActiveCart();
    return `${cart.content?.length ?? 0} cart(s)`;
  });

  await run('Shopping lists', 'GET /shopping-lists', async () => {
    const lists = await client.getShoppingLists();
    return `${lists.length} list(s)`;
  });

  const apiVersions = client.getApiVersions();
  for (const check of checks) {
    check.apiVersion = apiVersions[check.endpoint];
  }

  return {
    ok: checks.every((c) => c.status === 'ok'),
    siteId,
    checks,
    apiVersions,
    checkedAt: now(),
  };
}
