// Unit tests for the two-stage pricing pipeline (see utils/pricing.ts): an item-level offer
// first, then the customer's tier discount on whatever remains - with a cashier-entered manual
// discount that must never stack with an active offer. A wrong number here under- or over-charges
// a customer, so each rule gets an exact-expected-value test rather than property-style checks.
import { describe, expect, it } from 'vitest';

import type { Batch, Item, Offer } from '../types/catalog';
import { allocateBogoFreeUnits, computeCartTotals, computeCostPrice, priceCartLine, resolveSalePrice } from './pricing';

const today = new Date().toISOString().slice(0, 10); // same window source priceCartLine uses
const isoOffset = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'itm-1',
    barcode: '629000000001',
    nameAr: 'دواء',
    nameEn: 'Test Drug',
    unit: 'Box',
    category: 'medicine',
    basePrice: 10, // SAR, VAT-exclusive (see types/catalog.ts)
    vatRate: 0, // zero-rated medicine by default; each test overrides (per Item.vatRate)
    requiresBatchTracking: true,
    reorderLevel: 5,
    ...overrides,
  };
}

function batch(overrides: Partial<Batch> = {}): Batch {
  return {
    id: 'bat-1',
    itemId: 'itm-1',
    batchNo: 'B001',
    expiryDate: '2027-10-26',
    receivedDate: '2026-10-26',
    qtyOnHand: 100,
    purchasePrice: 8,
    purchaseDiscountPercent: 0,
    costPrice: 8,
    ...overrides,
  };
}

function offer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: 'off-1',
    itemId: 'itm-1',
    type: 'percent',
    percent: 0.1,
    activeFrom: '2026-01-01',
    activeTo: '2026-12-31',
    label: '10% off',
    ...overrides,
  };
}

describe('resolveSalePrice', () => {
  it('falls through to the item-level price when the batch has no override (local seed data)', () => {
    expect(resolveSalePrice(item({ basePrice: 10 }), batch())).toBe(10);
  });

  it('prefers the batch-level price when set (real XPH pricing is per batch)', () => {
    expect(resolveSalePrice(item({ basePrice: 10 }), batch({ salePriceOverride: 12.5 }))).toBe(12.5);
  });

  it('respects a zero-price override rather than treating it as "unset"', () => {
    // A 0 override must win over the item price - ?? vs ?? semantics; only undefined/null
    // falls through.
    expect(resolveSalePrice(item(), batch({ salePriceOverride: 0 }))).toBe(0);
  });
});

describe('computeCostPrice', () => {
  it('applies the vendor discount', () => {
    expect(computeCostPrice(100, 0.1)).toBe(90);
    expect(computeCostPrice(10, 0)).toBe(10);
  });

  it('keeps sub-halala precision (round3, not round2)', () => {
    // The XPH-reported case that justified round3: a bulk purchase's per-unit net cost lands on
    // a fraction of a halala - net_pur_price 2.402 (see pricing.ts's comment).
    expect(computeCostPrice(12.01, 0.8)).toBe(2.402);
  });
});

describe('priceCartLine - base pricing', () => {
  it('charges gross = qty * unitPrice, no discounts, zero-rated', () => {
    const l = priceCartLine(item(), batch(), 3, [], 'normal');
    expect(l).toMatchObject({
      itemId: 'itm-1',
      batchId: 'bat-1',
      batchNo: 'B001',
      qty: 3,
      unitPrice: 10,
      discountAmount: 0,
      netExclVat: 30,
      vatAmount: 0,
      totalInclVat: 30,
    });
  });

  it('adds per-line VAT on the net amount for a standard-rated item', () => {
    // 15% cosmetics case, and the rounding-derives-from-precision': net 30 -> vat 4.5 -> total 34.5.
    const l = priceCartLine(item({ vatRate: 0.15 }), batch(), 3, [], 'normal');
    expect(l.netExclVat).toBe(30);
    expect(l.vatAmount).toBe(4.5);
    expect(l.totalInclVat).toBe(34.5);
  });

  it('carries bilingual names, unit, batch metadata and expiry onto the line', () => {
    const b = batch({ batchNo: 'B77', expiryDate: '2028-01-31' });
    const it_ = item({ nameAr: 'دواء تجريبي', nameEn: 'Demo Drug', unit: 'Strip' });
    const l = priceCartLine(it_, b, 1, [], 'normal');
    expect(l).toMatchObject({
      itemNameAr: 'دواء تجريبي',
      itemNameEn: 'Demo Drug',
      unit: 'Strip',
      batchNo: 'B77',
      expiryDate: '2028-01-31',
      vatRate: 0,
    });
  });

  it('reuses the passed-in id so re-pricing keeps the line stable', () => {
    const l = priceCartLine(item(), batch(), 2, [], 'normal', 'cl-existing');
    expect(l.id).toBe('cl-existing');
  });

  it('generates an id that includes the batch id when none is given', () => {
    const l = priceCartLine(item(), batch(), 2, [], 'normal');
    expect(l.id).toContain('bat-1');
  });
});

