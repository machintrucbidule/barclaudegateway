/**
 * Global critical-error banner (Phase 5).
 *
 * Rendered at the top of the app shell on every page. When a critical API error is active it shows a
 * red alert naming what broke and links to the dedicated maintenance page; otherwise it renders nothing
 * and auto-clears once the backend reports recovery.
 */

import type { JSX } from 'react';
import { Alert, Anchor } from '@mantine/core';
import { Link } from 'react-router-dom';
import type { ErrorState } from '@barclaudegateway/shared';
import { errorCategoryLabel } from './errorCategory.js';

export function MaintenanceBanner({ state }: { state: ErrorState }): JSX.Element | null {
  if (!state.active || !state.error) return null;
  const meta = errorCategoryLabel(state.error.category);
  return (
    <Alert color="red" variant="filled" title={`Panne détectée : ${meta.label}`} radius={0}>
      {meta.explanation}{' '}
      <Anchor component={Link} to="/maintenance" c="white" fw={700} underline="always">
        Voir la page de maintenance
      </Anchor>
    </Alert>
  );
}
