/**
 * Secret redaction (contract.md §8).
 *
 * Tokens, passwords, cookies and PKCE material must never reach a log or an error message. The
 * Fastify logger runs {@link redactLogObject} on every log record (wired in `buildServer`), so any
 * sensitive key in a logged structure — headers, bodies, serialized errors — is masked centrally,
 * even if a future caller forgets. {@link redactSecrets} does the work: it deep-clones the input and
 * masks the value of any sensitive key.
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

/**
 * Pino `formatters.log` hook: deep-redact every log record before it is written. Wired into the
 * Fastify logger in `buildServer` so secrets are masked centrally — no per-call discipline required.
 */
export function redactLogObject(object: Record<string, unknown>): Record<string, unknown> {
  return redactSecrets(object);
}
