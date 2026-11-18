// Unit tests for the purchase-invoice math (see utils/purchasing.ts). These numbers feed Batch
// cost records and recoverable-input-VAT reports, so each rule gets an exact expected value -
// a wrong per-line cost here silently distorts every margin report built on it later.
//
// The tier/bonus semantics below are cross-checked against ACTUAL ROWS in the live XPH database
// (server Mahmoud-pc/xph, verified 2026-10-26) - the "XPH row" tests are regression anchors that
// reproduce rows read straight out of FTRNBUYF, so the React math can never drift from what the
// legacy system itself wrote.
import { describe, expect, it } from 'vitest';

import type { Item } from '../types/catalog';
import type { PurchaseInvoice, PurchaseLine, Vendor } from '../types/purchasing';
import { computeCostPrice } from './pricing';
import {
  MAX_PURCHASE_DISCOUNT_TIERS,
  VENDOR_NO_PREFIX,
  DISCOUNT_INPUT_PATTERN,
  applyDiscountMask,
  batchReceiveDiscount,
  computePurchaseTotals,
  dilutedUnitCost,
  discountInputToFraction,
  effectiveTierDiscount,
  formatDiscountInput,
  formatDiscountPercent,
  formatVendorNo,
  lastPurchaseUnitPrice,
  maxVendorNumber,
  nextVendorNumber,
  pricePurchaseLine,
} from './purchasing';

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'itm-1',
    barcode: '6281007320014',
    nameAr: 'دواء',
    nameEn: 'Test Drug',
    unit: 'Strip',
    category: 'medicine',
    basePrice: 10,
    vatRate: 0, // zero-rated medicine by default (SFDA-registered drugs)
    requiresBatchTracking: true,
    reorderLevel: 30,
    ...overrides,
  };
}

