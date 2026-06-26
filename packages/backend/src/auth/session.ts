/**
 * In-memory session state (contract.md §2.4, §8).
 *
 * Access tokens are short-lived (2h) and must never be persisted to disk — they live only here. The
 * replayable session cookie (`__Host-SESSION` + legacy) is also held in memory so silent refresh can
 * re-execute Steps 2+3 without the password.
 */

export interface SessionState {
  accessToken: string;
  idToken: string;
  /** Absolute expiry (epoch ms), from the JWT `exp` claim when present, else `expires_in`. */
  expiresAtMs: number;
  /** Replayable `Cookie` header value (`__Host-SESSION=…; __Host-SESSION_LEGACY=…`). */
  cookieHeader: string;
}

/**
 * Decode the `exp` claim (epoch ms) from a JWT without verifying its signature — the token is opaque
 * to us except for its expiry. Returns `undefined` if the payload can't be read.
 */
export function decodeJwtExpMs(jwt: string): number | undefined {
  const parts = jwt.split('.');
  const payloadB64 = parts[1];
  if (!payloadB64) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/** Holds the current session, or `null` when not authenticated. */
export class SessionStore {
  private state: SessionState | null = null;

  set(state: SessionState): void {
    this.state = state;
  }

  get(): SessionState | null {
    return this.state;
  }

  clear(): void {
    this.state = null;
  }

  /** True when there is no session or the access token has passed `exp` (minus an optional skew). */
  isExpired(skewMs = 0, now = Date.now()): boolean {
    if (!this.state) return true;
    return now >= this.state.expiresAtMs - skewMs;
  }
}
