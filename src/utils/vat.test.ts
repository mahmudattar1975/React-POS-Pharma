// Unit tests for the money-math primitives every price in the app flows through (see
// utils/vat.ts). Kept exhaustive on purpose: a rounding bug here is a ZATCA filing
// discrepancy, not a cosmetic glitch - see server/README.md's caution about run-to-run invoice
// consistency.
import { describe, expect, it } from 'vitest';

import {
  cleanVatNumberInput,
  groupVatByRate,
  isVatNumberComplete,
  isVatNumberEmptyOrComplete,
  lineTotalInclVat,
  lineVat,
  round2,
  round3,
} from './vat';

describe('round2', () => {
  it('rounds a sum of floats to 2 decimals instead of leaking binary noise', () => {
    // 0.1 + 0.2 === 0.30000000000000004 raw - round2 must absorb that, since cart totals add
    // many such lines together.
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  it('rounds down to 2 decimals', () => {
    expect(round2(125.123)).toBe(125.12);
  });

  it('rounds up to 2 decimals', () => {
    expect(round2(125.986)).toBe(125.99);
  });

  it('leaves exact 2-decimal values alone', () => {
    expect(round2(3.9)).toBe(3.9);
    expect(round2(0)).toBe(0);
  });

  it('never produces extra floating-point dust', () => {
    expect(round2(3.9)).not.toBe(3.9000000000000004);
  });
});

describe('round3', () => {
  it('keeps sub-halala precision that round2 would truncate', () => {
    // Confirmed live in XPH: net_pur_price 2.402 on a bulk purchase (see pricing.ts's
    // computeCostPrice). round3 must keep the 3rd decimal - storing 2.40 loses a third of a
    // halala of margin per unit.
    expect(round3(2.402)).toBe(2.402);
  });

  it('rounds to at most 3 decimals', () => {
    expect(round3(1 / 3)).toBe(0.333);
  });

  it('rounds cleanly', () => {
    expect(round3(12.01 * 0.2)).toBe(2.402);
  });
});

describe('lineVat', () => {
  it('is zero for zero-rated lines (SFDA-registered medicines)', () => {
    expect(lineVat(100, 0)).toBe(0);
  });

  it('computes 15% standard-rate VAT at 2-decimal SAR precision', () => {
    expect(lineVat(100, 0.15)).toBe(15);
    expect(lineVat(10, 0.15)).toBe(1.5);
  });

  it('rounds the result to 2 decimals', () => {
    // 27 * 0.15 = 4.05 exactly in decimal; floats land just under and round2 must still return 4.05.
    expect(lineVat(27, 0.15)).toBe(4.05);
    // 38 * 0.15 = 5.7 exactly in decimal.
    expect(lineVat(38, 0.15)).toBe(5.7);
  });
});

describe('lineTotalInclVat', () => {
  it('adds VAT on top of the net amount (prices are stored VAT-exclusive)', () => {
    expect(lineTotalInclVat(100, 0.15)).toBe(115);
    expect(lineTotalInclVat(27, 0.15)).toBe(31.05);
  });

  it('is unchanged for zero-rated lines', () => {
    expect(lineTotalInclVat(50, 0)).toBe(50);
  });

  it('equals net + lineVat for the same inputs', () => {
    expect(lineTotalInclVat(45, 0.15)).toBe(45 + lineVat(45, 0.15));
  });
});

describe('groupVatByRate', () => {
  interface Line {
    vatRate: number;
    netExclVat: number;
    vatAmount: number;
  }

  const line = (vatRate: number, netExclVat: number, vatAmount: number): Line => ({ vatRate, netExclVat, vatAmount });

  it('returns no buckets for no lines', () => {
    expect(groupVatByRate([])).toEqual([]);
  });

  it('puts same-rate lines into one bucket and sums both amounts', () => {
    // Two cosmetics lines at 15%: totals must aggregate, not duplicate "VAT (15%)" rows.
    const buckets = groupVatByRate([
      line(0.15, 10, 1.5),
      line(0.15, 20, 3),
    ]);
    expect(buckets).toEqual([{ rate: 0.15, taxableAmount: 30, vatAmount: 4.5 }]);
  });

  it('keeps 0% and 15% as separate buckets - the normal pharmacy case', () => {
    // sfda-registered medicine (0% / zero-rated) + cosmetics (15% / standard-rated) on one
    // invoice; a flat "VAT (15%)" figure over the whole invoice would be wrong here.
    const buckets = groupVatByRate([
      line(0, 20, 0),
      line(0.15, 10, 1.5),
    ]);
    expect(buckets).toHaveLength(2);
    expect(buckets.find((b) => b.rate === 0)).toEqual({ rate: 0, taxableAmount: 20, vatAmount: 0 });
    expect(buckets.find((b) => b.rate === 0.15)).toEqual({ rate: 0.15, taxableAmount: 10, vatAmount: 1.5 });
  });

  it('orders buckets by descending VAT rate', () => {
    // The receipt groups read better with the rate actually charging tax on top.
    const buckets = groupVatByRate([
      line(0, 20, 0),
      line(0.15, 10, 1.5),
    ]);
    expect(buckets.map((b) => b.rate)).toEqual([0.15, 0]);
  });

  it('handles three distinct rates', () => {
    // Defensive: the item master is per-item, so a future rate (e.g. a special category) would
    // appear automatically - grouping must not assume exactly 0 and 0.15.
    const buckets = groupVatByRate([
      line(1 / 3, 5, 1),
      line(0, 20, 0),
      line(0.15, 10, 1.5),
      line(1 / 3, 10, 2),
    ]);
    expect(buckets.map((b) => b.rate)).toEqual([0.3333333333333333, 0.15, 0]);
    expect(buckets.find((b) => b.rate === 1 / 3)).toEqual({
      rate: 1 / 3,
      taxableAmount: 15,
      vatAmount: 3,
    });
  });

  it('is consistent between sums accumulated either way', () => {
    // Each bucket amount is recomputed through round2 as lines accumulate, so the result must
    // hold to 2 decimals no matter the order of the input lines.
    const a = groupVatByRate([line(0.15, 10, 1.5), line(0.15, 20, 3)]);
    const b = groupVatByRate([line(0.15, 20, 3), line(0.15, 10, 1.5)]);
    expect(a).toEqual(b);
  });
});

describe('VAT number input rules', () => {
  it('accepts a complete 15-digit number and nothing shorter/longer', () => {
    expect(isVatNumberComplete('300012345600003')).toBe(true);
    expect(isVatNumberComplete('30001234560000')).toBe(false); // 14 digits
    expect(isVatNumberComplete('3000123456000039')).toBe(false); // 16 digits
    expect(isVatNumberComplete('')).toBe(false);
    expect(isVatNumberComplete('30001234560000A')).toBe(false);
  });

  it('keeps only digits while typing', () => {
    expect(cleanVatNumberInput('3000-1234 5678')).toBe('300012345678');
    expect(cleanVatNumberInput('abc300012345600003xyz')).toBe('300012345600003');
  });

  it('stops dead at 15 digits (the 16th keystroke never enters the field)', () => {
    expect(cleanVatNumberInput('300012345600003')).toBe('300012345600003');
    expect(cleanVatNumberInput('3000123456000039')).toBe('300012345600003');
    // Pasting a long formatted number is truncated, not rejected as a whole.
    expect(cleanVatNumberInput('3000-1234-5678-0003')).toBe('300012345678000');
  });

  it('allows the field to be null (blank) - only a typed value must be 15 digits', () => {
    expect(isVatNumberEmptyOrComplete('')).toBe(true); // no VAT number - legal state
    expect(isVatNumberEmptyOrComplete('300012345600003')).toBe(true);
    expect(isVatNumberEmptyOrComplete('30001234560000')).toBe(false); // 14 digits - show message
    expect(isVatNumberEmptyOrComplete('3000123456000039')).toBe(false); // 16 digits
    expect(cleanVatNumberInput('')).toBe('');
  });
});