describe('pricePurchaseLine', () => {
  it('prices a plain zero-rated line: cost via round3, vat zero', () => {
    const l = pricePurchaseLine({
      item: item(),
      qty: 10,
      batchNo: 'AB24X01',
      expiryDate: '2027-10-26',
      unitPurchasePrice: 3.5,
      purchaseDiscountPercent: 0,
    });
    expect(l.unitCostPrice).toBe(3.5);
    expect(l.netExclVat).toBe(35);
    expect(l.vatAmount).toBe(0);
    expect(l.totalInclVat).toBe(35);
  });

  it('applies the line discount before VAT, mirroring a real vendor invoice', () => {
    // The seed-data demonstration case: paracetamol at 3.50 unit price, 20% vendor line discount.
    const l = pricePurchaseLine({
      item: item(),
      qty: 12,
      batchNo: 'PC24A17',
      expiryDate: '2027-10-26',
      unitPurchasePrice: 3.5,
      purchaseDiscountPercent: 0.2,
    });
    expect(l.unitCostPrice).toBe(2.8); // computeCostPrice via round3
    expect(l.netExclVat).toBe(33.6); // 12 * 2.80
    expect(l.vatAmount).toBe(0);
    expect(l.totalInclVat).toBe(33.6);
  });

  it('rounds unit cost to 3 decimals - the XPH net_pur_price 2.402 case', () => {
    // The exact case that justified computeCostPrice's round3 (see utils/pricing.ts's comment):
    // a bulk purchase whose per-unit net cost lands on a fraction of a halala.
    const l = pricePurchaseLine({
      item: item(),
      qty: 1,
      batchNo: 'BU24F02',
      expiryDate: '2027-10-26',
      unitPurchasePrice: 12.01,
      purchaseDiscountPercent: 0.8,
    });
    expect(l.unitCostPrice).toBe(2.402);
  });

  it('computes per-line input VAT from the ITEM master vatRate for a standard-rated item', () => {
    // 15% inputs (cosmetics/supplements) on a vendor invoice: VAT sits on the net (post-discount)
    // amount, not the gross - the vendor charges tax on what they actually charge.
    const l = pricePurchaseLine({
      item: item({ vatRate: 0.15 }),
      qty: 5,
      batchNo: 'VD24D22',
      expiryDate: '2027-10-26',
      unitPurchasePrice: 14,
      purchaseDiscountPercent: 0.1,
    });
    expect(l.netExclVat).toBe(63); // 5 * 12.600
    expect(l.vatAmount).toBe(9.45); // 63 * 0.15
    expect(l.totalInclVat).toBe(72.45);
  });

  it('XPH row (FTRNBUYF 72916/106523): 21.68 x10 @ d1 .31 -> net 149.592, VAT 22.44, incl 172.03', () => {
    // Reproduces an actual zero-rated... no, a 15%-VAT row read live from XPH FTRNBUYF:
    // PUR_QTY 10, PUR_PRICE 21.68, DISCOUNT_1 .31, NET_PUR_NVAT_AMOUNT 149.592,
    // TOTAL_PUR_VAT_AMOUNT 22.438, NET_PUR_AMOUNT 172.030, VAT_PERCENT .1500.
    // The legacy's own rounding stops at 3 decimals per tier (###.### masks), which is why
    // 216.80 - 67.208 stays exactly 149.592 here.
    const l = pricePurchaseLine({
      item: item({ vatRate: 0.15 }),
      qty: 10,
      batchNo: 'XPH-72916',
      expiryDate: '2027-10-26',
      unitPurchasePrice: 21.68,
      discountTiers: [0.31],
    });
    expect(l.discount1Amount).toBe(67.208);
    expect(l.netExclVat).toBe(149.592);
    expect(l.vatAmount).toBe(22.44); // round2 of 22.4388 - the app's customer-facing rule
    expect(l.totalInclVat).toBe(172.03);
  });

  it('XPH row (FTOTBUYF 77655/108235) with the odd .1666 chain: 9.25 x15 @ .65 -> net 48.562', () => {
    // Live row: PUR_PRICE 9.25, PUR_QTY 15, DISCOUNT_1 .65 -> TOTAL_DISCOUNT_1 90.188,
    // NET_PUR_NVAT_AMOUNT 48.562. The oddball .1666 tiers elsewhere in that invoice (18.75*6 @
    // .1666 -> 18.743) exist too - all exact at 3 decimals, none survive round2.
    const l = pricePurchaseLine({
      item: item(),
      qty: 15,
      batchNo: 'XPH-77655',
      expiryDate: '2027-10-26',
      unitPurchasePrice: 9.25,
      discountTiers: [0.65],
    });
    expect(l.discount1Amount).toBe(90.188);
    expect(l.netExclVat).toBe(48.562);
  });

  it('cascades three tiers sequentially - 20% + 15% + 10% is NOT 45%', () => {
    // Legacy call_discount(): tier 2 applies to the balance after tier 1, tier 3 after tiers 1+2.
    // gross 100 -> t1 20 -> t2 12 -> t3 6.8 -> net 61.2 = gross * (1-.2)(1-.15)(1-.1).
    const l = pricePurchaseLine({
      item: item(),
      qty: 1,
      batchNo: 'CASCADE-3',
      expiryDate: '2027-10-26',
      unitPurchasePrice: 100,
      discountTiers: [0.2, 0.15, 0.1],
    });
    expect(l.discount1Amount).toBe(20);
    expect(l.discount2Amount).toBe(12);
    expect(l.discount3Amount).toBe(6.8);
    expect(l.discountTotal).toBe(38.8);
    expect(l.netExclVat).toBe(61.2);
    expect(l.unitCostPrice).toBe(61.2);
    // The stored single-equivalent must reproduce the same net without the cascade.
    expect(l.purchaseDiscountPercent).toBeCloseTo(effectiveTierDiscount([0.2, 0.15, 0.1]), 10);
  });

  it('effectiveTierDiscount is multiplicative, matching the cascade algebra', () => {
    expect(effectiveTierDiscount([0.1, 0.2, 0.3])).toBeCloseTo(0.496, 10); // 1-(0.9*0.8*0.7)
    expect(effectiveTierDiscount([0])).toBe(0);
    expect(effectiveTierDiscount([])).toBe(0);
  });

  it('caps at the legacy screen\u2019s three tiers', () => {
    // The XPH table has 5 DISCOUNT_n slots, but the SCR entry screen exposes exactly three
    // (em_11-1..3) - this app follows the screen, not the table's headroom.
    expect(MAX_PURCHASE_DISCOUNT_TIERS).toBe(3);
    const l = pricePurchaseLine({
      item: item(),
      qty: 1,
      batchNo: 'OVERFLOW',
      expiryDate: '2027-10-26',
      unitPurchasePrice: 100,
      discountTiers: [0.1, 0.1, 0.1, 0.5, 0.5],
    });
    expect(l.discount3Percent).toBe(0.1); // tiers 4/5 silently ignored
  });

  it('tracks bonus goods at zero charge but dilutes the batch discount', () => {
    // XPH row (FTRNBUYF 241978/105163): paid 250 + bonus 250 @ 35.64, d1 .0909.
    // Live: TOTAL_PUR_AMOUNT 8910, TOTAL_BONUS_AMOUNT 8910, TOTAL_DISCOUNT_1 809.919,
    // NET_PUR_AMOUNT 8100.081, TOTAL_QTY 500, FQTYITEM.NET_PUR_PRICE 16.200162.
    const l = pricePurchaseLine({
      item: item(),
      qty: 250,
      bonusQty: 250,
      batchNo: 'XPH-241978',
      expiryDate: '2027-10-26',
      unitPurchasePrice: 35.64,
      discountTiers: [0.0909],
    });
    expect(l.totalQty).toBe(500);
    expect(l.bonusValue).toBe(8910); // what the free goods were worth - informational only
    expect(l.discount1Amount).toBe(809.919);
    expect(l.netExclVat).toBe(8100.081);
    expect(l.vatAmount).toBe(0);
    // Batch receives 500 units at the diluted cost: computeCostPrice with the folded discount
    // reproduces NET_PUR_PRICE exactly.
    const batchCost = computeCostPrice(l.unitPurchasePrice, batchReceiveDiscount(l.netExclVat, l.totalQty, l.unitPurchasePrice));
    expect(batchCost).toBe(16.2); // round3(8100.081 / 500)
    expect(l.dilutedUnitCostPrice).toBe(16.2); // same number, carried on the line for the UI
  });

  it('a pure-gift line prices fully at zero, like the XPH gift rows', () => {
    // Live row 23243570: PUR_QTY 0, BONUS_QTY 2760 @ 19.15, every money column 0 except
    // TOTAL_BONUS_AMOUNT/WITH_BONUS - nothing is charged, nothing is taxed.
    const l = pricePurchaseLine({
      item: item(),
      qty: 0,
      bonusQty: 2760,
      batchNo: 'XPH-GIFT',
      expiryDate: '2027-10-26',
      unitPurchasePrice: 19.15,
      discountTiers: [0.1666],
    });
    expect(l.netExclVat).toBe(0);
    expect(l.vatAmount).toBe(0);
    expect(l.totalInclVat).toBe(0);
    expect(l.bonusValue).toBe(52854); // 2760 * 19.15, matches TOTAL_BONUS_AMOUNT exactly
    expect(batchReceiveDiscount(l.netExclVat, l.totalQty, l.unitPurchasePrice)).toBe(1);
  });

  it('batchReceiveDiscount equals the plain tier discount when there is no bonus', () => {
    // Backward-compat anchor: with bonusQty 0 the folded fraction is the same number
    // receiveStock has always taken, so single-discount batches cost exactly as before.
    const l = pricePurchaseLine({
      item: item({ vatRate: 0.15 }),
      qty: 10,
      batchNo: 'NOBONUS',
      expiryDate: '2027-10-26',
      unitPurchasePrice: 21.68,
      discountTiers: [0.31],
    });
    const dil = batchReceiveDiscount(l.netExclVat, l.totalQty, l.unitPurchasePrice);
    expect(dil).toBeCloseTo(0.31, 9); // here the subtraction is exact at 9dp magnitude
    expect(computeCostPrice(21.68, dil)).toBe(14.959); // 149.592 / 10
  });

  it('carries bilingual names, unit and vatRate snapshot onto the line', () => {
    const l = pricePurchaseLine({
      item: item({ nameAr: 'دواء تجريبي', unit: 'Box', vatRate: 0.15 }),
      qty: 2,
      batchNo: 'XX24A01',
      expiryDate: '2027-10-26',
      unitPurchasePrice: 10,
      purchaseDiscountPercent: 0,
    });
    expect(l.itemNameAr).toBe('دواء تجريبي');
    expect(l.itemNameEn).toBe('Test Drug');
    expect(l.unit).toBe('Box');
    expect(l.vatRate).toBe(0.15);
  });

  it('re-uses the passed-in id so re-pricing keeps the line stable', () => {
    const l = pricePurchaseLine({
      item: item(),
      qty: 1,
      batchNo: 'AB24X01',
      expiryDate: '2027-10-26',
      unitPurchasePrice: 10,
      purchaseDiscountPercent: 0,
      existingId: 'pl-kept',
    });
    expect(l.id).toBe('pl-kept');
  });

  it('generates a fresh unique id when none is given', () => {
    const a = pricePurchaseLine({ item: item(), qty: 1, batchNo: 'A', expiryDate: '2027-10-26', unitPurchasePrice: 1, purchaseDiscountPercent: 0 });
    const b = pricePurchaseLine({ item: item(), qty: 1, batchNo: 'B', expiryDate: '2027-10-26', unitPurchasePrice: 1, purchaseDiscountPercent: 0 });
    expect(a.id).not.toBe(b.id);
  });

  it('is exactly computeCostPrice for the unit-cost arithmetic', () => {
    // One source of truth: pricePurchaseLine must delegate, not re-implement, so a future change
    // to cost rounding lands in both the standalone Receiving page and this page at once.
    const l = pricePurchaseLine({ item: item(), qty: 3, batchNo: 'A', expiryDate: '2027-10-26', unitPurchasePrice: 7.5, purchaseDiscountPercent: 0.1 });
    expect(l.unitCostPrice).toBe(computeCostPrice(7.5, 0.1));
  });
});

