import { describe, it, expect } from 'vitest';
import { computeLineIncentive, sumIncentives, findActiveIncentive } from './incentive';
import type { IncentiveItem } from '../types/incentive';

const baseItem: IncentiveItem = {
  id: 'r1',
  itemId: 'itm-1',
  incentiveType: 'percent',
  rate: 0.10,
  activeFrom: '2026-01-01',
  activeTo: '2026-12-31',
  active: true,
};

describe('computeLineIncentive', () => {
  it('returns 0 when no rule', () => {
    expect(computeLineIncentive({ incentiveItem: null, qty: 2, netExclVat: 20 })).toBe(0);
  });
  it('returns 0 when inactive', () => {
    expect(computeLineIncentive({ incentiveItem: { ...baseItem, active: false }, qty: 2, netExclVat: 20 })).toBe(0);
  });
  it('returns 0 outside validity window (before)', () => {
    expect(computeLineIncentive({ incentiveItem: baseItem, qty: 2, netExclVat: 20, today: '2025-12-31' })).toBe(0);
  });
  it('returns 0 outside validity window (after)', () => {
    expect(computeLineIncentive({ incentiveItem: baseItem, qty: 2, netExclVat: 20, today: '2027-01-01' })).toBe(0);
  });
  it('percent: 10% of 20 = 2.00', () => {
    expect(computeLineIncentive({ incentiveItem: baseItem, qty: 2, netExclVat: 20 })).toBe(2);
  });
  it('amount: 1.5 SAR/unit * 3 = 4.50', () => {
    const amt: IncentiveItem = { ...baseItem, incentiveType: 'amount', rate: 1.5 };
    expect(computeLineIncentive({ incentiveItem: amt, qty: 3, netExclVat: 20 })).toBe(4.5);
  });
  it('rounds to 2 decimals', () => {
    const p: IncentiveItem = { ...baseItem, rate: 0.333 };
    expect(computeLineIncentive({ incentiveItem: p, qty: 1, netExclVat: 10 })).toBe(3.33);
  });
});

describe('sumIncentives', () => {
  it('sums and rounds', () => {
    expect(sumIncentives([2, 4.5, 0])).toBe(6.5);
  });
  it('empty -> 0', () => {
    expect(sumIncentives([])).toBe(0);
  });
});

describe('findActiveIncentive', () => {
  const r1: IncentiveItem = { ...baseItem, id: 'a', itemId: 'itm-1', activeFrom: '2026-01-01', activeTo: '2026-06-30' };
  const r2: IncentiveItem = { ...baseItem, id: 'b', itemId: 'itm-1', activeFrom: '2026-07-01', activeTo: '2026-12-31' };
  const r3: IncentiveItem = { ...baseItem, id: 'c', itemId: 'itm-2', active: false };
  it('returns matching rule for date', () => {
    expect(findActiveIncentive([r1, r2], 'itm-1', '2026-08-15')?.id).toBe('b');
  });
  it('returns null when no match', () => {
    expect(findActiveIncentive([r1, r2], 'itm-1', '2025-01-01')).toBeNull();
  });
  it('ignores inactive rules', () => {
    expect(findActiveIncentive([r3], 'itm-2', '2026-08-15')).toBeNull();
  });
  it('last overlapping rule wins', () => {
    const a: IncentiveItem = { ...baseItem, id: 'a', itemId: 'itm-3', activeFrom: '2026-01-01', activeTo: '2026-12-31' };
    const b: IncentiveItem = { ...baseItem, id: 'b', itemId: 'itm-3', activeFrom: '2026-01-01', activeTo: '2026-12-31' };
    expect(findActiveIncentive([a, b], 'itm-3', '2026-08-15')?.id).toBe('b');
  });
});
