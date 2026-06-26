import { describe, expect, it } from 'vitest';
import { decodeJwtExpMs, SessionStore } from './session.js';

function makeJwt(payload: Record<string, unknown>): string {
  const enc = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(payload)}.signature`;
}

describe('decodeJwtExpMs', () => {
  it('reads the exp claim as epoch milliseconds', () => {
    const jwt = makeJwt({ exp: 1_700_000_000, auth_type: 'password' });
    expect(decodeJwtExpMs(jwt)).toBe(1_700_000_000_000);
  });

  it('returns undefined for malformed tokens or missing exp', () => {
    expect(decodeJwtExpMs('not-a-jwt')).toBeUndefined();
    expect(decodeJwtExpMs(makeJwt({ sub: 'x' }))).toBeUndefined();
    expect(decodeJwtExpMs('a.@@@.c')).toBeUndefined();
  });
});

describe('SessionStore', () => {
  const session = {
    accessToken: 'token',
    idToken: 'id',
    expiresAtMs: 10_000,
    cookieHeader: '__Host-SESSION=x',
  };

  it('stores and clears the session', () => {
    const store = new SessionStore();
    expect(store.get()).toBeNull();
    store.set(session);
    expect(store.get()).toEqual(session);
    store.clear();
    expect(store.get()).toBeNull();
  });

  it('reports expiry with skew', () => {
    const store = new SessionStore();
    expect(store.isExpired(0, 0)).toBe(true); // no session
    store.set(session);
    expect(store.isExpired(0, 9_000)).toBe(false);
    expect(store.isExpired(0, 10_000)).toBe(true);
    expect(store.isExpired(2_000, 8_000)).toBe(true); // within the 2s skew window
  });
});
