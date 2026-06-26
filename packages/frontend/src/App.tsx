import type { JSX } from 'react';
import type { ApiVersion } from '@barclaudegateway/shared';

const apiVersion: ApiVersion = 'not-connected';

export function App(): JSX.Element {
  return (
    <main>
      <h1>BarclaudeGateway</h1>
      <p>Local control panel — coming in Phase 4.</p>
      <small>Chronodrive API: {apiVersion}</small>
    </main>
  );
}
