/**
 * In-process operational-log event bus (BL-003, DECISION-018).
 *
 * The {@link EventLogger} publishes a {@link LogEvent} here after persisting it; the SSE endpoint
 * (`GET /api/events/stream`) subscribes and forwards each event to the connected browsers. A thin typed
 * wrapper around Node's {@link EventEmitter}, identical in shape to `ScanEventBus` — synchronous,
 * unbounded fan-out, no backpressure (each event is a tiny JSON payload).
 *
 * This is a dedicated bus reserved for {@link LogEvent}s; the scan `ScanEventBus` is left untouched (it
 * still feeds the error monitor and the scan history). Secrets never reach here — every event is
 * redacted by the {@link EventLogger} before it is published.
 */

import { EventEmitter } from 'node:events';
import type { LogEvent } from '@barclaudegateway/shared';

const LOG_EVENT = 'log';

export type LogEventListener = (event: LogEvent) => void;

export class EventLogBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Several SSE clients (and tests) may subscribe at once; lift Node's 10-listener leak warning.
    this.emitter.setMaxListeners(0);
  }

  /** Fan an event out to every current subscriber. */
  publish(event: LogEvent): void {
    this.emitter.emit(LOG_EVENT, event);
  }

  /** Subscribe to events; returns an unsubscribe function (call it when the SSE connection closes). */
  subscribe(listener: LogEventListener): () => void {
    this.emitter.on(LOG_EVENT, listener);
    return () => this.emitter.off(LOG_EVENT, listener);
  }
}
