/**
 * Scan → action pipeline (Phase 3 core).
 *
 * Turns one validated, normalised EAN into the full set of side effects and a rich synchronous
 * {@link ScanResponse}:
 *  1. debounce identical EANs (CLARIFY-07);
 *  2. resolve the EAN to a Chronodrive product (Phase 2 client);
 *  3. branch on not-found (CLARIFY-01) / out-of-stock / ineligible (CLARIFY-08);
 *  4. write to every enabled destination — cart via a signed `+1` (only when orderable), lists via
 *     PATCH (always, when the product exists);
 *  5. append the outcome to the bounded scan journal.
 *
 * Chronodrive failures are classified through the Phase 2 error taxonomy so the response carries a
 * `category` the firmware/Phase 5 can route on. Secrets are never logged; EANs and product labels are.
 */

import type {
  DestinationResult,
  ErrorCategory,
  LogEventType,
  LogLevel,
  Product,
  ScanProductSummary,
  ScanReason,
  ScanResponse,
  ScanStatus,
} from '@barclaudegateway/shared';
import type { ChronodriveClient } from '../chronodrive/client.js';
import { ChronodriveError, NotFoundError } from '../http/errors.js';
import type { EmitEvent } from '../logging/eventLogger.js';
import type { ScanLog } from '../storage/scanLog.js';
import type { DestinationsStore } from '../storage/destinations.js';
import type { ScanEventBus } from './scanEvents.js';
import { DebounceGate } from './debounce.js';

/** Display label for the cart destination (French, user-facing — matches the Phase 4 checkbox). */
const CART_LABEL = 'Panier';

export interface IngestPipelineDeps {
  chronodrive: ChronodriveClient;
  scanLog: ScanLog;
  destinations: DestinationsStore;
  /** Defaults to a fresh gate with the standard ~3 s window; injectable for deterministic tests. */
  debounce?: DebounceGate;
  /** Optional live event bus (Phase 4 SSE). When set, each journalled outcome is published to it. */
  events?: ScanEventBus;
  /** Optional operational-log emit (BL-003): the ordered per-step scan lines. */
  emit?: EmitEvent;
  /** Epoch-ms clock for the published event timestamp; injectable for deterministic tests. */
  now?: () => number;
}

function toSummary(product: Product): ScanProductSummary {
  return {
    id: product.id,
    label: product.labels?.productLabel,
    brand: product.labels?.brandLabel,
    price: product.prices?.defaultPrice,
    stock: product.stock,
    isEligible: product.isEligible,
  };
}

function categoryOf(error: unknown): ErrorCategory {
  return error instanceof ChronodriveError ? error.category : 'unknown';
}

/** Compact, secret-free description of a failure for a destination `detail` / log message. */
function describeError(error: unknown): string {
  if (error instanceof ChronodriveError) {
    const status = error.status !== undefined ? ` ${error.status}` : '';
    return `[${error.category}${status}] ${error.message}`.slice(0, 200);
  }
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}

export class IngestPipeline {
  private readonly chronodrive: ChronodriveClient;
  private readonly scanLog: ScanLog;
  private readonly destinations: DestinationsStore;
  private readonly debounce: DebounceGate;
  private readonly events: ScanEventBus | undefined;
  private readonly emit: EmitEvent | undefined;
  private readonly now: () => number;
  /** Cached active-cart id (contract.md §5.3); invalidated on a 404 cart write. */
  private cartId: string | undefined;

  constructor(deps: IngestPipelineDeps) {
    this.chronodrive = deps.chronodrive;
    this.scanLog = deps.scanLog;
    this.destinations = deps.destinations;
    this.debounce = deps.debounce ?? new DebounceGate();
    this.events = deps.events;
    this.emit = deps.emit;
    this.now = deps.now ?? Date.now;
  }

