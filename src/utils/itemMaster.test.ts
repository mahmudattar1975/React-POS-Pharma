import { describe, expect, it } from 'vitest';
import type { Batch, Item } from '../types/catalog';
import {
  EMPTY_ITEM_FORM, codeConflictMessage, duplicateCodeOwner, duplicateIdentityErrors, formToItemInput,
  isValidBarcode, itemCodes, itemMovementTotals, itemNumberOf, itemToForm, itemTracksExpiry, nextItemNumber,
  validateItemForm,
} from './itemMaster';

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'itm-1',
    barcode: '6281007320014',
    nameAr: 'باراسيتامول',
    nameEn: 'Paracetamol 500mg',
    unit: 'Strip',
    category: 'Analgesics',
    basePrice: 4.5,
    vatRate: 0,
    requiresBatchTracking: true,
    reorderLevel: 30,
    ...overrides,
  };
}

function form(overrides: Partial<typeof EMPTY_ITEM_FORM> = {}) {
  return {
    ...EMPTY_ITEM_FORM,
    barcode: '6281007329999',
    nameEn: 'Test Item',
    nameAr: 'صنف اختبار',
    category: 'Analgesics',
    unit: 'Box',
    basePrice: '10.5',
    reorderLevel: '20',
    ...overrides,
  };
}

describe('item numbering', () => {
  it('derives legacy numbers from seed and ERP ids when itemNo is missing', () => {
    expect(itemNumberOf(item({ id: 'itm-1' }))).toBe(1001);
    expect(itemNumberOf(item({ id: 'itm-10' }))).toBe(1010);
    expect(itemNumberOf(item({ id: 'erp-101682' }))).toBe(101682);
  });

  it('prefers a stored itemNo', () => {
    expect(itemNumberOf(item({ itemNo: 42 }))).toBe(42);
  });

  it('numbers local items above existing local numbers but ignores ERP numbers', () => {
    const items = [item({ id: 'itm-1' }), item({ id: 'itm-2', barcode: '2' }), item({ id: 'erp-101682', barcode: '3' })];
    expect(nextItemNumber(items)).toBe(1003);
  });
});

describe('item dosage links', () => {
  it('keeps linked directions and a default that points at one of them', () => {
    const source = item({ dosageIds: ['dos-1', 'dos-2'], defaultDosageId: 'dos-2' });
    const saved = formToItemInput(itemToForm(source));
    expect(saved.dosageIds).toEqual(['dos-1', 'dos-2']);
    expect(saved.defaultDosageId).toBe('dos-2');
  });

  it('never saves a default that is not linked', () => {
    const source = item({ dosageIds: ['dos-1', 'dos-2'], defaultDosageId: 'dos-2' });
    const saved = formToItemInput({ ...itemToForm(source), defaultDosageId: 'dos-9' });
    expect(saved.dosageIds).toEqual(['dos-1', 'dos-2']);
    expect(saved.defaultDosageId).toBeUndefined();
  });

  it('clears both when the owner removes every link', () => {
    const source = item({ dosageIds: ['dos-1'], defaultDosageId: 'dos-1' });
    const saved = formToItemInput({ ...itemToForm(source), dosageIds: [] });
    expect(saved.dosageIds).toBeUndefined();
    expect(saved.defaultDosageId).toBeUndefined();
  });
});

describe('item form conversion', () => {
  it('folds a legacy GTIN into the barcode list on edit', () => {
    const source = item({
      gtin: '06281007320014',
      barcodes: ['6281007000011'],
      registrationNo: 'REG-1',
      customsNo: 'C-9',
      scientificName: 'Paracetamol',
      manufacturerNo: 'M-7',
      vendorNo: 'VEN-000001',
      location: 'A-12',
      cartonQty: 24,
      maxLevel: 500,
      isActive: false,
      controlledStatus: 'prescription',
    });
    const expected: Partial<Item> = {
      ...source,
      gtin: undefined,
      barcodes: ['06281007320014', '6281007000011'],
    };
    delete expected.id;
    expect(formToItemInput(itemToForm(source))).toEqual(expected);
  });

  it('turns blank optional text into undefined instead of empty strings', () => {
    const input = formToItemInput(form());
    expect(input.gtin).toBeUndefined();
    expect(input.location).toBeUndefined();
    expect(input.maxLevel).toBeUndefined();
    expect(input.cartonQty).toBeUndefined();
    expect(input.isActive).toBe(true);
  });

  it('defaults an item to having an expiry date and stores only the opt-out', () => {
    // Items that predate the flag, and every new item, track expiry unless the owner says otherwise.
    expect(itemTracksExpiry(item())).toBe(true);
    expect(itemToForm(item()).hasExpiry).toBe(true);
    expect(formToItemInput(form()).hasExpiry).toBeUndefined();

    const noExpiry = formToItemInput(form({ hasExpiry: false }));
    expect(noExpiry.hasExpiry).toBe(false);
    expect(itemTracksExpiry({ hasExpiry: noExpiry.hasExpiry })).toBe(false);
    // A saved no-expiry item keeps the switch off when it is opened for editing again.
    expect(itemToForm({ ...item(), hasExpiry: false }).hasExpiry).toBe(false);
  });
});