describe('priceCartLine - percent offers', () => {
  it('cuts the gross by the offer percent before tier discount', () => {
    // 10% off 30 -> 27, no tier discount (normal), 15% VAT on 27 = 4.05.
    const l = priceCartLine(item({ vatRate: 0.15 }), batch(), 3, [offer()], 'normal');
    expect(l.offerLabel).toBe('10% off');
    expect(l.discountAmount).toBe(3);
    expect(l.netExclVat).toBe(27);
    expect(l.vatAmount).toBe(4.05);
    expect(l.totalInclVat).toBe(31.05);
  });

  it('skips inactive offers entirely (no label, no discount)', () => {
    const l = priceCartLine(item({ vatRate: 0.15 }), batch(), 3, [offer({ activeTo: isoOffset(-1) })], 'normal');
    expect(l.offerLabel).toBeUndefined();
    expect(l.discountAmount).toBe(0);
    expect(l.netExclVat).toBe(30);
  });

  it('honours the offer window inclusively on both ends', () => {
    const from = offer({ activeFrom: today, activeTo: today });
    const l = priceCartLine(item(), batch(), 3, [from], 'normal');
    expect(l.offerLabel).toBe('10% off');
  });
});

describe('priceCartLine - value offers', () => {
  it('applies the flat SAR amount per unit (not for the whole line)', () => {
    // 2 SAR-off per unit x 3 units = 6, from a 30 gross.
    const l = priceCartLine(item(), batch(), 3, [offer({ type: 'value', percent: undefined, value: 2, label: '2 SAR off' })], 'normal');
    expect(l.offerLabel).toBe('2 SAR off');
    expect(l.netExclVat).toBe(24);
  });

  it('clamps to the gross so it can never make the line negative', () => {
    // A flat 100 off a 10 unit would only be paid 10 otherwise - must cap at the gross.
    const l = priceCartLine(item(), batch(), 1, [offer({ type: 'value', percent: undefined, value: 100, label: 'huge' })], 'normal');
    expect(l.netExclVat).toBe(0);
    expect(l.vatAmount).toBe(0);
    expect(l.totalInclVat).toBe(0);
  });
});

describe('priceCartLine - buy-X-get-Y offers', () => {
  const bogo = offer({ type: 'bogo', percent: undefined, buyQty: 2, freeQty: 1, label: 'buy 2 get 1' });

  it('charges floor(qty / bundle) * freeQty units for the bundle remainder', () => {
    // 3 units with buy-2-get-1: one complete bundle -> 1 unit free, 2 charged.
    const l = priceCartLine(item(), batch(), 3, [bogo], 'normal');
    expect(l.offerLabel).toBe('buy 2 get 1');
    expect(l.discountAmount).toBe(10);
    expect(l.netExclVat).toBe(20);
  });

  it('does not round up partial bundles', () => {
    // 4 of a 3-for-2: still just the one earned free unit, not two.
    const freeL = priceCartLine(item(), batch(), 4, [bogo], 'normal');
    expect(freeL.discountAmount).toBe(10);
    expect(freeL.netExclVat).toBe(30);

    // 6 units -> two complete bundles -> 2 free units.
    expect(priceCartLine(item(), batch(), 6, [bogo], 'normal').discountAmount).toBe(20);
    // 2 units -> no bundle reached -> no discount, no offer label.
    expect(priceCartLine(item(), batch(), 2, [bogo], 'normal').offerLabel).toBeUndefined();
  });
});

