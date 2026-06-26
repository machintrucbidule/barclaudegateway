import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import type { Dispatcher } from 'undici';
import { HttpClient } from '../http/client.js';
import type { AuthConfig } from './login.js';
import { REFRESH_SKEW_MS, TokenLifecycle } from './lifecycle.js';
import { SessionStore } from './session.js';

const IDENTITY = 'https://connect.test.local';
const CONFIG: AuthConfig = {
  identityBaseUrl: IDENTITY,
  clientId: 'CLIENT',
  redirectUri: 'https://www.test.local',
  scope: 'openid',
};
const CREDS = { email: 'user@example.com', password: 'secret' };
const SESSION_COOKIES = ['__Host-SESSION=sess; HttpOnly', '__Host-SESSION_LEGACY=sess; HttpOnly'];

function makeJwt(expSeconds: number): string {
  const enc = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${enc({ alg: 'RS256' })}.${enc({ exp: expSeconds })}.sig`;
}
const AUTHORIZE_HTML = `<script>postMessage({response:{code:'C'}})</script>`;
const authorizePath = (p: string): boolean => p.split('?')[0] === '/oauth/authorize';

// Large timeout so undici's abort timer never fires while we fast-forward fake timers.
function lifecycleClient(): HttpClient {
  return new HttpClient({
    sleep: async () => {},
    random: () => 0,
    timeoutMs: 1_000_000_000,
    retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
  });
}

describe('TokenLifecycle.msUntilRefresh', () => {
  it('schedules the refresh at exp − skew, never negative', () => {
    const lc = new TokenLifecycle({
      http: lifecycleClient(),
      config: CONFIG,
      loadCredentials: async () => CREDS,
    });
    const session = { accessToken: 't', idToken: 'i', expiresAtMs: 1_000_000, cookieHeader: 'c' };
    expect(lc.msUntilRefresh(session, 0)).toBe(1_000_000 - REFRESH_SKEW_MS);
    expect(lc.msUntilRefresh(session, 1_000_000)).toBe(0); // past exp → clamped
  });
});

describe('TokenLifecycle (mocked transport)', () => {
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

  it('returns the cached token without any network call while still valid', async () => {
    const store = new SessionStore();
    store.set({ accessToken: 'CACHED', idToken: 'i', expiresAtMs: 1_000_000, cookieHeader: 'c' });
    let loaded = false;
    const lc = new TokenLifecycle({
      http: lifecycleClient(),
      config: CONFIG,
      loadCredentials: async () => {
        loaded = true;
        return CREDS;
      },
      store,
      now: () => 0,
    });
    expect(await lc.getAccessToken()).toBe('CACHED');
    expect(loaded).toBe(false);
    lc.stop();
  });

  it('performs a full login when there is no session', async () => {
    const exp = Math.floor(Date.now() / 1000) + 7200;
    const pool = mockAgent.get(IDENTITY);
    pool
      .intercept({ path: '/identity/v1/password/login', method: 'POST' })
      .reply(200, { tkn: 'TKN' });
    pool.intercept({ path: authorizePath, method: 'GET' }).reply(200, AUTHORIZE_HTML, {
      headers: { 'content-type': 'text/html', 'set-cookie': SESSION_COOKIES },
    });
    pool.intercept({ path: '/oauth/token', method: 'POST' }).reply(200, {
      access_token: makeJwt(exp),
      id_token: 'ID',
      expires_in: 7200,
      token_type: 'Bearer',
    });

    const lc = new TokenLifecycle({
      http: lifecycleClient(),
      config: CONFIG,
      loadCredentials: async () => CREDS,
    });
    const token = await lc.start();
    expect(token).toBe(makeJwt(exp));
    expect(lc.getSession()?.cookieHeader).toContain('__Host-SESSION=sess');
    lc.stop();
  });

  it('falls back to full login when a silent refresh hits login_required', async () => {
    const exp = Math.floor(Date.now() / 1000) + 7200;
    let passwordCalls = 0;
    const store = new SessionStore();
    store.set({
      accessToken: 'OLD',
      idToken: 'old',
      expiresAtMs: 0,
      cookieHeader: '__Host-SESSION=old',
    });

    const pool = mockAgent.get(IDENTITY);
    // 1) silent-refresh authorize → session too old
    pool
      .intercept({ path: authorizePath, method: 'GET' })
      .reply(200, '{"error":"login_required"}', {
        headers: { 'content-type': 'application/json' },
      });
    // 2) full-login password
    pool.intercept({ path: '/identity/v1/password/login', method: 'POST' }).reply(200, () => {
      passwordCalls += 1;
      return { tkn: 'TKN' };
    });
    // 3) full-login authorize → success + cookie
    pool.intercept({ path: authorizePath, method: 'GET' }).reply(200, AUTHORIZE_HTML, {
      headers: { 'content-type': 'text/html', 'set-cookie': SESSION_COOKIES },
    });
    // 4) token exchange
    pool.intercept({ path: '/oauth/token', method: 'POST' }).reply(200, {
      access_token: makeJwt(exp),
      id_token: 'NEW',
      expires_in: 7200,
      token_type: 'Bearer',
    });

    const lc = new TokenLifecycle({
      http: lifecycleClient(),
      config: CONFIG,
      loadCredentials: async () => CREDS,
      store,
    });
    const session = await lc.refresh();
    expect(passwordCalls).toBe(1);
    expect(session.idToken).toBe('NEW');
    lc.stop();
  });

  it('arms a timer that silently refreshes at exp − 60s', async () => {
    vi.useFakeTimers();
    try {
      let tokenCalls = 0;
      let passwordCalls = 0;
      const pool = mockAgent.get(IDENTITY);
      pool
        .intercept({ path: '/identity/v1/password/login', method: 'POST' })
        .reply(200, () => {
          passwordCalls += 1;
          return { tkn: 'TKN' };
        })
        .persist();
      pool
        .intercept({ path: authorizePath, method: 'GET' })
        .reply(200, AUTHORIZE_HTML, {
          headers: { 'content-type': 'text/html', 'set-cookie': SESSION_COOKIES },
        })
        .persist();
      pool
        .intercept({ path: '/oauth/token', method: 'POST' })
        .reply(200, () => {
          tokenCalls += 1;
          return {
            access_token: makeJwt(Math.floor(Date.now() / 1000) + 7200),
            id_token: 'ID',
            expires_in: 7200,
            token_type: 'Bearer',
          };
        })
        .persist();

      const lc = new TokenLifecycle({
        http: lifecycleClient(),
        config: CONFIG,
        loadCredentials: async () => CREDS,
      });
      await lc.start();
      expect(tokenCalls).toBe(1);
      expect(passwordCalls).toBe(1);

      // Fast-forward to the scheduled refresh (2h − 60s).
      await vi.advanceTimersByTimeAsync(7200_000 - REFRESH_SKEW_MS);

      expect(tokenCalls).toBe(2); // refreshed once on the timer…
      expect(passwordCalls).toBe(1); // …silently, without re-sending the password.
      lc.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