describe('item category master link', () => {
  it('writes CategoryID and the canonical CategoryNameEn into the item', () => {
    const saved = formToItemInput(form({ category: 'Ignored text', categoryId: '8' }));
    expect(saved.categoryId).toBe(8);
    expect(saved.category).toBe('Vitamins & Supplements');
  });

  it('resolves an old free-text label when the item has no stored CategoryID', () => {
    const values = itemToForm(item({ category: 'Medicines' }));
    expect(values.categoryId).toBe('1');
    expect(formToItemInput(values).category).toBe('Medicines');
  });

  it('keeps free text when no master category is linked', () => {
    const saved = formToItemInput(form({ category: 'Analgesics', categoryId: '' }));
    expect(saved.categoryId).toBeUndefined();
    expect(saved.category).toBe('Analgesics');
  });
});

describe('item Wasfaty mapping', () => {
  it('round-trips a NUPCO code, approved price and eligibility', () => {
    const source = item({
      nupcoCode: '6281007320014',
      wasfatyPrice: 4.25,
      wasfatyEligible: true,
    });
    const values = itemToForm(source);
    expect(values.nupcoCode).toBe('6281007320014');
    expect(values.wasfatyPrice).toBe('4.25');
    expect(values.wasfatyEligible).toBe(true);
    expect(formToItemInput(values)).toMatchObject({
      nupcoCode: '6281007320014',
      wasfatyPrice: 4.25,
      wasfatyEligible: true,
    });
  });

  it('normalises spaces and rejects a non-13-digit code', () => {
    const spaced = form({ nupcoCode: '6281 0073 2001 4', wasfatyEligible: true });
    expect(formToItemInput(spaced).nupcoCode).toBe('6281007320014');

    const errors = validateItemForm(form({ nupcoCode: '628100732', wasfatyEligible: true }), [item()]);
    expect(errors.nupcoCode).toContain('13 digits');
  });

  it('refuses a code already mapped to another item', () => {
    const other = item({ id: 'itm-2', nameEn: 'Omeprazole', nupcoCode: '6281007320069' });
    const errors = validateItemForm(
      form({ nupcoCode: '6281007320069', wasfatyEligible: true }),
      [item(), other],
    );
    expect(errors.nupcoCode).toContain('Omeprazole');
    // The item being edited may keep its own mapping.
    expect(
      validateItemForm(form({ nupcoCode: '6281007320069', wasfatyEligible: true }), [item(), other], 'itm-2'),
    ).toEqual({});
  });

  it('requires eligibility when a code is entered and validates the approved price', () => {
    expect(validateItemForm(form({ nupcoCode: '6281007320014' }), [item()]).wasfatyEligible).toBeDefined();
    expect(validateItemForm(form({ wasfatyPrice: '-1' }), [item()]).wasfatyPrice).toBeDefined();
  });

  it('saves blanks as undefined rather than empty strings', () => {
    const saved = formToItemInput(form());
    expect(saved.nupcoCode).toBeUndefined();
    expect(saved.wasfatyPrice).toBeUndefined();
    expect(saved.wasfatyEligible).toBeUndefined();
  });
});

