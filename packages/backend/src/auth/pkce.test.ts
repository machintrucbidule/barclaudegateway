import { describe, expect, it } from 'vitest';
import {
  deriveCodeChallenge,
  generateCodeVerifier,
  generateNonce,
  generatePkcePair,
} from './pkce.js';

describe('PKCE', () => {
  it('generates a base64url verifier with no padding', () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier).not.toContain('=');
    // 32 bytes base64url-encoded → 43 chars.
    expect(verifier).toHaveLength(43);
  });

  it('derives the S256 challenge per the RFC 7636 test vector', () => {
    // RFC 7636 Appendix B.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(deriveCodeChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('pairs a verifier with its derived challenge', () => {
    const { codeVerifier, codeChallenge } = generatePkcePair();
    expect(deriveCodeChallenge(codeVerifier)).toBe(codeChallenge);
  });

  it('generates distinct numeric nonces', () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).toMatch(/^\d+$/);
    expect(a).not.toBe(b);
  });
});
