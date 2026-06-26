import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { App } from './App.js';
import { mockFetch } from './test/fetchMock.js';
import { renderWithProviders } from './test/renderWithProviders.js';

const EMPTY_HEALTH = { ok: true, checks: [], apiVersions: {}, checkedAt: 0 };
const EMPTY_SCANS = { count: 0, scans: [] };

/** The app shell subscribes to the error-state SSE stream; jsdom has no EventSource, so stub it. */
class MockEventSource {
  onmessage: ((e: MessageEvent<string>) => void) | null = null;
  constructor(readonly url: string) {}
  close(): void {}
}

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the application title and navigation', async () => {
    mockFetch((url) => {
      if (url.includes('/api/health')) return { body: EMPTY_HEALTH };
      if (url.includes('/api/scans')) return { body: EMPTY_SCANS };
      if (url.includes('/api/error-state')) return { body: { active: false } };
      return { body: {} };
    });
    vi.stubGlobal('EventSource', MockEventSource);

    renderWithProviders(<App />, '/dashboard');

    expect(screen.getByRole('heading', { name: 'BarclaudeGateway' })).toBeInTheDocument();
    expect(await screen.findByText('Configuration')).toBeInTheDocument();
    expect(screen.getByText('Journal en direct')).toBeInTheDocument();
  });
});
