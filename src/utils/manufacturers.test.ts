// The "اخر رقم" rule for the company master: numbers are integers starting at 1, the next free one
// is derived from the highest in use, and the master never hands out a number twice - so renaming a
// company can never change an item's stored manufacturer key.
import { describe, expect, it } from 'vitest';

import type { Manufacturer } from '../types/manufacturer';
import {
  formatCompanyNo,
  isCompanyNoTaken,
  manufacturerDisplayName,
  manufacturerLabel,
  maxCompanyNumber,
  nextCompanyNumber,
} from './manufacturers';

const company = (companyNo: number, nameEn = 'Company', id?: string): Manufacturer => ({
  id: id ?? `mfr-${companyNo}`,
  companyNo,
  nameAr: 'شركة',
  nameEn,
});

describe('company numbering', () => {
  it('shows the number as a plain integer, like the legacy company screen', () => {
    expect(formatCompanyNo(1)).toBe('1');
    expect(formatCompanyNo(42)).toBe('42');
  });

  it('takes the highest existing number, not the row count', () => {
    expect(maxCompanyNumber([company(1), company(7)])).toBe(7);
  });

  it('ignores malformed or legacy values instead of NaN-ing the sequence', () => {
    expect(maxCompanyNumber([{ companyNo: 'M-7' as unknown as number }, company(3)])).toBe(3);
  });

  it('returns zero for an empty master and continues from 1', () => {
    expect(maxCompanyNumber([])).toBe(0);
    expect(nextCompanyNumber([])).toBe(1);
  });

  it('previews the next free number', () => {
    expect(nextCompanyNumber([company(2), company(9)])).toBe(10);
  });

  it('detects a number already owned by a different company', () => {
    const rows = [company(1, 'A', 'a'), company(2, 'B', 'b')];
    expect(isCompanyNoTaken(rows, 2)).toBe(true);
    expect(isCompanyNoTaken(rows, 2, 'b')).toBe(false); // the row being edited keeps its number
    expect(isCompanyNoTaken(rows, 3)).toBe(false);
  });
});

describe('manufacturer display helpers', () => {
  const companies = [company(1, 'Tabuk Pharmaceuticals'), company(2, 'Jamjoom Pharma')];

  it('labels a picker row with the number and English name', () => {
    expect(manufacturerLabel(companies[0])).toBe('1 — Tabuk Pharmaceuticals');
  });

  it('resolves a stored number to the current name', () => {
    expect(manufacturerDisplayName(companies, '2')).toBe('Jamjoom Pharma');
  });

  it('falls back to the stored number when it is not in the master', () => {
    expect(manufacturerDisplayName(companies, '77')).toBe('77');
    expect(manufacturerDisplayName(companies, undefined)).toBeUndefined();
  });
});
