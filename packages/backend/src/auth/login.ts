/**
 * The Reach5 PKCE 3-step login and silent refresh (contract.md §2).
 *
 *  - Full login  (Steps 1+2+3): password → `tkn` → auth code + session cookie → access token.
 *  - Silent refresh (Steps 2+3): replay the stored session cookie → new auth code → access token.
 *    No password is sent. If Step 2 reports `login_required` the session is too old (>72h) and the
 *    caller must fall back to a full login.
 *
 * No browser is involved: `response_mode=web_message` returns the auth code inline in an HTML body
 * which we parse with a regex (§2.3).
 */

import type { OAuthTokenResponse, PasswordLoginResponse } from '@barclaudegateway/shared';
import { AuthError, LoginRequiredError } from '../http/errors.js';
import type { HttpClient } from '../http/client.js';
import { generateNonce, generatePkcePair } from './pkce.js';
import type { SessionState } from './session.js';
import { decodeJwtExpMs } from './session.js';

export interface AuthConfig {
  /** Reach5 identity base URL, e.g. `https://connect.chronodrive.com`. */
  identityBaseUrl: string;
  clientId: string;
  redirectUri: string;
  scope: string;
}

export interface Credentials {
  email: string;
  password: string;
}

const SESSION_COOKIE_NAMES = ['__Host-SESSION', '__Host-SESSION_LEGACY'] as const;

/** Parse a `Set-Cookie` array into `name=value` pairs (dropping attributes). */
function cookiePairs(setCookie: string[]): string[] {
  const pairs: string[] = [];
  for (const entry of setCookie) {
    const pair = entry.split(';', 1)[0]?.trim();
    if (pair && pair.includes('=')) pairs.push(pair);
  }
  return pairs;
}

/**
 * Build the replayable `Cookie` header from a Step-2 `Set-Cookie` array, keeping only the session
 * cookies. Returns an empty string if none are present.
 */
export function extractSessionCookieHeader(setCookie: string[]): string {
  return cookiePairs(setCookie)
    .filter((pair) =>
      (SESSION_COOKIE_NAMES as readonly string[]).includes(pair.split('=', 1)[0] ?? ''),
    )
    .join('; ');
}

/**
 * Build a `Cookie` header from ALL `Set-Cookie` entries. Step 1 (password login) sets the initial
 * Reach5 session cookie that Step 2's `prompt=none` requires; we forward every cookie so the silent
 * authorize works in a stateless client (the browser HAR that seeded the spec carried these
 * implicitly — see contract.md §2.4).
 */
export function allCookiesHeader(setCookie: string[]): string {
  return cookiePairs(setCookie).join('; ');
}

/**
 * Browser-like `Origin`/`Referer` headers derived from the redirect URI. Reach5's `/oauth/*`
 * endpoints reject requests without them ("No origin or referer retrieved", observed 2026-06-26);
 * a real browser sends them implicitly from the www.chronodrive.com SPA (contract.md §2).
 */
function originHeaders(config: AuthConfig): Record<string, string> {
  const origin = new URL(config.redirectUri).origin;
  return { origin, referer: `${origin}/` };
}

