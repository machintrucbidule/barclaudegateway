import { describe, expect, it } from 'vitest';
import { redactSecrets } from './redact.js';

describe('redactSecrets', () => {
  it('masks secret keys at any depth', () => {
    const input = {
      email: 'user@example.com',
      password: 'hunter2',
      nested: { access_token: 'jwt', tkn: 'abc', keep: 'visible' },
      headers: { Authorization: 'Bearer xyz', cookie: '__Host-SESSION=x' },
    };
    const out = redactSecrets(input) as typeof input;
    expect(out.email).toBe('user@example.com');
    expect(out.password).toBe('[REDACTED]');
    expect(out.nested.access_token).toBe('[REDACTED]');
    expect(out.nested.tkn).toBe('[REDACTED]');
    expect(out.nested.keep).toBe('visible');
    expect(out.headers.Authorization).toBe('[REDACTED]');
    expect(out.headers.cookie).toBe('[REDACTED]');
  });

  it('matches secret keys case-insensitively and handles arrays', () => {
    const out = redactSecrets({ list: [{ Password: 'p' }, { ok: 1 }] }) as {
      list: Array<Record<string, unknown>>;
    };
    expect(out.list[0]?.Password).toBe('[REDACTED]');
    expect(out.list[1]?.ok).toBe(1);
  });

  it('does not mutate the original object', () => {
    const input = { password: 'secret' };
    redactSecrets(input);
    expect(input.password).toBe('secret');
  });

  it('returns primitives unchanged', () => {
    expect(redactSecrets('plain')).toBe('plain');
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(null)).toBe(null);
  });
});