describe('allocateBogoFreeUnits - one item split over several batch lines', () => {
  const bogo = offer({ type: 'bogo', percent: undefined, buyQty: 2, freeQty: 1, label: 'buy 2 get 1' });

  it('counts bundles over the item total, not per line', () => {
    // 2 on batch A + 1 on batch B = one full bundle. Neither line reaches 3 on its own.
    const allocation = allocateBogoFreeUnits(bogo, [
      { id: 'line-a', qty: 2 },
      { id: 'line-b', qty: 1 },
    ]);
    expect(allocation.get('line-a')).toBe(1);
    expect(allocation.has('line-b')).toBe(false);
  });

  it('returns nothing while the combined quantity is below one bundle', () => {
    expect(allocateBogoFreeUnits(bogo, [
      { id: 'line-a', qty: 1 },
      { id: 'line-b', qty: 1 },
    ]).size).toBe(0);
  });

  it('caps allocation at each line quantity and spills the remainder onto the next line', () => {
    // 6 total -> 2 free units; the first line only holds 1, so the second takes the other 1.
    const allocation = allocateBogoFreeUnits(bogo, [
      { id: 'line-a', qty: 1 },
      { id: 'line-b', qty: 5 },
    ]);
    expect(allocation.get('line-a')).toBe(1);
    expect(allocation.get('line-b')).toBe(1);
  });
});

describe('priceCartLine - bogo allocation params', () => {
  const bogo = offer({ type: 'bogo', percent: undefined, buyQty: 2, freeQty: 1, label: 'buy 2 get 1' });

  it('uses the allocated count instead of re-counting the line on its own', () => {
    // 2 units alone would earn nothing; with the cross-line allocation they earn 1 free unit.
    const l = priceCartLine(item(), batch(), 2, [bogo], 'normal', undefined, undefined, 'box', 1, true);
    expect(l.discountAmount).toBe(10);
    expect(l.offerLabel).toBe('buy 2 get 1');
  });

  it('labels a sibling line that holds no free units, and drops its manual discount', () => {
    // 1 unit, allocation 0 - but the item's offer is active elsewhere in the cart.
    const l = priceCartLine(
      item(),
      batch(),
      1,
      [bogo],
      'normal',
      undefined,
      { type: 'amount', value: 2 },
      'box',
      0,
      true
    );
    expect(l.discountAmount).toBe(0);
    expect(l.manualDiscountType).toBeUndefined();
    expect(l.offerLabel).toBe('buy 2 get 1');
  });
});

describe('priceCartLine - manual (cashier-entered) discounts', () => {
  it('reads "amount" as a flat SAR discount for the whole line', () => {
    const l = priceCartLine(item(), batch(), 3, [], 'normal', undefined, { type: 'amount', value: 5 });
    expect(l.manualDiscountType).toBe('amount');
    expect(l.discountAmount).toBe(5);
    expect(l.netExclVat).toBe(25);
  });

  it('reads "percent" as a fraction of the gross (matching the app\'s 0.15 = 15% convention)', () => {
    const l = priceCartLine(item(), batch(), 4, [], 'normal', undefined, { type: 'percent', value: 0.25 });
    expect(l.manualDiscountType).toBe('percent');
    expect(l.discountAmount).toBe(10);
    expect(l.netExclVat).toBe(30);
  });

  it('drops the manual discount when an offer is already active on the line', () => {
    // Stacking an offer + manual discount could under-charge well past what either alone allows;
    // once the offer is in play, the manual one is dropped instead (even entered earlier - see
    // priceCartLine's comment).
    const l = priceCartLine(item(), batch(), 3, [offer()], 'normal', undefined, { type: 'amount', value: 5 });
    expect(l.offerLabel).toBe('10% off');
    expect(l.manualDiscountType).toBeUndefined();
    expect(l.manualDiscountValue).toBeUndefined();
    expect(l.netExclVat).toBe(27);
  });

  it('caps a manual discount at the remaining gross', () => {
    const l = priceCartLine(item(), batch(), 2, [], 'normal', undefined, { type: 'amount', value: 100 });
    expect(l.netExclVat).toBe(0);
    expect(l.discountAmount).toBe(20);
  });
});

