/**
 * In-process scan event bus (Phase 4).
 *
 * The pipeline publishes a {@link ScanEvent} at every terminal outcome it journals; the SSE endpoint
 * (`GET /api/scans/stream`) subscribes and forwards each event to the connected browsers. A thin typed
 * wrapper around Node's {@link EventEmitter}: synchronous, unbounded fan-out, no backpressure (each
 * scan is a tiny JSON payload and listeners just write to an open response stream).
 *
 * Secrets never reach here — a {@link ScanEvent} carries only the public {@link ScanResponse} (EANs and
 * product labels are allowed; tokens/passwords are not, per the pipeline's secret-free responses).
 */

import { EventEmitter } from 'node:events';
import type { ScanEvent } from '@barclaudegateway/shared';

const SCAN_EVENT = 'scan';

export type ScanEventListener = (event: ScanEvent) => void;

export class ScanEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // A browser tab per device is plenty; lift the default 10-listener warning so several SSE clients
    // (and tests) don't trip Node's leak detector.
    this.emitter.setMaxListeners(0);
  }

  /** Fan a scan out to every current subscriber. */
  publish(event: ScanEvent): void {
    this.emitter.emit(SCAN_EVENT, event);
  }

  /** Subscribe to scans; returns an unsubscribe function (call it when the SSE connection closes). */
  subscribe(listener: ScanEventListener): () => void {
    this.emitter.on(SCAN_EVENT, listener);
    return () => this.emitter.off(SCAN_EVENT, listener);
  }
}