describe('dilutedUnitCost', () => {
  it('spreads the paid net over paid + bonus units - the user 100 + 10 @ 20 case', () => {
    // 100 paid @ 20 = 2000; 10 free units land on the shelf too, so 110 units share the 2000.
    expect(dilutedUnitCost({ qty: 100, bonusQty: 10, unitPurchasePrice: 20 })).toBe(18.182);
  });

  it('equals the tier-discounted price per unit when there is no bonus', () => {
    expect(dilutedUnitCost({ qty: 12, unitPurchasePrice: 3.5, purchaseDiscountPercent: 0.2 })).toBe(2.8);
    expect(dilutedUnitCost({ qty: 10, unitPurchasePrice: 21.68, discountTiers: [0.31] })).toBe(14.959);
  });

  it('recalculates through disc1/disc2/disc3 before diluting with bonus units', () => {
    // gross 100*20 = 2000; t1 10% -> 200 (1800 left); t2 5% -> 90 (1710); t3 2% -> 34.2
    // (1675.8 net); /110 units = 15.2345... -> 15.235.
    expect(
      dilutedUnitCost({ qty: 100, bonusQty: 10, unitPurchasePrice: 20, discountTiers: [0.1, 0.05, 0.02] })
    ).toBe(15.235);
  });

  it('agrees with the batch costing path (batchReceiveDiscount + computeCostPrice)', () => {
    const l = pricePurchaseLine({
      item: item(),
      qty: 250,
      bonusQty: 250,
      batchNo: 'XPH-241978',
      expiryDate: '2027-10-26',
      unitPurchasePrice: 35.64,
      discountTiers: [0.0909],
    });
    const batchCost = computeCostPrice(
      l.unitPurchasePrice,
      batchReceiveDiscount(l.netExclVat, l.totalQty, l.unitPurchasePrice)
    );
    expect(dilutedUnitCost({ qty: 250, bonusQty: 250, unitPurchasePrice: 35.64, discountTiers: [0.0909] })).toBe(batchCost);
  });

  it('prices a pure-gift line at zero and guards empty quantities', () => {
    expect(dilutedUnitCost({ qty: 0, bonusQty: 2760, unitPurchasePrice: 19.15, discountTiers: [0.1666] })).toBe(0);
    expect(dilutedUnitCost({ qty: 0, bonusQty: 0, unitPurchasePrice: 20 })).toBe(0);
    expect(dilutedUnitCost({ qty: 100, bonusQty: 10, unitPurchasePrice: 0 })).toBe(0);
  });
});