describe('item validation', () => {
  it('accepts a complete valid form', () => {
    expect(validateItemForm(form(), [item()])).toEqual({});
  });

  it('requires an English name and barcode', () => {
    const errors = validateItemForm(form({ nameEn: '  ', barcode: '' }), [item()]);
    expect(errors.nameEn).toBeDefined();
    expect(errors.barcode).toBeDefined();
  });

  it('rejects a barcode already used by another item but allows the item being edited', () => {
    const errors = validateItemForm(form({ barcode: '6281007320014' }), [item()]);
    expect(errors.barcode).toContain('Paracetamol');

    expect(validateItemForm(form({ barcode: '6281007320014' }), [item()], 'itm-1')).toEqual({});
  });

  it('validates and de-duplicates extra barcodes', () => {
    expect(validateItemForm(form({ barcodes: ['12'] }), [item()]).barcodes).toBeDefined();
    expect(validateItemForm(form({ barcodes: ['6281007000011', '6281007000011'] }), [item()]).barcodes).toContain('twice');

    const other = item({ id: 'itm-2', barcode: '111', barcodes: ['6281007000011'] });
    expect(validateItemForm(form({ barcodes: ['6281007000011'] }), [item(), other]).barcodes).toContain('Paracetamol');

    // The item being edited may keep its own extra code.
    expect(validateItemForm(form({ barcodes: ['6281007000011'] }), [other], 'itm-2').barcodes).toBeUndefined();
  });

  it('rejects a negative price, a fractional reorder level and max below reorder', () => {
    expect(validateItemForm(form({ basePrice: '-1' }), [item()]).basePrice).toBeDefined();
    expect(validateItemForm(form({ reorderLevel: '2.5' }), [item()]).reorderLevel).toBeDefined();
    expect(validateItemForm(form({ reorderLevel: '50', maxLevel: '10' }), [item()]).maxLevel).toBeDefined();
  });

  it('rejects a carton quantity below one', () => {
    expect(validateItemForm(form({ cartonQty: '0' }), [item()]).cartonQty).toBeDefined();
  });

  it('duplicateIdentityErrors is case-insensitive on the barcode', () => {
    const other = item({ id: 'itm-2', barcode: 'ABC-123' });
    expect(duplicateIdentityErrors([other], 'abc-123', '').barcode).toBeDefined();
  });
});

describe('one item, many barcodes / GTINs', () => {
  it('lists the main code, a legacy GTIN and the extra codes once each', () => {
    expect(itemCodes({
      barcode: '6291234567890',
      gtin: '6291234567890', // same as the main code - must not be listed twice
      barcodes: ['6291234567891', ' 6291234567892 ', ''],
    })).toEqual(['6291234567890', '6291234567891', '6291234567892']);
  });

  it('finds an item by any of its codes, not just the main one', () => {
    const priceTag = item({ id: 'itm-2', barcode: '1111111111111', barcodes: ['2222222222222'] });
    expect(duplicateCodeOwner([item(), priceTag], '2222222222222')?.id).toBe('itm-2');
    expect(duplicateCodeOwner([item(), priceTag], '3333333333333')).toBeUndefined();
  });

  it('flags a clashing code as it is typed, naming the item that already owns it', () => {
    const other = item({ id: 'itm-2', itemNo: 1002, nameEn: 'Amoxicillin', barcode: '1111111111111', barcodes: ['2222222222222'] });
    expect(codeConflictMessage([item(), other], '2222222222222')).toContain('Amoxicillin');
    expect(codeConflictMessage([item(), other], '2222222222222')).toContain('1002');
    expect(codeConflictMessage([item(), other], '  ')).toBeUndefined();
    expect(codeConflictMessage([item(), other], '3333333333333')).toBeUndefined();
    // The item being edited may keep its own codes.
    expect(codeConflictMessage([other], '2222222222222', 'itm-2')).toBeUndefined();
  });

  it('rejects malformed codes before saving', () => {
    expect(isValidBarcode('6291234567890')).toBe(true);
    expect(isValidBarcode('AB-12_3.4')).toBe(true);
    expect(isValidBarcode('12')).toBe(false);
    expect(isValidBarcode('62 9123')).toBe(false);
  });
});

