/**
 * Barcode (EAN) validation — runs before any Chronodrive call so malformed scanner reads are
 * rejected cheaply with a clear 4xx (no wasted network round-trip).
 *
 * Accepts the three retail symbologies the GM65/GM861 scanners emit: EAN-8 (8), UPC-A (12) and
 * EAN-13 (13) digits. Each carries a trailing GS1 mod-10 check digit; we recompute and compare it,
 * which catches the most common single-digit misreads. A UPC-A code is normalised to its EAN-13
 * form (left-padded with a `0`) since Chronodrive indexes EAN-13.
 */

/** Lengths of the supported symbologies, including their check digit. */
const SUPPORTED_LENGTHS = new Set([8, 12, 13]);

export interface EanValidationResult {
  ok: boolean;
  /** The EAN-13-normalised code (present only when `ok`). */
  normalized?: string;
  /** Why validation failed (present only when not `ok`). Secret-free. */
  error?: string;
}

/**
 * Compute the GS1 mod-10 check digit of a full code's payload (all digits except the last).
 * Weights alternate 3 and 1 from the rightmost payload digit, for every supported length.
 */
function computeCheckDigit(digits: string): number {
  const payload = digits.slice(0, -1);
  let sum = 0;
  // Walk right-to-left over the payload: the rightmost payload digit has weight 3.
  for (let i = 0; i < payload.length; i += 1) {
    const digit = payload.charCodeAt(payload.length - 1 - i) - 48;
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10;
}

/** Validate a raw scanned barcode and normalise it to EAN-13. */
export function validateEan(raw: unknown): EanValidationResult {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'EAN must be a string' };
  }
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, error: 'EAN must contain digits only' };
  }
  if (!SUPPORTED_LENGTHS.has(trimmed.length)) {
    return { ok: false, error: `EAN must be 8, 12 or 13 digits (got ${trimmed.length})` };
  }
  const expected = computeCheckDigit(trimmed);
  const actual = trimmed.charCodeAt(trimmed.length - 1) - 48;
  if (expected !== actual) {
    return { ok: false, error: 'EAN check digit mismatch' };
  }
  const normalized = trimmed.length === 12 ? `0${trimmed}` : trimmed;
  return { ok: true, normalized };
}
