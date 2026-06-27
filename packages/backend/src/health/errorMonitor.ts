/**
 * In-process critical-error monitor (Phase 5, DECISION-014).
 *
 * Holds the single current {@link ErrorState} and feeds both the maintenance surface (SSE +
 * `GET /api/error-state`) and the Home Assistant notifier. It does NOT invent a taxonomy: it reuses
 * the shared {@link ErrorCategory} and only decides which categories are *critical* — an infrastructure
 * breakage worth alerting — versus benign business outcomes (`not_found`) or transient throttling
 * (`rate_limit`), which never raise the surface.
 *
 * Two detection sources feed it (the user chose both):
 *  - live scan failures, via {@link ingestScan} subscribed to the {@link ScanEventBus};
 *  - the periodic read-only health self-test, via {@link ingestHealthReport}.
 *
 * Listeners are notified only on a genuine *transition* (inactive↔active, or a different incident), so
 * the notifier fires once per incident and SSE clients are not spammed by every repeated scan.
 */

import { EventEmitter } from 'node:events';
import type {
  ErrorCategory,
  ErrorState,
  ErrorStateError,
  HealthReport,
  ScanEvent,
} from '@barclaudegateway/shared';

/** Categories that count as a critical breakage (DECISION-014). `not_found`/`rate_limit` are excluded. */
export const CRITICAL_CATEGORIES: ReadonlySet<ErrorCategory> = new Set<ErrorCategory>([
  'auth',
  'api_key',
  'schema',
  'server',
  'network',
  'timeout',
]);

export function isCriticalCategory(category: ErrorCategory | undefined): category is ErrorCategory {
  return category !== undefined && CRITICAL_CATEGORIES.has(category);
}

export type ErrorStateListener = (state: ErrorState) => void;

const STATE_CHANGED = 'change';

/** Two incidents are "the same" when both their category and endpoint match. */
function sameIncident(a: ErrorStateError | undefined, b: ErrorStateError): boolean {
  return a !== undefined && a.category === b.category && a.endpoint === b.endpoint;
}

export class ErrorMonitor {
  private readonly emitter = new EventEmitter();
  private state: ErrorState = { active: false };

  constructor() {
    // Several SSE clients plus the notifier subscribe; lift Node's 10-listener leak warning. Note: all
    // timestamps come from the scan event / health report, so the monitor needs no clock of its own.
    this.emitter.setMaxListeners(0);
  }

  /** The current state (a fresh copy so callers cannot mutate the internal value). */
  getState(): ErrorState {
    return this.state.error
      ? { active: this.state.active, error: { ...this.state.error } }
      : { active: this.state.active };
  }

  /** Subscribe to transitions; returns an unsubscribe function. */
  subscribe(listener: ErrorStateListener): () => void {
    this.emitter.on(STATE_CHANGED, listener);
    return () => this.emitter.off(STATE_CHANGED, listener);
  }

  /** Classify a live scan: a critical failure raises the surface; any other outcome clears it. */
  ingestScan(event: ScanEvent): void {
    const { response } = event;
    if (
      (response.status === 'error' || response.status === 'partial') &&
      isCriticalCategory(response.category)
    ) {
      this.recordError({
        category: response.category,
        message: response.message ?? `Scan failed (${response.status})`,
        at: event.at,
      });
      return;
    }
    // A reachable, non-critical outcome (success, not_found, invalid_ean, rate_limit…) means the API
    // answered — treat it as evidence of recovery and clear any active surface.
    this.clear();
  }

  /** Classify a health self-test: recovery clears; the first critical failing check raises the surface. */
  ingestHealthReport(report: HealthReport): void {
    // "Not configured" is an informational state, never a breakage: ensure the surface stays clear.
    if (report.configured === false) {
      this.clear();
      return;
    }
    // Lazy-mode idle skip (BL-006): no probe ran, so we learned nothing — leave any existing surface
    // untouched (don't clear a real incident, don't invent one).
    if (report.idle) return;
    if (report.ok) {
      this.clear();
      return;
    }
    const failing = report.checks.find(
      (check) => check.status === 'error' && isCriticalCategory(check.category),
    );
    if (failing?.category !== undefined) {
      this.recordError({
        category: failing.category,
        endpoint: failing.endpoint,
        message: failing.detail,
        apiVersion: failing.apiVersion,
        at: report.checkedAt,
      });
    }
    // A non-ok report with no critical check (e.g. a benign catalogue miss) leaves the state untouched.
  }

  private recordError(error: ErrorStateError): void {
    // Same ongoing incident → keep the original (its `at` marks when it started); no transition emitted.
    if (this.state.active && sameIncident(this.state.error, error)) return;
    this.state = { active: true, error };
    this.emit();
  }

  private clear(): void {
    if (!this.state.active) return; // already clear → no transition
    this.state = { active: false };
    this.emit();
  }

  private emit(): void {
    this.emitter.emit(STATE_CHANGED, this.getState());
  }
}
