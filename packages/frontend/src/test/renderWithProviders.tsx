import type { ReactElement } from 'react';
import type { RenderResult } from '@testing-library/react';
import { render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';

/** Render a component inside the providers it expects at runtime (Mantine theme + a router). */
export function renderWithProviders(ui: ReactElement, route = '/'): RenderResult {
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </MantineProvider>,
  );
}