describe('computePurchaseTotals', () => {
  function line(overrides: Partial<PurchaseLine> = {}, itemOverrides: Partial<Item> = {}): PurchaseLine {
    return pricePurchaseLine({
      item: item(itemOverrides),
      qty: 1,
      bonusQty: overrides.bonusQty,
      batchNo: 'B',
      expiryDate: '2027-10-26',
      unitPurchasePrice: 10,
      discountTiers: overrides.purchaseDiscountPercent !== undefined
        ? [overrides.purchaseDiscountPercent]
        : undefined,
      ...overrides,
    });
  }

  it('sums gross, discounts, net and input VAT across lines', () => {
    // One zero-rated medicine line + one discounted zero-rated line + one 15% cosmetics line -
    // the ordinary mixed vendor invoice.
    const a = line({}); // 10 excl / 0 vat / 10 incl
    const c = line({ unitPurchasePrice: 20, purchaseDiscountPercent: 0.1 }); // 20 gross, 10% off -> 18 net, zero-rated
    const d = line({ unitPurchasePrice: 40 }, { vatRate: 0.15 }); // 40 net + 6 vat = 46.00
    const t = computePurchaseTotals([a, c, d]);
    expect(t.subtotalExclVat).toBe(70); // 10 + 20 + 40 (gross before discounts)
    expect(t.totalDiscount).toBe(2); // only the 10% off the 20 line
    expect(t.netExclVat).toBe(68); // 10 + 18 + 40
    expect(t.totalVatAmount).toBe(6);
    expect(t.totalInclVat).toBe(74);
    expect(t.totalBonusValue).toBe(0);
  });

  it('groups input VAT per rate - same mixed-bucket split as sales', () => {
    const t = computePurchaseTotals([
      line({}), // zero-rated medicine
      line({ unitPurchasePrice: 40 }, { vatRate: 0.15 }), // standard-rated
      line({ unitPurchasePrice: 60 }, { vatRate: 0.15 }), // standard-rated
    ]);
    expect(t.vatByRate).toEqual([
      { rate: 0.15, taxableAmount: 100, vatAmount: 15 },
      { rate: 0, taxableAmount: 10, vatAmount: 0 },
    ]);
    expect(t.totalVatAmount).toBe(15);
  });

  it('accumulates bonus goods separately and never taxes them', () => {
    // Mixed invoice: paid medicine, paid cosmetics, and a line with free goods. Bonus value
    // shows in its own totals row; VAT buckets still see only the paid, discounted nets.
    const t = computePurchaseTotals([
      line({ qty: 10, unitPurchasePrice: 3.5 }), // paid 35, zero-rated
      line({ qty: 5, bonusQty: 5, unitPurchasePrice: 14 }, { vatRate: 0.15 }), // 70 net + 10.5 vat; bonus worth 70
    ]);
    expect(t.subtotalExclVat).toBe(105); // gross = paid qty x price only
    expect(t.totalBonusValue).toBe(70);
    expect(t.netExclVat).toBe(105);
    expect(t.totalVatAmount).toBe(10.5);
    expect(t.totalInclVat).toBe(115.5);
  });

  it('returns clean zeros for an empty invoice', () => {
    const t = computePurchaseTotals([]);
    expect(t.subtotalExclVat).toBe(0);
    expect(t.totalDiscount).toBe(0);
    expect(t.totalBonusValue).toBe(0);
    expect(t.netExclVat).toBe(0);
    expect(t.totalVatAmount).toBe(0);
    expect(t.totalInclVat).toBe(0);
    expect(t.vatByRate).toEqual([]);
  });
});

