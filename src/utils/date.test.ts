import { describe, expect, it } from 'vitest';
import { isValidIsoDate } from './date';

describe('isValidIsoDate', () => {
  it('accepts real ISO calendar dates inside the allowed range', () => {
    expect(isValidIsoDate('2026-11-25')).toBe(true);
    expect(isValidIsoDate('2000-01-01')).toBe(true);
    expect(isValidIsoDate('2100-12-31')).toBe(true);
  });

  it('rejects malformed years, impossible calendar dates and out-of-range dates', () => {
    expect(isValidIsoDate('2025444')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('1999-12-31')).toBe(false);
    expect(isValidIsoDate('')).toBe(false);
  });
});
