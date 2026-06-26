import { describe, expect, it } from 'vitest';
import type { ScanEvent } from '@barclaudegateway/shared';
import { ScanEventBus } from './scanEvents.js';

const event = (ean: string): ScanEvent => ({
  at: 1,
  response: { status: 'added', ean, message: 'ok' },
});

describe('ScanEventBus', () => {
  it('fans a published event out to every subscriber', () => {
    const bus = new ScanEventBus();
    const a: ScanEvent[] = [];
    const b: ScanEvent[] = [];
    bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));

    bus.publish(event('111'));

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]?.response.ean).toBe('111');
  });

  it('stops delivering after unsubscribe', () => {
    const bus = new ScanEventBus();
    const received: ScanEvent[] = [];
    const unsubscribe = bus.subscribe((e) => received.push(e));

    bus.publish(event('111'));
    unsubscribe();
    bus.publish(event('222'));

    expect(received.map((e) => e.response.ean)).toEqual(['111']);
  });
});