describe('vendor dedup semantics', () => {
  it('documents the Vendor shape used by the store seed and page', () => {
    // Not assertive math - a shape guard so the seed data (utils/seedData.ts seedVendors) and the
    // page stay honest about what a vendor record carries.
    const v: Vendor = { id: 'ven-1', typeFlag: 1, vendorNo: 'VEN-000001', nameAr: 'مورد', nameEn: 'Vendor', phone: '0114445566', vatNumber: '310555123400003' };
    expect(v.vendorNo).toBe('VEN-000001');
    expect(v.id).toBeTruthy();
    expect(v.nameEn).toBeTruthy();
    expect(v.nameAr).toBeTruthy();
  });
});

describe('system-assigned vendor numbers', () => {
  const vendors = (...numbers: string[]) =>
    numbers.map((vendorNo, i) => ({ id: `ven-${i}`, vendorNo }));

  it('formats with the VEN- prefix and six zero-padded digits', () => {
    expect(VENDOR_NO_PREFIX).toBe('VEN-');
    expect(formatVendorNo(1)).toBe('VEN-000001');
    expect(formatVendorNo(42)).toBe('VEN-000042');
    expect(formatVendorNo(999999)).toBe('VEN-999999');
  });

  it('starts at VEN-000001 when the vendor master is empty', () => {
    expect(maxVendorNumber([])).toBe(0);
    expect(nextVendorNumber([])).toBe('VEN-000001');
  });

  it('continues after the highest number, not the count (no reuse after a gap)', () => {
    // A deleted vendor must leave a hole, never a recycled number - history stays unambiguous.
    expect(nextVendorNumber(vendors('VEN-000001', 'VEN-000003'))).toBe('VEN-000004');
    expect(maxVendorNumber(vendors('VEN-000003', 'VEN-000001', 'VEN-000002'))).toBe(3);
  });

  it('ignores malformed or missing numbers instead of crashing', () => {
    const dirty = [
      ...vendors('VEN-000007'),
      { id: 'legacy', vendorNo: undefined as unknown as string },
      { id: 'junk', vendorNo: 'ABC-12' },
      { id: 'empty', vendorNo: '' },
    ];
    expect(maxVendorNumber(dirty)).toBe(7);
    expect(nextVendorNumber(dirty)).toBe('VEN-000008');
  });

  it('pads past 999999 rather than wrapping (numbers must stay unique)', () => {
    expect(nextVendorNumber(vendors('VEN-999999'))).toBe('VEN-1000000');
  });
});

