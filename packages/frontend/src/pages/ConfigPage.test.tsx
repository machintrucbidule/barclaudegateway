import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ConfigResponse, DestinationsResponse } from '@barclaudegateway/shared';
import { ConfigPage } from './ConfigPage.js';
import { mockFetch } from '../test/fetchMock.js';
import type { MockCall } from '../test/fetchMock.js';
import { renderWithProviders } from '../test/renderWithProviders.js';

const CONFIG: ConfigResponse = {
  clientId: 'CID',
  redirectUri: 'https://www.chronodrive.com',
  scope: 'openid',
  identityBaseUrl: 'https://connect.chronodrive.com',
  apiBaseUrl: 'https://api.chronodrive.com/v1',
  apiKeys: { search: 'S', customerCartRead: 'C', cartWrite: 'W', shoppingLists: 'L' },
  siteMode: 'DRIVE',
  siteId: '',
  haWebhookUrl: '',
  credentials: { set: false },
};

const DESTINATIONS: DestinationsResponse = {
  enabled: { cart: false, lists: [] },
  available: {
    cart: { name: 'Panier' },
    lists: [
      {
        id: 'L1',
        name: 'Classiques',
        nbItems: 3,
        hasAvailableProduct: true,
        createdAt: '',
        updatedAt: '',
      },
    ],
  },
};

function install(): { calls: MockCall[] } {
  return mockFetch((url, method, body) => {
    if (url.includes('/api/config/destinations')) {
      return method === 'PUT' ? { body } : { body: DESTINATIONS };
    }
    if (url.includes('/api/credentials')) return { body: { credentials: { set: true } } };
    if (url.includes('/api/notify/test')) return { body: { ok: true, status: 200 } };
    if (url.includes('/api/config')) return method === 'PUT' ? { body } : { body: CONFIG };
    return { body: {} };
  });
}

describe('ConfigPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips the destination checkboxes through PUT /api/config/destinations', async () => {
    const { calls } = install();
    renderWithProviders(<ConfigPage />);

    const cart = await screen.findByLabelText('Panier');
    const classiques = await screen.findByLabelText('Classiques');
    fireEvent.click(cart);
    fireEvent.click(classiques);
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les destinations' }));

    await waitFor(() => {
      const put = calls.find(
        (c) => c.method === 'PUT' && c.url.includes('/api/config/destinations'),
      );
      expect(put?.body).toEqual({ cart: true, lists: [{ id: 'L1', name: 'Classiques' }] });
    });
  });

  it('credentials are write-only: sends them, clears the field, shows "configurés"', async () => {
    const { calls } = install();
    renderWithProviders(<ConfigPage />);

    const email = await screen.findByLabelText('Adresse e-mail');
    const password = await screen.findByLabelText('Mot de passe');
    fireEvent.change(email, { target: { value: 'user@example.com' } });
    fireEvent.change(password, { target: { value: 's3cret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les identifiants' }));

    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/api/credentials'));
      expect(put?.body).toEqual({ email: 'user@example.com', password: 's3cret' });
    });

    // Field cleared after sending; status reflects "configurés".
    await waitFor(() => {
      expect((password as HTMLInputElement).value).toBe('');
    });
    expect(await screen.findByText('configurés')).toBeInTheDocument();
  });

  it('saves the Home Assistant webhook URL and sends a test', async () => {
    const { calls } = install();
    renderWithProviders(<ConfigPage />);

    const field = await screen.findByLabelText('URL du webhook Home Assistant (optionnel)');
    fireEvent.change(field, { target: { value: 'https://ha.local/api/webhook/abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      const put = calls.find(
        (c) =>
          c.method === 'PUT' && c.url.includes('/api/config') && !c.url.includes('destinations'),
      );
      expect(put?.body).toMatchObject({ haWebhookUrl: 'https://ha.local/api/webhook/abc' });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Tester le webhook' }));

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('/api/notify/test'))).toBe(
        true,
      );
    });
    expect(await screen.findByText(/Home Assistant a bien reçu/)).toBeInTheDocument();
  });
});