/** Extract the authorization `code` from the inline `postMessage` HTML body (§2.3). */
export function parseAuthCode(html: string): string | undefined {
  // Matches both `code: '...'` (observed) and `"code":"..."` (JSON form), tolerant of whitespace.
  const match = /["']?code["']?\s*:\s*["']([^"']+)["']/.exec(html);
  return match?.[1];
}

function buildAuthorizeUrl(
  config: AuthConfig,
  codeChallenge: string,
  nonce: string,
  tkn?: string,
): string {
  const url = new URL('/oauth/authorize', config.identityBaseUrl);
  const params = url.searchParams;
  params.set('client_id', config.clientId);
  params.set('response_type', 'code');
  params.set('response_mode', 'web_message');
  params.set('prompt', 'none');
  params.set('redirect_uri', config.redirectUri);
  params.set('scope', config.scope);
  params.set('nonce', nonce);
  params.set('persistent', 'true');
  params.set('code_challenge', codeChallenge);
  params.set('code_challenge_method', 'S256');
  if (tkn !== undefined) params.set('tkn', tkn);
  return url.toString();
}

export interface PasswordLoginResult {
  tkn: string;
  /** Cookies Step 1 set (the initial Reach5 session), forwarded to Step 2. */
  cookieHeader: string;
}

/** Step 1 — exchange credentials for a short-lived `tkn` and the initial session cookie (§2.2). */
export async function stepPasswordLogin(
  http: HttpClient,
  config: AuthConfig,
  credentials: Credentials,
): Promise<PasswordLoginResult> {
  const endpoint = 'POST /identity/v1/password/login';
  const res = await http.requestJson<PasswordLoginResponse>(
    new URL('/identity/v1/password/login', config.identityBaseUrl).toString(),
    {
      method: 'POST',
      endpoint,
      headers: originHeaders(config),
      body: {
        client_id: config.clientId,
        scope: config.scope,
        email: credentials.email,
        password: credentials.password,
      },
    },
  );
  if (res.status !== 200 || !res.data?.tkn) {
    throw new AuthError(`Password login failed (status ${res.status})`, {
      status: res.status,
      endpoint,
    });
  }
  return { tkn: res.data.tkn, cookieHeader: allCookiesHeader(res.setCookie) };
}

export interface AuthorizeResult {
  code: string;
  cookieHeader: string;
}

/**
 * Step 2 — obtain an authorization code (§2.3). `tkn` drives the initial login; `cookieHeader` drives
 * a silent refresh. Captures any refreshed session cookie from the response.
 */
export async function stepAuthorize(
  http: HttpClient,
  config: AuthConfig,
  args: { codeChallenge: string; nonce: string; tkn?: string; cookieHeader?: string },
): Promise<AuthorizeResult> {
  const endpoint = 'GET /oauth/authorize';
  const headers: Record<string, string> = originHeaders(config);
  if (args.cookieHeader) headers['cookie'] = args.cookieHeader;

  const res = await http.requestText(
    buildAuthorizeUrl(config, args.codeChallenge, args.nonce, args.tkn),
    {
      method: 'GET',
      endpoint,
      headers,
    },
  );

  // `login_required` is signalled in the response body (web_message error channel), independent of
  // the HTTP status. It means the session is too old → the caller must do a full login.
  if (res.data.includes('login_required')) {
    throw new LoginRequiredError(undefined, { status: res.status, endpoint });
  }

  const code = parseAuthCode(res.data);
  if (!code) {
    // Surface a short, whitespace-collapsed body excerpt so a real failure is diagnosable. The
    // error response carries no authorization code; the excerpt is for operators, not secrets.
    const excerpt = res.data.replace(/\s+/g, ' ').trim().slice(0, 400);
    throw new AuthError(
      `No authorization code from /oauth/authorize (status ${res.status}). Body: ${excerpt}`,
      { status: res.status, endpoint },
    );
  }

  // Persist the session cookie for future refreshes (Step 2 sets __Host-SESSION). A silent refresh
  // may not re-issue it, so fall back to the previous header.
  const cookieHeader = extractSessionCookieHeader(res.setCookie) || (args.cookieHeader ?? '');
  return { code, cookieHeader };
}

/** Step 3 — exchange the authorization code for an access token (§2.4). */
export async function stepTokenExchange(
  http: HttpClient,
  config: AuthConfig,
  args: { code: string; codeVerifier: string },
): Promise<OAuthTokenResponse> {
  const endpoint = 'POST /oauth/token';
  const res = await http.requestJson<OAuthTokenResponse>(
    new URL('/oauth/token', config.identityBaseUrl).toString(),
    {
      method: 'POST',
      endpoint,
      headers: originHeaders(config),
      body: {
        client_id: config.clientId,
        grant_type: 'authorization_code',
        code_verifier: args.codeVerifier,
        code: args.code,
        redirect_uri: config.redirectUri,
      },
    },
  );
  if (res.status !== 200 || !res.data?.access_token) {
    throw new AuthError(`Token exchange failed (status ${res.status})`, {
      status: res.status,
      endpoint,
    });
  }
  return res.data;
}

function toSessionState(tokens: OAuthTokenResponse, cookieHeader: string): SessionState {
  const expFromJwt = decodeJwtExpMs(tokens.access_token);
  return {
    accessToken: tokens.access_token,
    idToken: tokens.id_token,
    expiresAtMs: expFromJwt ?? Date.now() + tokens.expires_in * 1000,
    cookieHeader,
  };
}

/** Full 3-step login with credentials. */
export async function performFullLogin(
  http: HttpClient,
  config: AuthConfig,
  credentials: Credentials,
): Promise<SessionState> {
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const { tkn, cookieHeader: loginCookies } = await stepPasswordLogin(http, config, credentials);
  const { code, cookieHeader } = await stepAuthorize(http, config, {
    codeChallenge,
    nonce: generateNonce(),
    tkn,
    cookieHeader: loginCookies,
  });
  if (!cookieHeader.includes('__Host-SESSION')) {
    throw new AuthError('Step 2 did not set the __Host-SESSION cookie', {
      endpoint: 'GET /oauth/authorize',
    });
  }
  const tokens = await stepTokenExchange(http, config, { code, codeVerifier });
  return toSessionState(tokens, cookieHeader);
}

/**
 * Silent refresh (Steps 2+3) reusing the stored session cookie. Throws {@link LoginRequiredError}
 * when the session is too old, signalling the caller to fall back to {@link performFullLogin}.
 */
export async function performSilentRefresh(
  http: HttpClient,
  config: AuthConfig,
  cookieHeader: string,
): Promise<SessionState> {
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const { code, cookieHeader: refreshedCookie } = await stepAuthorize(http, config, {
    codeChallenge,
    nonce: generateNonce(),
    cookieHeader,
  });
  const tokens = await stepTokenExchange(http, config, { code, codeVerifier });
  return toSessionState(tokens, refreshedCookie || cookieHeader);
}
