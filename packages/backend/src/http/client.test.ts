import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import type { Dispatcher } from 'undici';
import { HttpClient } from './client.js';
import { NetworkError, RateLimitError, SchemaError, ServerError, TimeoutError } from './errors.js';

const BASE = 'https://api.test.local';

function makeClient(): HttpClient {
  // Deterministic retries: no real waiting, fixed jitter, tiny backoff.
  return new HttpClient({
    sleep: async () => {},
    random: () => 0,
    timeoutMs: 1_000,
    retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 },
  });
}

describe('HttpClient (mocked transport)', () => {
  let mockAgent: MockAgent;
  let original: Dispatcher;

  beforeEach(() => {
    original = getGlobalDispatcher();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
  });

  afterEach(async () => {
    await mockAgent.close();
    setGlobalDispatcher(original);
  });

  it('parses JSON and surfaces x-api-version and raw Set-Cookie', async () => {
    mockAgent
      .get(BASE)
      .intercept({ path: '/data', method: 'GET' })
      .reply(
        200,
        { value: 42 },
        {
          headers: {
            'x-api-version': '1.9.0',
            'set-cookie': ['__Host-SESSION=abc; HttpOnly', '__Host-SESSION_LEGACY=abc; HttpOnly'],
          },
        },
      );

    const res = await makeClient().requestJson<{ value: number }>(`${BASE}/data`);
    expect(res.status).toBe(200);
    expect(res.data.value).toBe(42);
    expect(res.apiVersion).toBe('1.9.0');
    expect(res.setCookie).toHaveLength(2);
    expect(res.setCookie[0]).toContain('__Host-SESSION=abc');
  });

  it('returns the raw text body', async () => {
    mockAgent
      .get(BASE)
      .intercept({ path: '/html', method: 'GET' })
      .reply(200, '<script>ok</script>', { headers: { 'content-type': 'text/html' } });

    const res = await makeClient().requestText(`${BASE}/html`);
    expect(res.data).toBe('<script>ok</script>');
  });

  it('treats an empty body as undefined data', async () => {
    mockAgent.get(BASE).intercept({ path: '/empty', method: 'PATCH' }).reply(204, '');
    const res = await makeClient().requestJson(`${BASE}/empty`, { method: 'PATCH' });
    expect(res.status).toBe(204);
    expect(res.data).toBeUndefined();
  });

  it('JSON-serializes object bodies and sets content-type', async () => {
    let seenContentType: string | undefined;
    let seenBody: string | undefined;
    mockAgent
      .get(BASE)
      .intercept({ path: '/echo', method: 'POST' })
      .reply(200, (opts) => {
        const headers = opts.headers as Record<string, string>;
        seenContentType = headers['content-type'] ?? headers['Content-Type'];
        seenBody = opts.body as string;
        return { ok: true };
      });

    await makeClient().requestJson(`${BASE}/echo`, { method: 'POST', body: { a: 1 } });
    expect(seenContentType).toContain('application/json');
    expect(seenBody).toBe('{"a":1}');
  });

  it('retries on 429 then succeeds, honouring Retry-After', async () => {
    const pool = mockAgent.get(BASE);
    pool
      .intercept({ path: '/flaky', method: 'GET' })
      .reply(429, 'slow down', { headers: { 'retry-after': '0' } });
    pool.intercept({ path: '/flaky', method: 'GET' }).reply(200, { ok: true });

    const res = await makeClient().requestJson<{ ok: boolean }>(`${BASE}/flaky`);
    expect(res.data.ok).toBe(true);
  });

  it('throws RateLimitError after exhausting retries on 429', async () => {
    mockAgent
      .get(BASE)
      .intercept({ path: '/limited', method: 'GET' })
      .reply(429, 'no', { headers: { 'retry-after': '7' } })
      .persist();

    await expect(makeClient().requestJson(`${BASE}/limited`)).rejects.toMatchObject({
      category: 'rate_limit',
      retryAfterSeconds: 7,
    });
    await expect(makeClient().requestJson(`${BASE}/limited`)).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it('throws ServerError after exhausting retries on 5xx', async () => {
    mockAgent.get(BASE).intercept({ path: '/down', method: 'GET' }).reply(503, 'boom').persist();
    await expect(makeClient().requestJson(`${BASE}/down`)).rejects.toBeInstanceOf(ServerError);
  });

  it('throws NetworkError on a connection failure', async () => {
    mockAgent
      .get(BASE)
      .intercept({ path: '/dead', method: 'GET' })
      .replyWithError(new Error('ECONNREFUSED'))
      .persist();
    await expect(makeClient().requestJson(`${BASE}/dead`)).rejects.toBeInstanceOf(NetworkError);
  });

  it('throws SchemaError on invalid JSON in a 200 response', async () => {
    mockAgent.get(BASE).intercept({ path: '/garbage', method: 'GET' }).reply(200, 'not json{');
    await expect(makeClient().requestJson(`${BASE}/garbage`)).rejects.toBeInstanceOf(SchemaError);
  });

  it('does not retry business 4xx — returns the response to the caller', async () => {
    mockAgent.get(BASE).intercept({ path: '/nope', method: 'GET' }).reply(404, { error: 'nope' });
    const res = await makeClient().requestJson<{ error: string }>(`${BASE}/nope`);
    expect(res.status).toBe(404);
    expect(res.data.error).toBe('nope');
  });
});

describe('HttpClient timeout (real transport)', () => {
  let server: http.Server;
  let url: string;

  beforeEach(async () => {
    server = http.createServer((_req, res) => {
      // Never responds within the test timeout window.
      void res;
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    url = `http://127.0.0.1:${port}/slow`;
  });

  afterEach(() => {
    server.closeAllConnections?.();
    server.close();
  });

  it('aborts and throws TimeoutError when the deadline passes', async () => {
    const client = new HttpClient({
      sleep: async () => {},
      random: () => 0,
      timeoutMs: 50,
      retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
    });
    await expect(client.requestJson(url)).rejects.toBeInstanceOf(TimeoutError);
  });
});