  /** Emit one operational-log line in the `scan` category (BL-003). No-op when no emit is wired. */
  private log(
    type: LogEventType,
    level: LogLevel,
    message: string,
    detail?: Record<string, unknown>,
  ): void {
    this.emit?.({ category: 'scan', type, level, message, ...(detail ? { detail } : {}) });
  }

  /** Journal the response to the live bus (Phase 4). No-op when no bus is wired (Phase 3 tests). */
  private publish(response: ScanResponse): void {
    this.events?.publish({ at: this.now(), response });
  }

  /** Process one validated, EAN-13-normalised barcode. */
  async handle(ean: string): Promise<ScanResponse> {
    if (this.debounce.isDuplicate(ean)) {
      // Hardware double-read: ignore without logging (it is an artefact, not a real event).
      return {
        status: 'duplicate_ignored',
        ean,
        message: 'Repeated scan ignored (debounce window)',
      };
    }

    this.log('ean_read', 'info', `Barcode read: ${ean}`, { ean });
    this.log('search_request', 'info', `Searching Chronodrive for EAN ${ean}`, { ean });

    let product: Product | null;
    try {
      product = await this.chronodrive.resolveEan(ean);
    } catch (error) {
      const category = categoryOf(error);
      this.log('search_request', 'error', `Search failed: ${describeError(error)}`, {
        ean,
        category,
      });
      this.scanLog.append({ ean, outcome: 'error', message: describeError(error) });
      const response: ScanResponse = {
        status: 'error',
        ean,
        category,
        message: 'Chronodrive request failed',
      };
      this.log('scan_complete', 'error', 'Scan failed (Chronodrive request error)', {
        ean,
        category,
      });
      this.publish(response);
      return response;
    }

    if (product === null) {
      this.log('product_not_found', 'warn', `Product not found for EAN ${ean}`, { ean });
      this.scanLog.append({ ean, outcome: 'not_found', message: 'EAN not in catalogue' });
      const response: ScanResponse = {
        status: 'not_found',
        ean,
        message: 'Product not found in Chronodrive catalogue',
      };
      this.log('scan_complete', 'info', 'Scan complete: product not found', { ean });
      this.publish(response);
      return response;
    }

    const summary = toSummary(product);
    this.log('product_resolved', 'info', `Product resolved: ${summary.label ?? summary.id}`, {
      ean,
      productId: summary.id,
      stock: summary.stock,
      isEligible: summary.isEligible,
    });
    const orderable = product.stock !== 'NO_STOCK' && product.isEligible !== false;
    const reason: ScanReason | undefined = orderable
      ? undefined
      : product.isEligible === false
        ? 'ineligible'
        : 'out_of_stock';

    const enabled = this.destinations.read();
    const destinations: DestinationResult[] = [];
    let failureCategory: ErrorCategory | undefined;

    if (enabled.cart) {
      if (orderable) {
        const { result, category } = await this.writeCart(product.id);
        if (category !== undefined) failureCategory ??= category;
        if (result.result === 'written') {
          this.log('cart_write', 'info', `Added to cart: ${summary.label ?? summary.id}`, {
            ean,
            productId: summary.id,
          });
        } else {
          this.log('cart_write', 'error', `Cart write failed: ${result.detail ?? ''}`, {
            ean,
            productId: summary.id,
            category,
          });
        }
        destinations.push(result);
      } else {
        this.log('cart_write', 'warn', `Cart skipped (${reason ?? 'unavailable'})`, {
          ean,
          productId: summary.id,
          reason,
        });
        destinations.push({
          kind: 'cart',
          name: CART_LABEL,
          result: 'skipped_unavailable',
          detail: reason,
        });
      }
    }

    for (const list of enabled.lists) {
      try {
        await this.chronodrive.addToList(list.id, [{ productId: product.id, quantity: 1 }]);
        this.log('list_write', 'info', `Added to list "${list.name}"`, {
          ean,
          productId: summary.id,
          listId: list.id,
        });
        destinations.push({ kind: 'list', id: list.id, name: list.name, result: 'written' });
      } catch (error) {
        const category = categoryOf(error);
        failureCategory ??= category;
        this.log(
          'list_write',
          'error',
          `List "${list.name}" write failed: ${describeError(error)}`,
          {
            ean,
            productId: summary.id,
            listId: list.id,
            category,
          },
        );
        destinations.push({
          kind: 'list',
          id: list.id,
          name: list.name,
          result: 'failed',
          detail: describeError(error),
        });
      }
    }

    return this.finish(ean, summary, reason, destinations, failureCategory);
  }

