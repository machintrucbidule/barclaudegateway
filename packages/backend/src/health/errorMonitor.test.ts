import { describe, expect, it, vi } from 'vitest';
import type { ErrorState, HealthReport, ScanEvent } from '@barclaudegateway/shared';
import { ErrorMonitor } from './errorMonitor.js';

function scan(
  event: Partial<ScanEvent['response']> & { status: ScanEvent['response']['status'] },
  at = 1,
): ScanEvent {
  return { at, response: { ean: '999', ...event } };
}

function report(checks: HealthReport['checks'], ok: boolean, checkedAt = 10): HealthReport {
  return { ok, checks, apiVersions: {}, checkedAt };
}

describe('ErrorMonitor', () => {
  it('starts inactive', () => {
    expect(new ErrorMonitor().getState()).toEqual({ active: false });
  });

  it('records a critical scan failure', () => {
    const monitor = new ErrorMonitor();
    monitor.ingestScan(scan({ status: 'error', category: 'auth', message: 'auth failed' }, 5));
    expect(monitor.getState()).toEqual({
      active: true,
      error: { category: 'auth', message: 'auth failed', at: 5 },
    });
  });

  it('ignores non-critical scan categories (not_found, rate_limit)', () => {
    const monitor = new ErrorMonitor();
    monitor.ingestScan(scan({ status: 'error', category: 'not_found', message: 'absent' }));
    monitor.ingestScan(scan({ status: 'error', category: 'rate_limit', message: 'slow down' }));
    expect(monitor.getState()).toEqual({ active: false });
  });

  it('clears the surface on a successful scan (recovery)', () => {
    const monitor = new ErrorMonitor();
    monitor.ingestScan(scan({ status: 'error', category: 'server', message: 'boom' }));
    expect(monitor.getState().active).toBe(true);
    monitor.ingestScan(scan({ status: 'added', message: 'ok' }));
    expect(monitor.getState()).toEqual({ active: false });
  });

  it('classifies a failing health report, carrying endpoint and api version', () => {
    const monitor = new ErrorMonitor();
    monitor.ingestHealthReport(
      report(
        [
          { name: 'Profile', endpoint: 'GET /customers/me', status: 'ok', detail: 'site_id=1' },
          {
            name: 'Search',
            endpoint: 'GET /search-suggestions',
            status: 'error',
            detail: '[schema] bad shape',
            category: 'schema',
            apiVersion: '1.40.0',
          },
        ],
        false,
        99,
      ),
    );
    expect(monitor.getState()).toEqual({
      active: true,
      error: {
        category: 'schema',
        endpoint: 'GET /search-suggestions',
        message: '[schema] bad shape',
        apiVersion: '1.40.0',
        at: 99,
      },
    });
  });

  it('leaves the state untouched on a non-ok report with no critical check', () => {
    const monitor = new ErrorMonitor();
    monitor.ingestHealthReport(
      report(
        [
          {
            name: 'Search',
            endpoint: 'GET /search-suggestions',
            status: 'error',
            detail: 'no product',
          },
        ],
        false,
      ),
    );
    // The catalogue miss is not a classified critical breakage → surface stays clear.
    expect(monitor.getState()).toEqual({ active: false });
  });

  it('clears the surface when a later health report is ok', () => {
    const monitor = new ErrorMonitor();
    monitor.ingestScan(scan({ status: 'error', category: 'network', message: 'down' }));
    expect(monitor.getState().active).toBe(true);
    monitor.ingestHealthReport(report([], true));
    expect(monitor.getState()).toEqual({ active: false });
  });

  it('emits only on genuine transitions, not on every repeat of the same incident', () => {
    const monitor = new ErrorMonitor();
    const seen: ErrorState[] = [];
    monitor.subscribe((state) => seen.push(state));

    // Same incident three times → one emission.
    monitor.ingestScan(scan({ status: 'error', category: 'auth', message: 'a' }, 1));
    monitor.ingestScan(scan({ status: 'error', category: 'auth', message: 'a' }, 2));
    monitor.ingestScan(scan({ status: 'error', category: 'auth', message: 'a' }, 3));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ active: true, error: { category: 'auth', at: 1 } });

    // Recovery → a second emission.
    monitor.ingestScan(scan({ status: 'added' }, 4));
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual({ active: false });

    // Already-clear scan → no extra emission.
    monitor.ingestScan(scan({ status: 'not_found', category: 'not_found' }, 5));
    expect(seen).toHaveLength(2);
  });

  it('unsubscribe stops further notifications', () => {
    const monitor = new ErrorMonitor();
    const listener = vi.fn();
    const off = monitor.subscribe(listener);
    off();
    monitor.ingestScan(scan({ status: 'error', category: 'server', message: 'x' }));
    expect(listener).not.toHaveBeenCalled();
  });
});
