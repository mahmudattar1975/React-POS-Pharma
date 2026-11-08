// Integration tests for the one stock rule the whole app depends on: receiving a purchase puts
// units ON the shelf and selling takes them OFF. Stores are exercised together (not mocked)
// because the wiring itself is the thing under test - purchasingStore.receivePurchaseInvoice
// must post through catalogStore.receiveStock, and POSPage/ReturnsPage call the same
// decrementBatch/incrementBatch actions these tests drive.
//
// zustand's persist middleware needs a storage at import time; vitest runs in Node with none, so a
// tiny in-memory localStorage is installed before the stores are imported dynamically.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PurchaseInvoice } from '../types/purchasing';
import { seedBatches, seedItems, seedVendors } from '../utils/seedData';

type CatalogModule = typeof import('./catalogStore');
type PurchasingModule = typeof import('./purchasingStore');

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
  key: () => null,
  length: 0,
});

// The best-effort backups fire-and-forget to the companion server; stub fetch so the tests never
// depend on it being up (and never leak a real network call from a unit test run).
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));

let catalog: CatalogModule['useCatalogStore'];
let purchasing: PurchasingModule['usePurchasingStore'];

beforeAll(async () => {
  catalog = (await import('./catalogStore')).useCatalogStore;
  purchasing = (await import('./purchasingStore')).usePurchasingStore;
});

beforeEach(() => {
  // Every test starts from the seed catalog, so expected quantities are constants (bat-1a = 120).
  catalog.setState({ items: seedItems, batches: seedBatches, receivingLog: [] });
  purchasing.setState({ vendors: seedVendors, invoices: [], invoiceCounter: 0 });
});

function invoice(overrides: Partial<PurchaseInvoice['lines'][number]> = {}): PurchaseInvoice {
  return {
    id: 'pur-test-1',
    invoiceNo: 'PUR-000001',
    vendorInvoiceNo: 'V-1001',
    vendorId: 'ven-1',
    vendorNo: 'VEN-000001',
    vendorNameAr: 'شركة الحياة لتوزيع الأدوية',
    vendorNameEn: 'Al-Hayat Drug Distribution Co.',
    date: '2026-10-31',
    receivedAt: '2026-10-31T10:00:00.000Z',
    receivedBy: 'tester',
    lines: [
      {
        id: 'line-1',
        itemId: 'itm-1',
        itemNameAr: 'باراسيتامول',
        itemNameEn: 'Paracetamol 500mg',
        unit: 'Strip',
        vatRate: 0,
        batchNo: 'PC24A17',
        expiryDate: '2027-12-05',
        qty: 5,
        bonusQty: 2,
        totalQty: 7,
        bonusValue: 7,
        unitPurchasePrice: 3.5,
        netExclVat: 17.5,
        vatAmount: 0,
        totalInclVat: 17.5,
        discount1Percent: 0,
        discount2Percent: 0,
        discount3Percent: 0,
        discount1Amount: 0,
        discount2Amount: 0,
        discount3Amount: 0,
        discountTotal: 0,
        purchaseDiscountPercent: 0,
        unitCostPrice: 3.5,
        ...overrides,
      },
    ],
    subtotalExclVat: 17.5,
    totalDiscount: 0,
    totalBonusValue: 0,
    netExclVat: 17.5,
    totalVatAmount: 0,
    totalInclVat: 17.5,
    vatByRate: [],
  };
}

const qtyOf = (batchId: string) =>
  catalog.getState().batches.find((b) => b.id === batchId)!.qtyOnHand;

describe('inventory movement', () => {
  it('INCREASES quantity when a purchase invoice is received (paid + bonus units)', () => {
    expect(qtyOf('bat-1a')).toBe(120); // seed baseline
    purchasing.getState().receivePurchaseInvoice(invoice());
    // 5 paid + 2 free goods = 7 physical units added to the existing lot.
    expect(qtyOf('bat-1a')).toBe(127);
    expect(catalog.getState().receivingLog).toHaveLength(1);
    expect(catalog.getState().receivingLog[0]).toMatchObject({
      qty: 7,
      bonusQty: 2,
      purchaseInvoiceNo: 'PUR-000001',
      source: 'vendor',
    });
    expect(purchasing.getState().invoices).toHaveLength(1);
  });

  it('creates a new batch for a lot number the shelf does not have yet', () => {
    purchasing.getState().receivePurchaseInvoice(
      invoice({ batchNo: 'NEW-LOT-9', expiryDate: '2028-01-31', qty: 3, bonusQty: 0, totalQty: 3 })
    );
    const created = catalog.getState().batches.find((b) => b.batchNo === 'NEW-LOT-9');
    expect(created?.qtyOnHand).toBe(3);
    expect(created?.itemId).toBe('itm-1');
  });

  it('gives two brand-new lots of the same item distinct batch ids', () => {
    // Regression guard: ids used to be keyed on Date.now() alone, so two new lots posted from the
    // same invoice could collide - and a sale would then decrement BOTH rows as if they were one.
    const twoLots = invoice({ batchNo: 'LOT-A', qty: 3, bonusQty: 0, totalQty: 3 });
    twoLots.lines.push({ ...twoLots.lines[0], id: 'line-2', batchNo: 'LOT-B', qty: 4, totalQty: 4 });
    purchasing.getState().receivePurchaseInvoice(twoLots);

    const lotA = catalog.getState().batches.find((b) => b.batchNo === 'LOT-A')!;
    const lotB = catalog.getState().batches.find((b) => b.batchNo === 'LOT-B')!;
    expect(lotA.id).not.toBe(lotB.id);
    expect(lotA.qtyOnHand).toBe(3);
    expect(lotB.qtyOnHand).toBe(4);

    // Selling from lot A must leave lot B untouched.
    catalog.getState().decrementBatch(lotA.id, 1);
    expect(qtyOf(lotA.id)).toBe(2);
    expect(qtyOf(lotB.id)).toBe(4);
  });

  it('DECREASES quantity when units are sold (the POS checkout path)', () => {
    // POSPage's checkout runs exactly this for every cart line.
    catalog.getState().decrementBatch('bat-1a', 3);
    expect(qtyOf('bat-1a')).toBe(117);
  });

  it('puts returned units back on the same batch (the Returns path)', () => {
    catalog.getState().decrementBatch('bat-1a', 4);
    expect(qtyOf('bat-1a')).toBe(116);
    // ReturnsPage calls incrementBatch with the returned quantity of the original sale line.
    catalog.getState().incrementBatch('bat-1a', 1);
    expect(qtyOf('bat-1a')).toBe(117);
  });

  it('never lets a sale drive stock below zero', () => {
    catalog.getState().decrementBatch('bat-1a', 9999);
    expect(qtyOf('bat-1a')).toBe(0);
    // A later purchase still tops up from zero correctly.
    catalog.getState().incrementBatch('bat-1a', 10);
    expect(qtyOf('bat-1a')).toBe(10);
  });

  it('keeps a full cycle balanced: +7 purchase, -3 sale, +1 return = +5', () => {
    purchasing.getState().receivePurchaseInvoice(invoice());
    catalog.getState().decrementBatch('bat-1a', 3);
    catalog.getState().incrementBatch('bat-1a', 1);
    expect(qtyOf('bat-1a')).toBe(125); // 120 + 7 - 3 + 1
  });
});
