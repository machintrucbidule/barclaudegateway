import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import type { ErrorState } from '@barclaudegateway/shared';
import { MaintenancePage } from './MaintenancePage.js';
import { mockFetch } from '../test/fetchMock.js';
import { renderWithProviders } from '../test/renderWithProviders.js';

/** jsdom has no EventSource: drive the error-state stream directly. */
class MockEventSource {
  static last: MockEventSource | null = null;
  onmessage: ((e: MessageEvent<string>) => void) | null = null;
  constructor(readonly url: string) {
    MockEventSource.last = this;
  }
  close(): void {}
}

function installInactive(): void {
  mockFetch((url) =>
    url.includes('/api/error-state') ? { body: { active: false } } : { body: {} },
  );
  vi.stubGlobal('EventSource', MockEventSource);
}

describe('MaintenancePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    MockEventSource.last = null;
  });

  it('shows the calm state and the HAR tutorial when nothing is broken', async () => {
    installInactive();
    renderWithProviders(<MaintenancePage />);

    expect(await screen.findByText('Aucune panne en cours')).toBeInTheDocument();
    expect(screen.getByText(/Capturer une trace réseau/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copier le prompt' })).toBeInTheDocument();
  });

  it('renders an active error in French with a debug prompt carrying the error context', async () => {
    installInactive();
    renderWithProviders(<MaintenancePage />);

    // Calm until an error is pushed.
    expect(await screen.findByText('Aucune panne en cours')).toBeInTheDocument();

    const state: ErrorState = {
      active: true,
      error: {
        category: 'schema',
        endpoint: 'GET /search-suggestions',
        message: '[schema] bad shape',
        apiVersion: '1.40.0',
        at: 1_700_000_000_000,
      },
    };
    act(() => {
      MockEventSource.last?.onmessage?.({ data: JSON.stringify(state) } as MessageEvent<string>);
    });

    expect(await screen.findByText('Une panne est en cours')).toBeInTheDocument();
    expect(screen.getByText('Format de réponse')).toBeInTheDocument();
    // The prompt is prefilled and references the contract diff workflow (unique to the prompt text).
    expect(screen.getByText(/specifications\/api\/chronodrive\/contract\.md/)).toBeInTheDocument();
    // The observed endpoint surfaces both in the panel and inside the prompt.
    expect(screen.getAllByText(/GET \/search-suggestions/).length).toBeGreaterThan(0);
  });
});