describe('priceCartLine - tier discount stacking', () => {
  it('applies the tier rate on whatever remains after the offer (legacy two-stage flow)', () => {
    // VIP (10%) on a 10%-offer line: gross 30 -> offer 3 -> tier on 27 = 2.70 -> net 24.30.
    const l = priceCartLine(item(), batch(), 3, [offer()], 'vip');
    expect(l.discountAmount).toBe(5.7);
    expect(l.netExclVat).toBe(24.3);
  });

  it('applies the special-tier rate with no offer', () => {
    // gross 40, special tier 5% = 2 -> net 38, 15% VAT on 38 = 5.7 -> total 43.7.
    const l = priceCartLine(item({ vatRate: 0.15 }), batch(), 4, [], 'special');
    expect(l.discountAmount).toBe(2);
    expect(l.netExclVat).toBe(38);
    expect(l.vatAmount).toBe(5.7);
    expect(l.totalInclVat).toBe(43.7);
  });

  it('leaves the normal tier at zero discount', () => {
    expect(priceCartLine(item(), batch(), 3, [], 'normal').discountAmount).toBe(0);
  });
});

describe('computeCartTotals', () => {
  it('sums every line and groups VAT by the rates actually present', () => {
    // A representative mixed invoice: two 15% cosmetics lines + one 0% medicine line.
    const lines = [
      priceCartLine(item({ id: 'a', vatRate: 0.15 }), batch({ id: 'ba', itemId: 'a' }), 2, [], 'normal'),
      priceCartLine(item({ id: 'b', vatRate: 0.15 }), batch({ id: 'bb', itemId: 'b' }), 1, [], 'normal'),
      priceCartLine(item({ id: 'c', basePrice: 20 }), batch({ id: 'bc', itemId: 'c' }), 1, [], 'normal'),
    ];
    const t = computeCartTotals(lines);
    expect(t.subtotalExclVat).toBe(50); // 2*10 + 1*10 + 1*20
    expect(t.totalDiscount).toBe(0);
    expect(t.totalVatAmount).toBe(4.5); // (20 * 0.15) + (10 * 0.15)
    expect(t.totalInclVat).toBe(54.5);
    expect(t.vatByRate).toEqual([
      { rate: 0.15, taxableAmount: 30, vatAmount: 4.5 },
      { rate: 0, taxableAmount: 20, vatAmount: 0 },
    ]);
  });

  it('aggregates each line\'s own precomputed discount', () => {
    // One offer line + one plain line: discounts only accumulate where they were applied.
    const lines = [
      priceCartLine(item(), batch(), 3, [offer()], 'vip'), // discount 5.7, net 24.3
      priceCartLine(item({ id: 'd', basePrice: 15 }), batch({ id: 'bd', itemId: 'd' }), 1, [], 'normal'), // net 15
    ];
    const t = computeCartTotals(lines);
    expect(t.totalDiscount).toBe(5.7);
    expect(t.subtotalExclVat).toBe(45); // 3*10 + 1*15
    expect(t.totalInclVat).toBe(39.3); // 24.3 + 15 (both zero-rated)
  });
});

