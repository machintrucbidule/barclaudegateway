import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { PriceTrackingSettings, TrackedProductsResponse } from '@barclaudegateway/shared';
import { PriceTrackingPage } from './PriceTrackingPage.js';
import { mockFetch } from '../test/fetchMock.js';
import type { MockCall } from '../test/fetchMock.js';
import { renderWithProviders } from '../test/renderWithProviders.js';

const PRODUCTS: TrackedProductsResponse = {
  products: [
    {
      productId: '91574',
      ean: '3596710335510',
      label: 'Mozzarella',
      threshold: 1.5,
      lastPrice: 1.79,
      armed: true,
    },
  ],
};
const SETTINGS: PriceTrackingSettings = { enabled: false, intervalHours: 12 };

function install(): { calls: MockCall[] } {
  return mockFetch((url, method, body) => {
    if (url.includes('/api/price-tracking/settings')) {
      return method === 'PUT' ? { body } : { body: SETTINGS };
    }
    if (url.includes('/api/price-tracking/check-now')) return { body: { checked: 1, alerts: 0 } };
    if (url.match(/\/api\/price-tracking\/[^/]+$/) && method === 'DELETE')
      return { body: { removed: '91574' } };
    if (url.includes('/api/price-tracking') && method === 'POST')
      return { body: { productId: '777', threshold: 2, armed: true } };
    if (url.includes('/api/price-tracking')) return { body: PRODUCTS };
    return { body: {} };
  });
}

describe('PriceTrackingPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists tracked products with their price and threshold', async () => {
    install();
    renderWithProviders(<PriceTrackingPage />);
    expect(await screen.findByText('Mozzarella')).toBeInTheDocument();
    expect(screen.getByText('1.79 €')).toBeInTheDocument();
  });

  it('adds a product by EAN (POST /api/price-tracking)', async () => {
    const { calls } = install();
    renderWithProviders(<PriceTrackingPage />);
    await screen.findByText('Mozzarella');

    fireEvent.change(screen.getByLabelText('EAN (code-barres)'), {
      target: { value: '3596710335510' },
    });
    fireEvent.change(screen.getByLabelText("Seuil d'alerte (€)"), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Suivre' }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/price-tracking'));
      expect(post?.body).toMatchObject({ ean: '3596710335510', threshold: 2 });
    });
  });

  it('removes a tracked product (DELETE)', async () => {
    const { calls } = install();
    renderWithProviders(<PriceTrackingPage />);
    await screen.findByText('Mozzarella');

    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    await waitFor(() => {
      expect(
        calls.some((c) => c.method === 'DELETE' && c.url.includes('/api/price-tracking/91574')),
      ).toBe(true);
    });
  });

  it('saves the scheduler settings (PUT /api/price-tracking/settings)', async () => {
    const { calls } = install();
    renderWithProviders(<PriceTrackingPage />);
    await screen.findByText('Mozzarella');

    fireEvent.click(screen.getByLabelText('Activer le suivi automatique des prix'));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les réglages' }));

    await waitFor(() => {
      const put = calls.find(
        (c) => c.method === 'PUT' && c.url.includes('/api/price-tracking/settings'),
      );
      expect(put?.body).toMatchObject({ enabled: true });
    });
  });
});
