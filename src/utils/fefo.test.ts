import { describe, expect, it } from 'vitest';
import type { Batch } from '../types/catalog';
import { daysUntil, fefoSort, isExpired, isNearExpiry } from './fefo';

function batch(id: string, expiryDate: string | null, qtyOnHand = 10): Batch {
  return {
    id,
    itemId: 'itm-1',
    batchNo: id,
    expiryDate,
    receivedDate: '2026-01-01',
    qtyOnHand,
    purchasePrice: 1,
    purchaseDiscountPercent: 0,
    costPrice: 1,
  };
}

describe('FEFO with non-dated items', () => {
  it('sorts dated batches first, soonest expiry first, and null/no-expiry batches last', () => {
    const sorted = fefoSort([
      batch('none-2', null),
      batch('late', '2028-01-01'),
      batch('none-1', null),
      batch('soon', '2026-12-01'),
    ]);
    expect(sorted.map((b) => b.id)).toEqual(['soon', 'late', 'none-2', 'none-1']);
  });

  it('still ignores batches with no stock', () => {
    expect(fefoSort([batch('empty', '2026-12-01', 0), batch('stock', '2028-01-01')]).map((b) => b.id))
      .toEqual(['stock']);
  });

  it('treats a null expiry as never expiring rather than as 1900-01-01', () => {
    expect(daysUntil(null)).toBe(Number.POSITIVE_INFINITY);
    expect(isNearExpiry(null)).toBe(false);
    expect(isExpired(null)).toBe(false);
  });
});
