// Store-level tests for the pack ladder's two money/stock edges: what the cart deducts at checkout
// (baseQty in tablets, not the selling-unit count) and what receiving puts on the shelf when a
// delivery arrives in cartons or boxes. Stores run together - the wiring is the thing under test.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Batch, Item } from '../types/catalog';

type CatalogModule = typeof import('./catalogStore');
type CartModule = typeof import('./cartStore');

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
  key: () => null,
  length: 0,
});
// Best-effort backups fire-and-forget to the companion server; keep them out of the test network.
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));

let catalog: CatalogModule['useCatalogStore'];
let cart: CartModule['useCartStore'];

const pack = { cartonSize: 100, boxSize: 3, stripSize: 4 }; // 1 box = 12 tablets

const packedItem: Item = {
  id: 'itm-pack',
  barcode: '629000000123',
  nameAr: 'دواء معبأ',
  nameEn: 'Packed Drug',
  unit: 'Box',
  category: 'medicine',
  basePrice: 10, // the BOX price, VAT-exclusive
  vatRate: 0,
  requiresBatchTracking: true,
  reorderLevel: 5,
  pack,
};

function packedBatch(qtyOnHand = 24): Batch {
  return {
    id: 'bat-pack',
    itemId: 'itm-pack',
    batchNo: 'P1',
    expiryDate: '2027-01-01',
    receivedDate: '2026-01-01',
    qtyOnHand,
    purchasePrice: 5,
    purchaseDiscountPercent: 0,
    costPrice: 5,
  };
}

beforeAll(async () => {
  catalog = (await import('./catalogStore')).useCatalogStore;
  cart = (await import('./cartStore')).useCartStore;
});

beforeEach(() => {
  catalog.setState({ items: [packedItem], batches: [packedBatch()], offers: [], receivingLog: [] });
  cart.getState().clear();
});

describe('cart pack levels', () => {
  it('adds a box at the box price and records the 12-tablet deduction', () => {
    cart.getState().addLineForBatch(packedItem, packedBatch(), 1, 'box');
    const [line] = cart.getState().lines;
    expect(line.packLevel).toBe('box');
    expect(line.unitPrice).toBe(10);
    expect(line.baseQty).toBe(12);
    expect(line.qtyAvailable).toBe(2); // 24 tablets on hand = 2 boxes
  });

  it('keeps a box line and a loose-tablet line of the same batch separate', () => {
    cart.getState().addLineForBatch(packedItem, packedBatch(), 1, 'box'); // 12 tablets
    cart.getState().addLineForBatch(packedItem, packedBatch(), 8, 'tablet'); // +8 = 20
    const lines = cart.getState().lines;
    expect(lines.map((l) => l.packLevel)).toEqual(['box', 'tablet']);
    expect(lines.reduce((sum, l) => sum + l.baseQty, 0)).toBe(20);
  });

  it('refuses to open a second level past the tablets the first line already claimed', () => {
    cart.getState().addLineForBatch(packedItem, packedBatch(), 2, 'box'); // all 24 tablets
    cart.getState().addLineForBatch(packedItem, packedBatch(), 4, 'tablet');
    expect(cart.getState().lines).toHaveLength(1);
  });

  it('converts quantity when the cashier switches unit', () => {
    cart.getState().addLineForBatch(packedItem, packedBatch(120), 1, 'box');
    const line = cart.getState().lines[0];
    cart.getState().setLinePackLevel(line.id, 'strip');
    let switched = cart.getState().lines[0];
    expect(switched.qty).toBe(3); // 1 box = 3 strips
    expect(switched.baseQty).toBe(12);
    expect(switched.unitPrice).toBeCloseTo(10 / 3, 6);

    cart.getState().setLinePackLevel(line.id, 'tablet');
    switched = cart.getState().lines[0];
    expect(switched.qty).toBe(12);
    expect(switched.baseQty).toBe(12);
    expect(switched.unitPrice).toBeCloseTo(10 / 12, 6);
  });

  it('caps a quantity change at what the shelf can still cover', () => {
    cart.getState().addLineForBatch(packedItem, packedBatch(24), 1, 'box');
    const line = cart.getState().lines[0];
    const result = cart.getState().updateQty(line.id, 5);
    expect(result.appliedQty).toBe(2); // 24 tablets = 2 boxes
    expect(cart.getState().lines[0].baseQty).toBe(24);
  });
});

describe('receiving a packed delivery', () => {
  it('turns a carton into tablets and divides the price accordingly', () => {
    catalog.getState().receiveStock({
      itemId: 'itm-pack',
      batchNo: 'C1',
      expiryDate: '2027-01-01',
      qty: 1,
      purchasePrice: 1000, // per carton
      purchaseDiscountPercent: 0,
      source: 'vendor',
      packLevel: 'carton',
    });
    const batch = catalog.getState().batches.find((b) => b.batchNo === 'C1')!;
    expect(batch.qtyOnHand).toBe(1200);
    expect(batch.costPrice).toBeCloseTo(1000 / 1200, 3);
    expect(catalog.getState().receivingLog.at(-1)!.qty).toBe(1200);
  });

  it('defaults to boxes when no level is named', () => {
    catalog.getState().receiveStock({
      itemId: 'itm-pack',
      batchNo: 'B9',
      expiryDate: '2027-01-01',
      qty: 2,
      purchasePrice: 60,
      purchaseDiscountPercent: 0,
      source: 'vendor',
    });
    const batch = catalog.getState().batches.find((b) => b.batchNo === 'B9')!;
    expect(batch.qtyOnHand).toBe(24);
    expect(batch.costPrice).toBe(5); // 60 per box / 12 tablets
  });

  it('leaves an unpacked item untouched by the conversion', () => {
    const plain: Item = { ...packedItem, id: 'itm-plain', barcode: '629000000999', pack: undefined };
    catalog.setState({ items: [plain], batches: [], offers: [], receivingLog: [] });
    catalog.getState().receiveStock({
      itemId: 'itm-plain',
      batchNo: 'X1',
      expiryDate: '2027-01-01',
      qty: 10,
      purchasePrice: 5,
      purchaseDiscountPercent: 0,
      source: 'vendor',
      packLevel: 'carton',
    });
    expect(catalog.getState().batches[0].qtyOnHand).toBe(10);
  });
});
