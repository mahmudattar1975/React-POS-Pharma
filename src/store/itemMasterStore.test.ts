// Store-level tests for the Item Master CRUD actions. The dialog validates field-by-field, but the
// store is the last line of defence (it is also what any future import/API caller would hit), so
// the duplicate-barcode and stock-on-hand guards are exercised here directly.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Item } from '../types/catalog';
import { seedBatches, seedItems, seedOffers } from '../utils/seedData';

type CatalogModule = typeof import('./catalogStore');

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
  key: () => null,
  length: 0,
});

let catalog: CatalogModule['useCatalogStore'];

beforeAll(async () => {
  catalog = (await import('./catalogStore')).useCatalogStore;
});

beforeEach(() => {
  catalog.setState({ items: seedItems, batches: seedBatches, offers: seedOffers, receivingLog: [] });
});

const draft: Omit<Item, 'id' | 'itemNo'> = {
  barcode: '6281007329999',
  nameAr: 'صنف جديد',
  nameEn: 'New Test Item',
  unit: 'Box',
  category: 'Test',
  basePrice: 5,
  vatRate: 0.15,
  requiresBatchTracking: true,
  reorderLevel: 5,
};

describe('catalogStore item master CRUD', () => {
  it('adds an item with a generated id and the next local item number', () => {
    const created = catalog.getState().addItem(draft);
    expect(created.id).toMatch(/^itm-/);
    expect(created.itemNo).toBe(1011); // seeds are 1001-1010
    expect(catalog.getState().items).toHaveLength(seedItems.length + 1);
    expect(catalog.getState().itemById(created.id)?.nameEn).toBe('New Test Item');
  });

  it('rejects a duplicate barcode at the store, not only in the dialog', () => {
    expect(() => catalog.getState().addItem({ ...draft, barcode: '6281007320014' })).toThrow(/already used/i);
    expect(catalog.getState().items).toHaveLength(seedItems.length);
  });

  it('rejects a duplicate extra code, not only in the dialog', () => {
    catalog.getState().addItem({ ...draft, gtin: '06281007320014' });
    expect(() => catalog.getState().addItem({ ...draft, barcode: '111111', gtin: '06281007320014' })).toThrow(/already used/i);
  });

  it('updates every field except the identity/number', () => {
    const before = catalog.getState().itemById('itm-1')!;
    catalog.getState().updateItem('itm-1', {
      ...draft,
      barcode: before.barcode,
      nameEn: 'Paracetamol 500mg (renamed)',
      location: 'A-01',
      maxLevel: 400,
    });
    const after = catalog.getState().itemById('itm-1')!;
    expect(after.nameEn).toBe('Paracetamol 500mg (renamed)');
    expect(after.location).toBe('A-01');
    expect(after.maxLevel).toBe(400);
    expect(after.itemNo).toBe(before.itemNo);
  });

  it('allows an edit to keep its own barcode but not take another item’s', () => {
    const before = catalog.getState().itemById('itm-1')!;
    expect(() =>
      catalog.getState().updateItem('itm-1', { ...draft, barcode: before.barcode })
    ).not.toThrow();
    expect(() =>
      catalog.getState().updateItem('itm-1', { ...draft, barcode: '6281007320021' })
    ).toThrow(/already used/i);
  });

  it('toggles the discontinued flag', () => {
    catalog.getState().setItemActive('itm-1', false);
    expect(catalog.getState().itemById('itm-1')?.isActive).toBe(false);
    catalog.getState().setItemActive('itm-1', true);
    expect(catalog.getState().itemById('itm-1')?.isActive).toBe(true);
  });

  it('refuses to delete an item that still has stock on hand', () => {
    expect(() => catalog.getState().deleteItem('itm-1')).toThrow(/still on hand/i);
    expect(catalog.getState().itemById('itm-1')).toBeDefined();
    expect(catalog.getState().batches.some((b) => b.itemId === 'itm-1')).toBe(true);
  });

  it('deletes a zero-stock item together with its batches and offers', () => {
    const created = catalog.getState().addItem(draft);
    catalog.setState((s) => ({
      batches: [
        ...s.batches,
        { id: 'bat-zero', itemId: created.id, batchNo: 'Z', expiryDate: '2027-01-01', receivedDate: '2026-01-01', qtyOnHand: 0, purchasePrice: 1, purchaseDiscountPercent: 0, costPrice: 1 },
      ],
      offers: [
        ...s.offers,
        { id: 'off-test', itemId: created.id, type: 'percent', percent: 0.1, activeFrom: '2026-01-01', activeTo: '2027-01-01', label: 'Test' },
      ],
    }));

    catalog.getState().deleteItem(created.id);

    expect(catalog.getState().itemById(created.id)).toBeUndefined();
    expect(catalog.getState().batches.some((b) => b.itemId === created.id)).toBe(false);
    expect(catalog.getState().offers.some((o) => o.itemId === created.id)).toBe(false);
  });
});

describe('catalogStore convertStockToBase', () => {
  it('recounts every batch in tablets and divides the per-unit prices', () => {
    // Seeds: 120 strips (cost 2.80) + 18 strips (cost 2.60) = 138 strips.
    catalog.getState().convertStockToBase('itm-1', 20);

    const big = catalog.getState().batchById('bat-1a')!;
    const small = catalog.getState().batchById('bat-1b')!;
    expect(big.qtyOnHand).toBe(2400);
    expect(small.qtyOnHand).toBe(360);
    expect(big.purchasePrice).toBe(0.175); // 3.50 / 20
    expect(big.costPrice).toBe(0.14); // 2.80 / 20
    expect(small.costPrice).toBe(0.13); // 2.60 / 20
    // Stock value is unchanged: 138 strips worth 2.80/2.60 each.
    expect(big.qtyOnHand * big.costPrice + small.qtyOnHand * small.costPrice).toBeCloseTo(120 * 2.8 + 18 * 2.6, 6);
  });

  it('leaves other items alone', () => {
    catalog.getState().convertStockToBase('itm-1', 20);
    expect(catalog.getState().batchById('bat-10a')?.qtyOnHand).toBe(40);
  });

  it('scales a batch sale-price override from the old unit to the box price', () => {
    catalog.setState((s) => ({
      batches: s.batches.map((b) => (b.id === 'bat-1a' ? { ...b, salePriceOverride: 5 } : b)),
    }));
    // 5.00 per strip, 10 strips per box -> packed pricing must read 50.00 per box, not 5.00.
    catalog.getState().convertStockToBase('itm-1', 20, { cartonSize: 10, boxSize: 10, stripSize: 20 });
    expect(catalog.getState().batchById('bat-1a')?.salePriceOverride).toBe(50);
  });

  it('is a no-op for a factor of 1 or less', () => {
    const before = catalog.getState().batches;
    catalog.getState().convertStockToBase('itm-1', 1);
    catalog.getState().convertStockToBase('itm-1', 0);
    expect(catalog.getState().batches).toEqual(before);
  });
});
