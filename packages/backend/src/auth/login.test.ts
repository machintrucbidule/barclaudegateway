import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import type { Dispatcher } from 'undici';
import { HttpClient } from '../http/client.js';
import { AuthError, LoginRequiredError } from '../http/errors.js';
import type { AuthConfig } from './login.js';
import {
  allCookiesHeader,
  extractSessionCookieHeader,
  parseAuthCode,
  performFullLogin,
  performSilentRefresh,
} from './login.js';

const IDENTITY = 'https://connect.test.local';

const CONFIG: AuthConfig = {
  identityBaseUrl: IDENTITY,
  clientId: 'CLIENT',
  redirectUri: 'https://www.test.local',
  scope: 'openid profile',
};

const CREDS = { email: 'user@example.com', password: 'secret' };

function makeJwt(expSeconds: number): string {
  const enc = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${enc({ alg: 'RS256' })}.${enc({ exp: expSeconds })}.sig`;
}

const AUTHORIZE_HTML = (code: string): string =>
  `<script>window.parent.postMessage({type:'authorization_response',response:{code:'${code}'}},'*');</script>`;

const SESSION_COOKIES = [
  '__Host-SESSION=sess123; Path=/; HttpOnly; Secure; SameSite=None',
  '__Host-SESSION_LEGACY=sess123; Path=/; HttpOnly; Secure',
];

function authorizePath(p: string): boolean {
  return p.split('?')[0] === '/oauth/authorize';
}

function quietClient(): HttpClient {
  return new HttpClient({
    sleep: async () => {},
    random: () => 0,
    retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
  });
}

describe('cookie + auth-code parsing helpers', () => {
  it('keeps only the session cookies in the replay header', () => {
    const header = extractSessionCookieHeader([
      ...SESSION_COOKIES,
      '__cf_bm=tracking; Path=/',
      'other=1',
    ]);
    expect(header).toBe('__Host-SESSION=sess123; __Host-SESSION_LEGACY=sess123');
  });

  it('parses the auth code from single- and double-quoted HTML', () => {
    expect(parseAuthCode(AUTHORIZE_HTML('CODE_A'))).toBe('CODE_A');
    expect(parseAuthCode('{"code":"CODE_B"}')).toBe('CODE_B');
    expect(parseAuthCode('<html>no code here</html>')).toBeUndefined();
  });

  it('builds a Cookie header from all Set-Cookie entries', () => {
    expect(allCookiesHeader(['reach5session=R5; HttpOnly', '__cf_bm=CF; Path=/'])).toBe(
      'reach5session=R5; __cf_bm=CF',
    );
  });
});

describe('Reach5 login flows (mocked)', () => {
  let mockAgent: MockAgent;
  let original: Dispatcher;
  const exp = Math.floor(Date.now() / 1000) + 7200;

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

  it('performs a full 3-step login and captures the session cookie', async () => {
    const pool = mockAgent.get(IDENTITY);
    pool
      .intercept({ path: '/identity/v1/password/login', method: 'POST' })
      .reply(200, { tkn: 'TKN' });
    pool.intercept({ path: authorizePath, method: 'GET' }).reply(200, AUTHORIZE_HTML('AUTHCODE'), {
      headers: { 'content-type': 'text/html', 'set-cookie': SESSION_COOKIES },
    });
    pool.intercept({ path: '/oauth/token', method: 'POST' }).reply(200, {
      access_token: makeJwt(exp),
      id_token: 'ID',
      expires_in: 7200,
      token_type: 'Bearer',
    });

    const session = await performFullLogin(quietClient(), CONFIG, CREDS);
    expect(session.accessToken).toBe(makeJwt(exp));
    expect(session.cookieHeader).toContain('__Host-SESSION=sess123');
    expect(session.expiresAtMs).toBe(exp * 1000);
  });

  it('emits an ordered set of auth log lines for a full login (BL-003)', async () => {
    const pool = mockAgent.get(IDENTITY);
    pool
      .intercept({ path: '/identity/v1/password/login', method: 'POST' })
      .reply(200, { tkn: 'TKN' });
    pool.intercept({ path: authorizePath, method: 'GET' }).reply(200, AUTHORIZE_HTML('AUTHCODE'), {
      headers: { 'content-type': 'text/html', 'set-cookie': SESSION_COOKIES },
    });
    pool.intercept({ path: '/oauth/token', method: 'POST' }).reply(200, {
      access_token: makeJwt(exp),
      id_token: 'ID',
      expires_in: 7200,
      token_type: 'Bearer',
    });

    const emitted: Array<{ category: string; type: string }> = [];
    await performFullLogin(quietClient(), CONFIG, CREDS, (e) =>
      emitted.push({ category: e.category, type: e.type }),
    );
    expect(emitted.every((e) => e.category === 'auth')).toBe(true);
    expect(emitted.map((e) => e.type)).toEqual([
      'login_step1',
      'login_step2',
      'session_captured',
      'login_step3',
      'login_complete',
    ]);
  });

  it('fails a full login when Step 2 sets no __Host-SESSION cookie', async () => {
    const pool = mockAgent.get(IDENTITY);
    pool
      .intercept({ path: '/identity/v1/password/login', method: 'POST' })
      .reply(200, { tkn: 'TKN' });
    pool
      .intercept({ path: authorizePath, method: 'GET' })
      .reply(200, AUTHORIZE_HTML('AUTHCODE'), { headers: { 'content-type': 'text/html' } });

    await expect(performFullLogin(quietClient(), CONFIG, CREDS)).rejects.toBeInstanceOf(AuthError);
  });

  it('rejects a full login when password step is unauthorized', async () => {
    mockAgent
      .get(IDENTITY)
      .intercept({ path: '/identity/v1/password/login', method: 'POST' })
      .reply(401, { error: 'invalid_credentials' });

    await expect(performFullLogin(quietClient(), CONFIG, CREDS)).rejects.toMatchObject({
      category: 'auth',
    });
  });

  it('performs a silent refresh (Steps 2+3) reusing the cookie', async () => {
    const pool = mockAgent.get(IDENTITY);
    pool
      .intercept({ path: authorizePath, method: 'GET' })
      .reply(200, AUTHORIZE_HTML('REFRESHED'), { headers: { 'content-type': 'text/html' } });
    pool.intercept({ path: '/oauth/token', method: 'POST' }).reply(200, {
      access_token: makeJwt(exp),
      id_token: 'ID2',
      expires_in: 7200,
      token_type: 'Bearer',
    });

    const emitted: string[] = [];
    const session = await performSilentRefresh(
      quietClient(),
      CONFIG,
      '__Host-SESSION=sess123',
      (e) => emitted.push(e.type),
    );
    expect(session.idToken).toBe('ID2');
    // No fresh cookie issued → the previous one is retained.
    expect(session.cookieHeader).toBe('__Host-SESSION=sess123');
    // BL-003: a silent refresh produces visible auth lines (the two steps + a refresh marker).
    expect(emitted).toEqual(['login_step2', 'login_step3', 'silent_refresh']);
  });

  it('throws LoginRequiredError when the session is too old', async () => {
    mockAgent
      .get(IDENTITY)
      .intercept({ path: authorizePath, method: 'GET' })
      .reply(200, '{"error":"login_required"}', {
        headers: { 'content-type': 'application/json' },
      });

    await expect(
      performSilentRefresh(quietClient(), CONFIG, '__Host-SESSION=old'),
    ).rejects.toBeInstanceOf(LoginRequiredError);
  });

  it('forwards Step 1 cookies and sends Origin/Referer on the Step 2 authorize request', async () => {
    let authorizeHeaders: Record<string, string> = {};
    const pool = mockAgent.get(IDENTITY);
    pool
      .intercept({ path: '/identity/v1/password/login', method: 'POST' })
      .reply(
        200,
        { tkn: 'TKN' },
        { headers: { 'set-cookie': ['reach5session=R5; HttpOnly', '__cf_bm=CF; Path=/'] } },
      );
    pool.intercept({ path: authorizePath, method: 'GET' }).reply(
      200,
      (opts) => {
        authorizeHeaders = opts.headers as Record<string, string>;
        return AUTHORIZE_HTML('AUTHCODE');
      },
      { headers: { 'content-type': 'text/html', 'set-cookie': SESSION_COOKIES } },
    );
    pool.intercept({ path: '/oauth/token', method: 'POST' }).reply(200, {
      access_token: makeJwt(exp),
      id_token: 'ID',
      expires_in: 7200,
      token_type: 'Bearer',
    });

    await performFullLogin(quietClient(), CONFIG, CREDS);
    expect(authorizeHeaders.cookie).toContain('reach5session=R5');
    expect(authorizeHeaders.cookie).toContain('__cf_bm=CF');
    expect(authorizeHeaders.origin).toBe('https://www.test.local');
    expect(authorizeHeaders.referer).toBe('https://www.test.local/');
  });

  it('surfaces a diagnosable AuthError (not login_required) on a 400 without that marker', async () => {
    const pool = mockAgent.get(IDENTITY);
    pool
      .intercept({ path: '/identity/v1/password/login', method: 'POST' })
      .reply(200, { tkn: 'TKN' });
    pool
      .intercept({ path: authorizePath, method: 'GET' })
      .reply(400, '{"error":"invalid_request","error_description":"bad nonce"}', {
        headers: { 'content-type': 'application/json' },
      });

    const error = await performFullLogin(quietClient(), CONFIG, CREDS).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect(error).not.toBeInstanceOf(LoginRequiredError);
    expect((error as AuthError).status).toBe(400);
    expect((error as AuthError).message).toContain('bad nonce');
  });
});
