import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import type { ScanEvent } from '@barclaudegateway/shared';
import { LogsPage } from './LogsPage.js';
import { mockFetch } from '../test/fetchMock.js';
import { renderWithProviders } from '../test/renderWithProviders.js';

/** Minimal controllable EventSource: jsdom has none, so the test drives it directly. */
class MockEventSource {
  static last: MockEventSource | null = null;
  onmessage: ((e: MessageEvent<string>) => void) | null = null;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  constructor(readonly url: string) {
    MockEventSource.last = this;
  }
  close(): void {}
}

describe('LogsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    MockEventSource.last = null;
  });

  it('renders a scan pushed over the live stream', async () => {
    mockFetch((url) =>
      url.includes('/api/scans') ? { body: { count: 0, scans: [] } } : { body: {} },
    );
    vi.stubGlobal('EventSource', MockEventSource);

    renderWithProviders(<LogsPage />);

    // Empty until the first event arrives.
    expect(await screen.findByText('En attente de scans…')).toBeInTheDocument();

    const source = MockEventSource.last;
    expect(source).not.toBeNull();
    const event: ScanEvent = {
      at: 123,
      response: { status: 'added', ean: '999', message: 'Added "Gros sel"' },
    };
    act(() => {
      source?.onopen?.(new Event('open'));
      source?.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>);
    });

    expect(await screen.findByText('999')).toBeInTheDocument();
    expect(screen.getByText('Ajouté')).toBeInTheDocument();
    expect(screen.getByText('connecté')).toBeInTheDocument();
  });
});