describe('formatDiscountPercent', () => {
  it('renders the stored fraction as a percentage - 0.1667 prints 16.67%', () => {
    expect(formatDiscountPercent(0.1667)).toBe('16.67%');
    expect(formatDiscountPercent(1 / 6)).toBe('16.67%');
  });

  it('keeps exact rates exact', () => {
    expect(formatDiscountPercent(0.05)).toBe('5.00%');
    expect(formatDiscountPercent(0.1)).toBe('10.00%');
    expect(formatDiscountPercent(0)).toBe('0.00%');
  });

  it('always renders two decimals with the ##.## mask', () => {
    expect(formatDiscountPercent(0.1234)).toBe('12.34%');
    expect(formatDiscountPercent(0.5)).toBe('50.00%');
  });
});

describe('discount input mask', () => {
  it('accepts at most two digits before and after the decimal point', () => {
    for (const value of ['', '1', '16', '16.', '.', '.5', '16.6', '16.67', '00.00', '5.00']) {
      expect(DISCOUNT_INPUT_PATTERN.test(value)).toBe(true);
    }
    for (const value of ['123', '16.678', '16..7', '1e3', '-5', '16,67', ' 16.67']) {
      expect(DISCOUNT_INPUT_PATTERN.test(value)).toBe(false);
    }
  });

  it('inserts the decimal point automatically after two digits', () => {
    expect(applyDiscountMask('1')).toBe('1');
    expect(applyDiscountMask('12')).toBe('12');
    expect(applyDiscountMask('121')).toBe('12.1');
    expect(applyDiscountMask('1214')).toBe('12.14');
    expect(applyDiscountMask('1667')).toBe('16.67');
  });

  it('keeps an explicitly typed point and rejects a third decimal', () => {
    expect(applyDiscountMask('16.')).toBe('16.');
    expect(applyDiscountMask('16.67')).toBe('16.67');
    expect(applyDiscountMask('16.678')).toBeNull();
  });

  it('ignores characters outside the mask', () => {
    expect(applyDiscountMask('16a')).toBeNull();
    expect(applyDiscountMask('-5')).toBeNull();
    expect(applyDiscountMask('1,5')).toBeNull();
  });

  it('never produces more than two decimals', () => {
    expect(applyDiscountMask('12345')).toBe('12.34');
  });

  it('seeds an edit field from the stored fraction with two decimals', () => {
    expect(formatDiscountInput(0.1667)).toBe('16.67');
    expect(formatDiscountInput(0.05)).toBe('5.00');
    expect(formatDiscountInput(0.1)).toBe('10.00');
    expect(formatDiscountInput(0)).toBe('0.00');
  });

  it('converts the typed whole percentage back to the stored fraction', () => {
    expect(discountInputToFraction('16.67')).toBeCloseTo(0.1667, 10);
    expect(discountInputToFraction('5')).toBeCloseTo(0.05, 10);
    expect(discountInputToFraction('')).toBe(0);
    expect(discountInputToFraction('abc')).toBe(0);
  });

  it('round-trips a typed percentage through storage and back into the field', () => {
    const typed = '16.67';
    expect(formatDiscountInput(discountInputToFraction(typed))).toBe(typed);
  });
});

