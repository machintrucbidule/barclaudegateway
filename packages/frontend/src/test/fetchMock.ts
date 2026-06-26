import { vi } from 'vitest';

export interface MockCall {
  url: string;
  method: string;
  body: unknown;
}

export interface MockReply {
  status?: number;
  body?: unknown;
}

/** Route a fake `fetch` by URL + method; returns the recorded calls so tests can assert on them. */
export function mockFetch(
  handler: (url: string, method: string, body: unknown) => MockReply | undefined,
): { calls: MockCall[] } {
  const calls: MockCall[] = [];
  const fn = vi.fn((url: string | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), method, body });
    const reply = handler(String(url), method, body) ?? {};
    const status = reply.status ?? 200;
    const response: Pick<Response, 'ok' | 'status' | 'text'> = {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (reply.body === undefined ? '' : JSON.stringify(reply.body)),
    };
    return Promise.resolve(response as Response);
  });
  vi.stubGlobal('fetch', fn);
  return { calls };
}
