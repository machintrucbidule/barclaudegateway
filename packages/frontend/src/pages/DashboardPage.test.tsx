import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { HealthReport, ScansResponse } from '@barclaudegateway/shared';
import { DashboardPage } from './DashboardPage.js';
import { mockFetch } from '../test/fetchMock.js';
import { renderWithProviders } from '../test/renderWithProviders.js';

const HEALTH: HealthReport = {
  ok: true,
  siteId: '1016',
  checks: [
    { name: 'Profil client', endpoint: 'GET /customers/me', status: 'ok', detail: 'site_id=1016' },
  ],
  apiVersions: {},
  checkedAt: 0,
};

const SCANS: ScansResponse = {
  count: 2,
  scans: [
    { id: 2, createdAt: 1000, ean: '222', outcome: 'not_found', message: 'EAN not in catalogue' },
    { id: 1, createdAt: 900, ean: '111', outcome: 'added', message: 'Added "X"' },
  ],
};

describe('DashboardPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows health, session status, recent scans and a not-found alert', async () => {
    mockFetch((url) => {
      if (url.includes('/api/health')) return { body: HEALTH };
      if (url.includes('/api/scans')) return { body: SCANS };
      return { body: {} };
    });

    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('Opérationnel')).toBeInTheDocument();
    expect(screen.getByText('actif')).toBeInTheDocument();

    // Recent scans rendered with their status badges.
    expect(await screen.findByText('Ajouté')).toBeInTheDocument();
    expect(screen.getByText('Introuvable')).toBeInTheDocument();
    expect(screen.getByText('111')).toBeInTheDocument();

    // The not-found alert (CLARIFY-01) surfaces the unmatched EAN.
    expect(screen.getByText('Produits introuvables')).toBeInTheDocument();
    // The unmatched EAN appears both in the alert and the table row.
    expect(screen.getAllByText(/222/).length).toBeGreaterThan(0);
  });

  it('shows an informational message (not an error) when not configured', async () => {
    const NOT_CONFIGURED: HealthReport = {
      ok: false,
      configured: false,
      checks: [],
      apiVersions: {},
      checkedAt: 0,
    };
    mockFetch((url) => {
      if (url.includes('/api/health')) return { body: NOT_CONFIGURED };
      if (url.includes('/api/scans')) return { body: SCANS };
      return { body: {} };
    });

    renderWithProviders(<DashboardPage />);

    // Informational call-to-action, not the degraded/error state.
    expect(await screen.findByText("Chronodrive n'est pas encore configuré")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'page Configuration' })).toHaveAttribute(
      'href',
      '/config',
    );
    // The degraded health badge must NOT be shown.
    expect(screen.queryByText('Dégradé')).not.toBeInTheDocument();
  });
});
