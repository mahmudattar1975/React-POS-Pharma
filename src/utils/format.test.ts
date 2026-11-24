import { describe, expect, it } from 'vitest';
import { formatMoney, formatQty, formatSar, formatUnitPrice } from './format';

describe('number display format', () => {
  it('groups thousands and keeps two decimals for money', () => {
    expect(formatMoney(55520.52)).toBe('55,520.52');
    expect(formatMoney(1000)).toBe('1,000.00');
    expect(formatMoney(9)).toBe('9.00');
    expect(formatSar(55520.52)).toBe('SAR 55,520.52');
  });

  it('shows quantities without forced decimals but groups thousands', () => {
    expect(formatQty(10)).toBe('10');
    expect(formatQty(10.5)).toBe('10.5');
    expect(formatQty(55520.52)).toBe('55,520.52');
    expect(formatQty(12500)).toBe('12,500');
  });

  it('keeps three decimals on unit prices and groups thousands', () => {
    expect(formatUnitPrice(3.5)).toBe('3.500');
    expect(formatUnitPrice(12500.125)).toBe('12,500.125');
  });

  it('never prints NaN or undefined', () => {
    expect(formatMoney(undefined)).toBe('0.00');
    expect(formatQty(Number.NaN)).toBe('0');
  });
});