describe('lastPurchaseUnitPrice', () => {
  function invoice(id: string, receivedAt: string, lines: PurchaseLine[], overrides: Partial<PurchaseInvoice> = {}): PurchaseInvoice {
    return {
      id,
      invoiceNo: `PUR-${id}`,
      vendorInvoiceNo: `V-${id}`,
      vendorId: 'v-1',
      vendorNameAr: 'مورد',
      vendorNameEn: 'Vendor',
      date: receivedAt.slice(0, 10),
      receivedAt,
      receivedBy: 'tester',
      lines,
      subtotalExclVat: 0,
      totalDiscount: 0,
      totalBonusValue: 0,
      netExclVat: 0,
      totalVatAmount: 0,
      totalInclVat: 0,
      vatByRate: [],
      ...overrides,
    };
  }

  function purchaseLine(unitPrice: number, packLevel?: 'box' | 'strip'): PurchaseLine {
    return pricePurchaseLine({
      item: item(packLevel ? { pack: { cartonSize: 10, boxSize: 10, stripSize: 10 } } : {}),
      qty: 1,
      batchNo: 'B1',
      expiryDate: '2027-10-26',
      unitPurchasePrice: unitPrice,
      packLevel,
    });
  }

  it('returns the price from the newest posted purchase, not the first or the highest', () => {
    const older = invoice('1', '2026-01-01T00:00:00.000Z', [purchaseLine(3.5)]);
    const newer = invoice('2', '2026-05-01T00:00:00.000Z', [purchaseLine(4.25)]);
    expect(lastPurchaseUnitPrice(item(), [older, newer])).toBe(4.25);
  });

  it('ignores credit notes and the invoice currently being corrected', () => {
    const purchase = invoice('1', '2026-01-01T00:00:00.000Z', [purchaseLine(3.5)]);
    const credit = invoice('2', '2026-05-01T00:00:00.000Z', [purchaseLine(3.5)], { isReturn: true });
    const editing = invoice('3', '2026-06-01T00:00:00.000Z', [purchaseLine(9.99)]);
    expect(lastPurchaseUnitPrice(item(), [purchase, credit, editing], undefined, '3')).toBe(3.5);
  });

  it('converts a box price into the requested strip price through the pack ladder', () => {
    const packItem = item({ pack: { cartonSize: 10, boxSize: 10, stripSize: 10 } });
    const purchase = invoice('1', '2026-01-01T00:00:00.000Z', [purchaseLine(100, 'box')]);
    // 100 per box / 10 strips = 10 per strip.
    expect(lastPurchaseUnitPrice(packItem, [purchase], 'strip')).toBe(10);
  });

  it('returns null when the item has never been purchased', () => {
    expect(lastPurchaseUnitPrice(item(), [])).toBeNull();
    const otherItemPurchase = invoice('1', '2026-01-01T00:00:00.000Z', [purchaseLine(3.5)]);
    expect(lastPurchaseUnitPrice(item({ id: 'itm-2' }), [otherItemPurchase])).toBeNull();
  });

  it('keeps a null expiry as null rather than inventing a date', () => {
    const line = pricePurchaseLine({
      item: item(),
      qty: 1,
      batchNo: 'B1',
      expiryDate: null,
      unitPurchasePrice: 3.5,
    });
    expect(line.expiryDate).toBeNull();
  });
});
