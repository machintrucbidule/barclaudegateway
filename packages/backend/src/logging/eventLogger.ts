/**
 * Operational-log recorder (BL-003, DECISION-018).
 *
 * The single emit point for {@link LogEvent}s: it redacts the event (contract.md §8), persists it to the
 * {@link EventLog} store (which assigns the `id` and default `at`), then publishes the stored event to
 * the {@link EventLogBus} for live tailing. Auth, the scan pipeline, the health self-test, the config
 * routes and the HA notifier all call {@link EventLogger.record} through the {@link EmitEvent} function
 * type, so call sites stay decoupled and the dependency is optional — an un-wired call site simply does
 * not log (keeping existing unit tests untouched).
 */

import type { LogEventInput } from '@barclaudegateway/shared';

import type { EventLog } from '../storage/eventLog.js';
import type { EventLogBus } from './eventLogBus.js';
import { redactSecrets } from './redact.js';

/** The decoupled emit signature injected into call sites; un-passed means "do not log". */
export type EmitEvent = (input: LogEventInput) => void;

export class EventLogger {
  constructor(
    private readonly store: EventLog,
    private readonly bus: EventLogBus,
  ) {}

  /** Redact, persist, then fan out one operational-log event. */
  record(input: LogEventInput): void {
    const safe = redactSecrets(input);
    const event = this.store.append(safe);
    this.bus.publish(event);
  }

  /** The bound {@link EmitEvent} to inject into call sites. */
  get emit(): EmitEvent {
    return (input) => {
      this.record(input);
    };
  }
}
