/**
 * Live critical-error state (Phase 5).
 *
 * Fetches the current state once on mount (so the banner/page are correct on first paint), then opens
 * an SSE stream and updates on every transition the backend pushes. Mirrors the LogsPage EventSource
 * pattern. Returns the latest {@link ErrorState}; `active` is false until a critical error is detected.
 */

import { useEffect, useState } from 'react';
import type { ErrorState } from '@barclaudegateway/shared';
import { api } from '../api/client.js';

export function useErrorState(): ErrorState {
  const [state, setState] = useState<ErrorState>({ active: false });

  useEffect(() => {
    let active = true;

    // Initial value, so the surface is right before the first SSE message arrives.
    void api
      .getErrorState()
      .then((fresh) => {
        if (active) setState(fresh);
      })
      .catch(() => {
        // A failed preload is non-fatal: the stream below still delivers the live state.
      });

    const source = new EventSource('/api/error-state/stream');
    source.onmessage = (event: MessageEvent<string>): void => {
      if (!active) return;
      setState(JSON.parse(event.data) as ErrorState);
    };

    return () => {
      active = false;
      source.close();
    };
  }, []);

  return state;
}
