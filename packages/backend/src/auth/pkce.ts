/**
 * PKCE material for the Reach5 Authorization Code flow (contract.md §2.3).
 *
 * Follows RFC 7636 S256: the `code_challenge` is the base64url-encoded SHA-256 of the ASCII bytes of
 * the `code_verifier` string. The verifier itself is 32 cryptographically random bytes, base64url
 * without padding.
 */

import { createHash, randomBytes } from 'node:crypto';

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

/** 32 random bytes, base64url-encoded (no padding). */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** base64url(SHA-256(ASCII(codeVerifier))) — the S256 challenge. */
export function deriveCodeChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

export function generatePkcePair(): PkcePair {
  const codeVerifier = generateCodeVerifier();
  return { codeVerifier, codeChallenge: deriveCodeChallenge(codeVerifier) };
}

/** A fresh random integer for the `nonce` query parameter (contract.md §2.3). */
export function generateNonce(): string {
  return randomBytes(8).readBigUInt64BE().toString();
}
