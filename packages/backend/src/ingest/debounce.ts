/**
 * In-memory debounce for repeated scans of the same EAN (CLARIFY-07).
 *
 * Cheap UART scanners (GM65/GM861) sometimes emit two reads for one physical pass. We ignore a repeat
 * of the same EAN inside a short window (~3 s default, tunable) so the hardware double-read does not
 * become a `+2`. A genuine second scan after the window still adds `+1`.
 *
 * State is process-memory only (a Map of EAN → last-accepted timestamp): consistent with DECISION-001
 * (no queue, scans during downtime are lost). The map is self-pruning on each call so it cannot grow
 * without bound. `now` is injectable for deterministic tests.
 */

export const DEFAULT_DEBOUNCE_MS = 3_000;

export class DebounceGate {
  private readonly lastSeen = new Map<string, number>();

  constructor(
    private readonly windowMs: number = DEFAULT_DEBOUNCE_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Register a scan of `ean`. Returns `true` when it is a duplicate within the window (the caller
   * should short-circuit to `duplicate_ignored`), or `false` when the scan should proceed. A
   * proceeding scan refreshes the EAN's timestamp.
   */
  isDuplicate(ean: string): boolean {
    const at = this.now();
    this.prune(at);
    const previous = this.lastSeen.get(ean);
    if (previous !== undefined && at - previous < this.windowMs) {
      return true;
    }
    this.lastSeen.set(ean, at);
    return false;
  }

  /** Drop entries older than the window so the map tracks only currently-relevant EANs. */
  private prune(at: number): void {
    for (const [ean, ts] of this.lastSeen) {
      if (at - ts >= this.windowMs) this.lastSeen.delete(ean);
    }
  }
}
