import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import type { LogEvent } from '@barclaudegateway/shared';
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

const emptyEvents = { events: [], total: 0, page: 1, pageSize: 200 };

function logEvent(over: Partial<LogEvent>): MessageEvent<string> {
  const base: LogEvent = {
    id: 1,
    at: 123,
    category: 'auth',
    type: 'login_complete',
    level: 'info',
    message: 'Full login complete',
  };
  return { data: JSON.stringify({ ...base, ...over }) } as MessageEvent<string>;
}

describe('LogsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    MockEventSource.last = null;
  });

  it('renders an event pushed over the live operational-log stream', async () => {
    mockFetch((url) => (url.includes('/api/events') ? { body: emptyEvents } : { body: {} }));
    vi.stubGlobal('EventSource', MockEventSource);

    renderWithProviders(<LogsPage />);

    expect(await screen.findByText("En attente d'événements…")).toBeInTheDocument();

    const source = MockEventSource.last;
    expect(source).not.toBeNull();
    act(() => {
      source?.onopen?.(new Event('open'));
      source?.onmessage?.(logEvent({ message: 'Full login complete' }));
    });

    expect(await screen.findByText('Full login complete')).toBeInTheDocument();
    expect(screen.getByText('login_complete')).toBeInTheDocument();
    expect(screen.getByText('connecté')).toBeInTheDocument();
  });

  it('shows a failing step clearly (error level)', async () => {
    mockFetch((url) => (url.includes('/api/events') ? { body: emptyEvents } : { body: {} }));
    vi.stubGlobal('EventSource', MockEventSource);

    renderWithProviders(<LogsPage />);
    await screen.findByText("En attente d'événements…");
    const source = MockEventSource.last;
    act(() => {
      source?.onmessage?.(
        logEvent({
          id: 9,
          category: 'scan',
          type: 'search_request',
          level: 'error',
          message: 'Search failed: [server 500]',
        }),
      );
    });

    expect(await screen.findByText('Search failed: [server 500]')).toBeInTheDocument();
    expect(screen.getByText('Erreur')).toBeInTheDocument();
  });

  it('gates the live tail by the selected category', async () => {
    mockFetch((url) => (url.includes('/api/events') ? { body: emptyEvents } : { body: {} }));
    vi.stubGlobal('EventSource', MockEventSource);

    renderWithProviders(<LogsPage />);
    await screen.findByText("En attente d'événements…");
    const source = MockEventSource.last;
    act(() => source?.onopen?.(new Event('open')));

    // Restrict to Authentification.
    fireEvent.click(screen.getByText('Authentification'));

    // A scan event is now gated out…
    act(() => {
      source?.onmessage?.(
        logEvent({ id: 1, category: 'scan', type: 'scan_complete', message: 'scanned' }),
      );
    });
    expect(screen.queryByText('scanned')).not.toBeInTheDocument();

    // …while an auth event passes the filter.
    act(() => {
      source?.onmessage?.(
        logEvent({ id: 2, category: 'auth', type: 'login_complete', message: 'logged in' }),
      );
    });
    expect(await screen.findByText('logged in')).toBeInTheDocument();
  });
});