  /** Aggregate the per-destination results into a status, log it, and build the response. */
  private finish(
    ean: string,
    product: ScanProductSummary,
    reason: ScanReason | undefined,
    destinations: DestinationResult[],
    failureCategory: ErrorCategory | undefined,
  ): ScanResponse {
    const written = destinations.filter((d) => d.result === 'written').length;
    const failed = destinations.filter((d) => d.result === 'failed').length;
    const skipped = destinations.filter((d) => d.result === 'skipped_unavailable').length;

    let status: ScanStatus;
    let category: ErrorCategory | undefined;
    let message: string;

    if (destinations.length === 0) {
      status = 'error';
      category = 'unknown';
      message = 'No destination enabled — enable the cart or a list in the config';
    } else if (failed > 0 && written > 0) {
      status = 'partial';
      category = failureCategory;
      message = `Partially added "${product.label ?? product.id}" (${written} ok, ${failed} failed)`;
    } else if (failed > 0) {
      status = 'error';
      category = failureCategory;
      message = `Failed to add "${product.label ?? product.id}"`;
    } else if (skipped > 0) {
      status = 'added_to_lists_only';
      message = `Added "${product.label ?? product.id}" to lists only (${reason})`;
    } else {
      status = 'added';
      message = `Added "${product.label ?? product.id}"`;
    }

    this.scanLog.append({ ean, outcome: status, message });

    const level: LogLevel = status === 'error' ? 'error' : status === 'partial' ? 'warn' : 'info';
    this.log('scan_complete', level, message, {
      ean,
      status,
      ...(category !== undefined ? { category } : {}),
    });

    const response: ScanResponse = { status, ean, product, destinations };
    if (reason !== undefined && status === 'added_to_lists_only') response.reason = reason;
    if (category !== undefined) response.category = category;
    response.message = message;
    this.publish(response);
    return response;
  }

  /**
   * Write `+1` of `productId` to the active cart, refetching the cart id once on a stale-404.
   * Returns the destination result plus the failure category (when it failed) so the caller can
   * classify the aggregate without shared error state.
   */
  private async writeCart(
    productId: string,
  ): Promise<{ result: DestinationResult; category?: ErrorCategory }> {
    const wasCached = this.cartId !== undefined;
    try {
      const cartId = await this.getCartId();
      await this.chronodrive.updateCartItem({ cartId, productId, quantity: 1 });
      return { result: { kind: 'cart', id: cartId, name: CART_LABEL, result: 'written' } };
    } catch (error) {
      if (wasCached && error instanceof NotFoundError) {
        this.cartId = undefined;
        try {
          const cartId = await this.getCartId();
          await this.chronodrive.updateCartItem({ cartId, productId, quantity: 1 });
          return { result: { kind: 'cart', id: cartId, name: CART_LABEL, result: 'written' } };
        } catch (retryError) {
          return {
            result: {
              kind: 'cart',
              name: CART_LABEL,
              result: 'failed',
              detail: describeError(retryError),
            },
            category: categoryOf(retryError),
          };
        }
      }
      return {
        result: { kind: 'cart', name: CART_LABEL, result: 'failed', detail: describeError(error) },
        category: categoryOf(error),
      };
    }
  }

  private async getCartId(): Promise<string> {
    if (this.cartId === undefined) this.cartId = await this.chronodrive.getActiveCartId();
    return this.cartId;
  }
}