describe('item movement totals', () => {
  const batches: Batch[] = [
    { id: 'b1', itemId: 'itm-1', batchNo: 'A', expiryDate: '2027-01-01', receivedDate: '2026-01-01', qtyOnHand: 10, purchasePrice: 3, purchaseDiscountPercent: 0, costPrice: 3 },
    { id: 'b2', itemId: 'itm-1', batchNo: 'B', expiryDate: '2027-02-01', receivedDate: '2026-01-01', qtyOnHand: 5, purchasePrice: 4, purchaseDiscountPercent: 0, costPrice: 4 },
    { id: 'b3', itemId: 'itm-2', batchNo: 'C', expiryDate: '2027-03-01', receivedDate: '2026-01-01', qtyOnHand: 99, purchasePrice: 1, purchaseDiscountPercent: 0, costPrice: 1 },
  ];
  const log = [
    { itemId: 'itm-1', qty: 12, bonusQty: 2 },
    { itemId: 'itm-1', qty: 5 },
    { itemId: 'itm-2', qty: 99 },
  ];
  const sales = [
    { itemId: 'itm-1', qty: 4, returnedQty: 1 },
    { itemId: 'itm-2', qty: 9, returnedQty: 0 },
  ];

  it('derives balance, lifetime movements and stock values', () => {
    const totals = itemMovementTotals(item({ basePrice: 10 }), batches, log, sales);
    expect(totals.onHandQty).toBe(15);
    expect(totals.purchasedQty).toBe(17);
    expect(totals.bonusReceivedQty).toBe(2);
    expect(totals.soldQty).toBe(4);
    expect(totals.salesReturnQty).toBe(1);
    expect(totals.stockCostValue).toBe(50); // 10*3 + 5*4
    expect(totals.stockRetailValue).toBe(150); // 15*10
  });

  it('prefers a batch sale-price override over the item price', () => {
    const withOverride = batches.map((b) => (b.id === 'b1' ? { ...b, salePriceOverride: 20 } : b));
    // 10*20 + 5*10 = 250
    expect(itemMovementTotals(item({ basePrice: 10 }), withOverride, log, sales).stockRetailValue).toBe(250);
  });

  it('values packed stock by tablets-per-box, not tablet count x box price', () => {
    const pack = { cartonSize: 100, boxSize: 3, stripSize: 4 }; // 1 box = 12 tablets
    const packed = [{
      id: 'b1', itemId: 'itm-1', batchNo: 'A', expiryDate: '2027-01-01', receivedDate: '2026-01-01',
      qtyOnHand: 24, purchasePrice: 5, purchaseDiscountPercent: 0, costPrice: 5,
    }];
    // 24 tablets = 2 boxes @ 10 = 20.00, not 24 x 10 = 240.
    expect(itemMovementTotals(item({ basePrice: 10, pack }), packed, [], []).stockRetailValue).toBe(20);
    expect(itemMovementTotals(item({ basePrice: 10, pack }), packed, [], []).onHandQty).toBe(24);
  });
});

describe('pack ladder on the item form', () => {
  const pack = { cartonSize: 100, boxSize: 3, stripSize: 4 };

  it('round-trips a ladder through the form', () => {
    const source = item({ pack });
    expect(formToItemInput(itemToForm(source)).pack).toEqual(pack);
  });

  it('treats three blank rows as "no ladder", keeping old items unchanged', () => {
    expect(formToItemInput(itemToForm(item())).pack).toBeUndefined();
    expect(formToItemInput(form()).pack).toBeUndefined();
  });

  it('rejects a half-filled or non-positive ladder', () => {
    expect(validateItemForm(form({ packBox: '3' }), [item()]).packStrip).toBeDefined();
    expect(validateItemForm(form({ packCarton: '100', packBox: '0', packStrip: '4' }), [item()]).packBox).toBeDefined();
    expect(validateItemForm(form({ packCarton: '100', packBox: '3', packStrip: '4' }), [item()])).toEqual({});
    // Carton alone is not a ladder - it needs strips per box and tablets per strip.
    expect(validateItemForm(form({ packCarton: '10' }), [item()]).packBox).toBeDefined();
  });

  it('allows a ladder that stops at the box (no carton level)', () => {
    const values = form({ packBox: '2', packStrip: '10' });
    expect(validateItemForm(values, [item()])).toEqual({});
    expect(formToItemInput(values).pack).toEqual({ cartonSize: 1, boxSize: 2, stripSize: 10 });
    // A stored no-carton ladder reloads with the carton row blank, not as "1 box per carton".
    expect(itemToForm(item({ pack: { cartonSize: 1, boxSize: 2, stripSize: 10 } })).packCarton).toBe('');
  });

  it('suggests the old unit as the conversion source when an unpacked item gets a ladder', () => {
    // Paracetamol is stocked in strips; giving it a ladder must convert 138 strips -> 2,760 tablets,
    // so the form opens with "Strip" preselected rather than silently counting them as tablets.
    expect(itemToForm(item({ unit: 'Strip' })).stockUnit).toBe('strip');
    expect(itemToForm(item({ unit: 'Boxes' })).stockUnit).toBe('box');
    expect(itemToForm(item({ unit: 'Tablet' })).stockUnit).toBe('tablet');
    expect(itemToForm(item({ unit: 'Bottle' })).stockUnit).toBe('');
    // Already-packed items are counted in tablets - there is nothing left to convert.
    expect(itemToForm(item({ unit: 'Strip', pack })).stockUnit).toBe('');
    // The helper is not persisted (it only drives the one-off conversion).
    expect(formToItemInput(itemToForm(item({ unit: 'Strip' })))).not.toHaveProperty('stockUnit');
  });
});
