import { describe, expect, it } from 'vitest';
import { validateEan } from './ean.js';

describe('validateEan', () => {
  it('accepts a valid EAN-13 (the health-check code) unchanged', () => {
    const result = validateEan('3183280000933');
    expect(result.ok).toBe(true);
    expect(result.normalized).toBe('3183280000933');
  });

  it('accepts a valid EAN-8', () => {
    const result = validateEan('96385074');
    expect(result.ok).toBe(true);
    expect(result.normalized).toBe('96385074');
  });

  it('accepts a valid UPC-A and normalises it to EAN-13 (left-padded 0)', () => {
    const result = validateEan('036000291452');
    expect(result.ok).toBe(true);
    expect(result.normalized).toBe('0036000291452');
  });

  it('trims surrounding whitespace before validating', () => {
    const result = validateEan('  3183280000933\n');
    expect(result.ok).toBe(true);
    expect(result.normalized).toBe('3183280000933');
  });

  it('rejects a wrong check digit', () => {
    const result = validateEan('3183280000934');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/check digit/);
  });

  it('rejects an unsupported length', () => {
    const result = validateEan('12345');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/8, 12 or 13/);
  });

  it('rejects non-digit characters', () => {
    const result = validateEan('318328000093X');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/digits only/);
  });

  it('rejects a non-string input', () => {
    const result = validateEan(undefined);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/string/);
  });
});
