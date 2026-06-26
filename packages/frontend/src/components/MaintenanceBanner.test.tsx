import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import type { ErrorState } from '@barclaudegateway/shared';
import { MaintenanceBanner } from './MaintenanceBanner.js';
import { renderWithProviders } from '../test/renderWithProviders.js';

describe('MaintenanceBanner', () => {
  it('shows a red banner naming the broken area and linking to maintenance when active', () => {
    const state: ErrorState = {
      active: true,
      error: { category: 'auth', message: 'auth failed', at: 1 },
    };
    renderWithProviders(<MaintenanceBanner state={state} />);

    expect(screen.getByText(/Panne détectée/)).toBeInTheDocument();
    expect(screen.getByText(/Authentification/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /page de maintenance/i })).toBeInTheDocument();
  });

  it('renders no banner when there is no active error', () => {
    // Render bare (no extra Mantine style wrapper) so we can assert the component itself emits nothing.
    const { container } = render(
      <MantineProvider>
        <MemoryRouter>
          <span data-testid="probe">
            <MaintenanceBanner state={{ active: false }} />
          </span>
        </MemoryRouter>
      </MantineProvider>,
    );
    expect(container.querySelector('[data-testid="probe"]')?.textContent).toBe('');
    expect(screen.queryByText(/Panne détectée/)).toBeNull();
  });
});