describe('pack-ladder pricing', () => {
  const pack = { cartonSize: 100, boxSize: 3, stripSize: 4 }; // 1 box = 12 tablets

  it('charges the box price at box level and derives strip/tablet prices', () => {
    const packedItem = item({ pack });
    const packedBatch = batch({ qtyOnHand: 120 }); // tablets, not boxes
    const box = priceCartLine(packedItem, packedBatch, 1, [], 'normal', undefined, undefined, 'box');
    const strip = priceCartLine(packedItem, packedBatch, 1, [], 'normal', undefined, undefined, 'strip');
    const tablet = priceCartLine(packedItem, packedBatch, 1, [], 'normal', undefined, undefined, 'tablet');

    expect(box.unitPrice).toBe(10);
    expect(box.baseQty).toBe(12);
    expect(box.qtyAvailable).toBe(10); // 120 tablets = 10 boxes
    expect(strip.unitPrice).toBeCloseTo(3.3333333, 6);
    expect(strip.baseQty).toBe(4);
    expect(tablet.unitPrice).toBeCloseTo(0.8333333, 6);
    expect(tablet.baseQty).toBe(1);
    expect(tablet.qtyAvailable).toBe(120);
  });

  it('keeps a loose-tablet sale total equal to the box price', () => {
    const packedItem = item({ pack });
    const packedBatch = batch({ qtyOnHand: 120 });
    const line = priceCartLine(packedItem, packedBatch, 12, [], 'normal', undefined, undefined, 'tablet');
    expect(line.totalInclVat).toBe(10); // round2 only at the line total, no per-unit drift
  });

  it('leaves an item without a pack ladder on its own unit', () => {
    const plain = priceCartLine(item(), batch({ qtyOnHand: 100 }), 2, [], 'normal');
    expect(plain.packLevel).toBeUndefined();
    expect(plain.unit).toBe('Box');
    expect(plain.baseQty).toBe(2);
    expect(plain.qtyAvailable).toBe(100);
    expect(resolveSalePrice(item(), batch(), 'tablet')).toBe(10); // level ignored when no pack
  });
});

// Business rule confirmed with the owner: an offer is built on the item's main unit - the BOX.
// A strip/tablet sale contributes to the box bundle, but a few loose tablets must not earn a whole
// free box before a full box value exists, and 3 loose units are not 3 boxes.
describe('buy-X-get-Y offers are measured on the box for packed items', () => {
  const bogo = offer({ type: 'bogo', percent: undefined, buyQty: 2, freeQty: 1, label: 'Buy 2 Get 1 Free' });
  // Paracetamol: 1 box = 2 strips = 20 tablets, box price 4.50.
  const pack = { cartonSize: 1, boxSize: 2, stripSize: 10 };
  const paracetamol = item({ pack, basePrice: 4.5, unit: 'Box' });

  it('does not pay out a free box for a few loose tablets', () => {
    const l = priceCartLine(paracetamol, batch(), 5, [bogo], 'normal', undefined, undefined, 'tablet');
    expect(l.discountAmount).toBe(0);
    expect(l.offerLabel).toBeUndefined();
  });

  it('pays one free box once three boxes worth of tablets are in the cart', () => {
    // 60 tablets = 3 boxes -> one free box (20 tablets x 0.225 = 4.50).
    const l = priceCartLine(paracetamol, batch(), 60, [bogo], 'normal', undefined, undefined, 'tablet');
    expect(l.offerLabel).toBe('Buy 2 Get 1 Free');
    expect(l.discountAmount).toBe(4.5);
    expect(l.netExclVat).toBe(9); // 13.50 gross - 4.50
  });

  it('values the free gift at the box price whatever level the line is sold in', () => {
    const boxLine = priceCartLine(paracetamol, batch(), 3, [bogo], 'normal', undefined, undefined, 'box');
    expect(boxLine.discountAmount).toBe(4.5);
    const stripLine = priceCartLine(paracetamol, batch(), 6, [bogo], 'normal', undefined, undefined, 'strip');
    // 6 strips = 60 tablets = 3 boxes, even though 6 strips is not "3" of anything at strip level.
    expect(stripLine.discountAmount).toBe(4.5);
  });

  it('does not treat 3 strips (1.5 boxes) as a box bundle', () => {
    expect(allocateBogoFreeUnits(bogo, [{ id: 'l', qty: 3, baseQty: 30 }], pack).size).toBe(0);
  });

  it('allocates free tablets across mixed-level lines, box line first', () => {
    const allocation = allocateBogoFreeUnits(
      bogo,
      [
        { id: 'box', qty: 2, baseQty: 40 },
        { id: 'strip', qty: 1, baseQty: 10 },
        { id: 'tab', qty: 10, baseQty: 10 },
      ],
      pack
    );
    // 60 tablets = 3 boxes -> 20 free tablets, all covered by the first (box) line.
    expect(allocation.get('box')).toBe(20);
    expect(allocation.has('strip')).toBe(false);
    expect(allocation.has('tab')).toBe(false);
  });
});
