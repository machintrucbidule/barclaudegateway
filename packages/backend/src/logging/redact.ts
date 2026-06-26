/**
 * Secret redaction (contract.md §8).
 *
 * Tokens, passwords, cookies and PKCE material must never reach a log or an error message. Every
 * structure that might be logged is passed through {@link redactSecrets} first, which deep-clones it
 * and masks the value of any sensitive key.
 */

const MASK = '[REDACTED]';

/** Keys whose values are secret, matched case-insensitively. */
const SECRET_KEYS: ReadonlySet<string> = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'tkn',
  'code',
  'code_verifier',
  'code_challenge',
  'access_token',
  'id_token',
  'refresh_token',
]);

function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key.toLowerCase());
}

/**
 * Deep-clone `value`, replacing the value of any secret key with `[REDACTED]`. Safe to call on
 * anything; non-object inputs are returned unchanged. Handles cycles defensively.
 */
export function redactSecrets<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return '[CIRCULAR]' as unknown as T;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, seen)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSecretKey(key) ? MASK : redactSecrets(val, seen);
  }
  return out as T;
}
