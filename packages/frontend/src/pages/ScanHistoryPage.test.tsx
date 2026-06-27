import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ScansResponse } from '@barclaudegateway/shared';
import { ScanHistoryPage } from './ScanHistoryPage.js';
import { mockFetch } from '../test/fetchMock.js';
import { renderWithProviders } from '../test/renderWithProviders.js';

const PAGE: ScansResponse = {
  total: 2,
  page: 1,
  pageSize: 100,
  scans: [
    { id: 2, createdAt: 1000, ean: '222', outcome: 'not_found', message: 'EAN not in catalogue' },
    { id: 1, createdAt: 900, ean: '111', outcome: 'added', message: 'Added "X"' },
  ],
};

describe('ScanHistoryPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists scanned codes with their status (no live stream)', async () => {
    mockFetch((url) => (url.includes('/api/scans') ? { body: PAGE } : { body: {} }));
    renderWithProviders(<ScanHistoryPage />);

    expect(await screen.findByText('111')).toBeInTheDocument();
    expect(screen.getByText('222')).toBeInTheDocument();
    // The status badge for the not_found row (scoped to the table to avoid the filter's option labels).
    expect(screen.getByRole('table')).toHaveTextContent('Introuvable');
    expect(screen.getByText(/2 scan/)).toBeInTheDocument();
  });

  it('requests the default page size of 100', async () => {
    const { calls } = mockFetch((url) =>
      url.includes('/api/scans') ? { body: PAGE } : { body: {} },
    );
    renderWithProviders(<ScanHistoryPage />);
    await screen.findByText('111');

    expect(calls.some((c) => c.url.includes('pageSize=100'))).toBe(true);
  });

  it('passes the search term to the API as it changes', async () => {
    const { calls } = mockFetch((url) =>
      url.includes('/api/scans') ? { body: PAGE } : { body: {} },
    );
    renderWithProviders(<ScanHistoryPage />);
    await screen.findByText('111');

    fireEvent.change(screen.getByLabelText('Recherche (EAN ou message)'), {
      target: { value: '222' },
    });

    await waitFor(() => {
      expect(calls.some((c) => c.url.includes('search=222'))).toBe(true);
    });
  });
});
