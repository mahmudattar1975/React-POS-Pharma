// Pack ladder math (utils/packUnits.ts). The ladder is business-critical: a wrong multiplier
// silently over/under-deducts stock and misprices a strip or a loose tablet, so every level gets
// an exact expected value rather than a rounded one.
import { describe, expect, it } from 'vitest';
import type { PackConfig } from '../types/catalog';
import {
  breakdown, describePack, formatPackBreakdown, formatPackShort, formatUnitPrice, hasCarton,
  priceForLevel, purchasePackLevels, sellableQty, tabletsPerBox, tabletsPerUnit, toBaseQty,
} from './packUnits';

// The owner's rule: 1 carton = 100 boxes, 1 box = 3 strips, 1 strip = 4 tablets.
const pack: PackConfig = { cartonSize: 100, boxSize: 3, stripSize: 4 };

describe('pack ladder', () => {
  it('counts tablets at every level', () => {
    expect(tabletsPerUnit(pack, 'tablet')).toBe(1);
    expect(tabletsPerUnit(pack, 'strip')).toBe(4);
    expect(tabletsPerUnit(pack, 'box')).toBe(12);
    expect(tabletsPerUnit(pack, 'carton')).toBe(1200);
    expect(tabletsPerBox(pack)).toBe(12);
  });

  it('derives strip and tablet prices by exact division from the box price', () => {
    expect(priceForLevel(10, pack, 'box')).toBe(10);
    expect(priceForLevel(10, pack, 'strip')).toBeCloseTo(3.3333333, 6);
    expect(priceForLevel(10, pack, 'tablet')).toBeCloseTo(0.8333333, 6);
    expect(priceForLevel(10, pack, 'carton')).toBeCloseTo(1000, 6);
    // No rounding drift: twelve loose tablets add back to exactly the box price.
    expect(priceForLevel(10, pack, 'tablet') * 12).toBeCloseTo(10, 10);
    expect(priceForLevel(10, pack, 'strip') * 3).toBeCloseTo(10, 10);
  });

  it('splits an on-hand tablet count into whole packs', () => {
    const tablets = 1200 + 2 * 12 + 4 + 1;
    expect(breakdown(pack, tablets)).toEqual({ carton: 1, box: 2, strip: 1, tablet: 1 });
    expect(formatPackBreakdown(pack, tablets)).toBe('1 carton + 2 boxes + 1 strip + 1 tablet');
    expect(formatPackShort(pack, tablets)).toBe('1 ct + 2 bx + 1 st + 1 tab');
    expect(formatPackBreakdown(pack, 0)).toBe('0 tablets');
  });

  it('never reports a partial lower unit as sellable', () => {
    expect(sellableQty(pack, 'box', 11)).toBe(0);
    expect(sellableQty(pack, 'strip', 11)).toBe(2);
    expect(sellableQty(pack, 'tablet', 11)).toBe(11);
    expect(sellableQty(pack, 'box', 0)).toBe(0);
    expect(sellableQty(pack, 'carton', 1200)).toBe(1);
  });

  it('converts selling units to tablets (what checkout deducts)', () => {
    expect(toBaseQty(pack, 'box', 2)).toBe(24);
    expect(toBaseQty(pack, 'strip', 3)).toBe(12);
    expect(toBaseQty(pack, 'carton', 1)).toBe(1200);
    expect(toBaseQty(pack, 'tablet', 5)).toBe(5);
  });

  it('degrades a malformed ladder to 1 instead of NaN or zero', () => {
    expect(tabletsPerUnit({ cartonSize: 0, boxSize: 0, stripSize: 0 }, 'box')).toBe(1);
    expect(tabletsPerUnit({ cartonSize: 2.5, boxSize: 3, stripSize: 4 }, 'box')).toBe(12);
  });
});

// The owner's Paracetamol rule: box is the top level (no carton), 1 box = 2 strips, 1 strip =
// 10 tablets, box price 4.50. Everything else must derive exactly from that.
describe('box-only ladder (no carton)', () => {
  const paracetamol: PackConfig = { cartonSize: 1, boxSize: 2, stripSize: 10 };

  it('prices box, strip and tablet exactly from the box price', () => {
    expect(tabletsPerBox(paracetamol)).toBe(20);
    expect(priceForLevel(4.5, paracetamol, 'box')).toBe(4.5);
    expect(priceForLevel(4.5, paracetamol, 'strip')).toBe(2.25);
    expect(priceForLevel(4.5, paracetamol, 'tablet')).toBeCloseTo(0.225, 10);
    // Buying the two strips of a box adds back to exactly 4.50.
    expect(priceForLevel(4.5, paracetamol, 'strip') * 2).toBeCloseTo(4.5, 10);
  });

  it('hides the carton level in stock breakdowns and purchasing', () => {
    expect(hasCarton(paracetamol)).toBe(false);
    expect(breakdown(paracetamol, 1375)).toEqual({ carton: 0, box: 68, strip: 1, tablet: 5 });
    expect(formatPackShort(paracetamol, 1375)).toBe('68 bx + 1 st + 5 tab');
    expect(formatPackBreakdown(paracetamol, 1375)).toBe('68 boxes + 1 strip + 5 tablets');
    // Reorder level 30 tablets reads as 1 box + 1 strip, not "1.5 boxes".
    expect(formatPackBreakdown(paracetamol, 30)).toBe('1 box + 1 strip');
    expect(describePack(paracetamol)).toBe('1 box = 2 strips · 1 strip = 10 tablets · 1 box = 20 tablets');
    expect(purchasePackLevels(paracetamol)).toEqual(['box', 'strip']);
    expect(purchasePackLevels(pack)).toEqual(['carton', 'box', 'strip']);
  });

  it('prints sub-halala unit prices without rounding them to 2 decimals', () => {
    expect(formatUnitPrice(4.5)).toBe('4.50');
    expect(formatUnitPrice(2.25)).toBe('2.25');
    expect(formatUnitPrice(0.225)).toBe('0.225');
    expect(formatUnitPrice(0.14)).toBe('0.14');
    expect(formatUnitPrice(1)).toBe('1.00');
  });
});
