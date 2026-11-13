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
  purchasing.setState({ vendors: seedVendors, invoices: [], invoiceCounter: 0, returnCounter: 0 });
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

function returnInvoice(overrides: Partial<PurchaseInvoice['lines'][number]> = {}): PurchaseInvoice {
  return {
    ...invoice(overrides),
    id: 'ret-test-1',
    invoiceNo: 'RET-000001',
    vendorInvoiceNo: 'CN-1001',
    isReturn: true,
    originalInvoiceNo: 'V-1001',
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

  it('reverses the batch and the receiving log when a posted invoice is deleted', () => {
    purchasing.getState().receivePurchaseInvoice(invoice());
    expect(qtyOf('bat-1a')).toBe(127);

    purchasing.getState().deletePurchaseInvoice('pur-test-1');

    expect(qtyOf('bat-1a')).toBe(120);
    expect(catalog.getState().receivingLog).toHaveLength(0);
    expect(purchasing.getState().invoices).toHaveLength(0);
  });

  it('removes a batch the invoice itself created when it is deleted', () => {
    purchasing.getState().receivePurchaseInvoice(
      invoice({ batchNo: 'DELETE-ME', expiryDate: '2028-01-31', qty: 3, bonusQty: 0, totalQty: 3 })
    );
    const created = catalog.getState().batches.find((b) => b.batchNo === 'DELETE-ME')!;
    expect(created.qtyOnHand).toBe(3);

    purchasing.getState().deletePurchaseInvoice('pur-test-1');

    // The row stays (it may share its number with opening stock) but holds nothing.
    expect(catalog.getState().batches.find((b) => b.batchNo === 'DELETE-ME')?.qtyOnHand).toBe(0);
    expect(catalog.getState().receivingLog).toHaveLength(0);
  });

  it('refuses to delete when the delivery is no longer fully on hand', () => {
    purchasing.getState().receivePurchaseInvoice(invoice());
    catalog.getState().decrementBatch('bat-1a', 121); // 127 -> 6, fewer than the 7 received

    expect(() => purchasing.getState().deletePurchaseInvoice('pur-test-1')).toThrow(/already been sold/i);

    // Nothing moved: invoice, stock and log are all still as they were.
    expect(purchasing.getState().invoices).toHaveLength(1);
    expect(qtyOf('bat-1a')).toBe(6);
    expect(catalog.getState().receivingLog).toHaveLength(1);
  });

  it('reverses the old lines and posts the new ones when a posted invoice is modified', () => {
    purchasing.getState().receivePurchaseInvoice(invoice());
    const original = purchasing.getState().invoices[0];

    const corrected: PurchaseInvoice = {
      ...original,
      lines: [{ ...original.lines[0], qty: 10, totalQty: 10, bonusQty: 0 }],
    };
    purchasing.getState().updatePurchaseInvoice(original.id, corrected);

    // 120 baseline + 10 corrected units (the original 7 were reversed first).
    expect(qtyOf('bat-1a')).toBe(130);
    expect(purchasing.getState().invoices).toHaveLength(1);
    expect(purchasing.getState().invoices[0].lines[0].qty).toBe(10);
    expect(catalog.getState().receivingLog).toHaveLength(1);
    expect(catalog.getState().receivingLog[0].qty).toBe(10);
  });

  it('does not touch stock when only the header is corrected', () => {
    purchasing.getState().receivePurchaseInvoice(invoice());
    const original = purchasing.getState().invoices[0];

    purchasing.getState().updatePurchaseInvoice(original.id, { ...original, notes: 'Corrected note' });

    expect(qtyOf('bat-1a')).toBe(127);
    expect(catalog.getState().receivingLog).toHaveLength(1);
    expect(purchasing.getState().invoices[0].notes).toBe('Corrected note');
    // The system number is never rewritten by an edit.
    expect(purchasing.getState().invoices[0].invoiceNo).toBe('PUR-000001');
  });

  it('DECREASES stock by paid + bonus units when a purchase return is posted', () => {
    purchasing.getState().receivePurchaseInvoice(invoice());
    expect(qtyOf('bat-1a')).toBe(127);

    purchasing.getState().receiveReturnInvoice(returnInvoice());

    // 5 paid + 2 free goods go back to the supplier.
    expect(qtyOf('bat-1a')).toBe(120);
    expect(catalog.getState().receivingLog).toHaveLength(2);
    expect(catalog.getState().receivingLog[1]).toMatchObject({
      qty: -7,
      purchaseInvoiceNo: 'RET-000001',
      source: 'vendor',
    });
    expect(purchasing.getState().invoices).toHaveLength(2);
    expect(purchasing.getState().invoices[1]).toMatchObject({ isReturn: true, originalInvoiceNo: 'V-1001' });
  });

  it('refuses a return larger than the batch still holds and moves nothing', () => {
    purchasing.getState().receivePurchaseInvoice(invoice());
    catalog.getState().decrementBatch('bat-1a', 125); // 127 -> 2, fewer than the 7 being returned

    expect(() => purchasing.getState().receiveReturnInvoice(returnInvoice())).toThrow(/Only goods still in stock/i);

    // Nothing moved: stock, log and invoice history are all as they were.
    expect(qtyOf('bat-1a')).toBe(2);
    expect(catalog.getState().receivingLog).toHaveLength(1);
    expect(purchasing.getState().invoices).toHaveLength(1);
  });

  it('refuses a return for a batch that is not in stock', () => {
    expect(() =>
      purchasing.getState().receiveReturnInvoice(returnInvoice({ batchNo: 'GHOST-LOT' }))
    ).toThrow(/not in stock/i);

    expect(qtyOf('bat-1a')).toBe(120);
    expect(purchasing.getState().invoices).toHaveLength(0);
  });

  it('does not consume a PUR number when a return is posted', () => {
    purchasing.getState().receivePurchaseInvoice(invoice());
    expect(purchasing.getState().nextPurchaseNo()).toBe('PUR-000002');

    purchasing.getState().receiveReturnInvoice(returnInvoice());

    // Returns live on their own RET- sequence; the next purchase stays PUR-000002.
    expect(purchasing.getState().nextPurchaseNo()).toBe('PUR-000002');
    expect(purchasing.getState().nextReturnNo()).toBe('RET-000002');
  });

  it('numbers consecutive returns RET-000001, RET-000002', () => {
    purchasing.getState().receivePurchaseInvoice(invoice());
    purchasing.getState().receivePurchaseInvoice({
      ...invoice(),
      id: 'pur-test-2',
      invoiceNo: 'PUR-000002',
      vendorInvoiceNo: 'V-1002',
    });

    expect(purchasing.getState().nextReturnNo()).toBe('RET-000001');
    purchasing.getState().receiveReturnInvoice(returnInvoice());
    expect(purchasing.getState().nextReturnNo()).toBe('RET-000002');

    purchasing.getState().receiveReturnInvoice({
      ...returnInvoice(),
      id: 'ret-test-2',
      invoiceNo: purchasing.getState().nextReturnNo(),
      originalInvoiceNo: 'V-1002',
    });

    expect(purchasing.getState().invoices.filter((i) => i.isReturn).map((i) => i.invoiceNo)).toEqual([
      'RET-000001',
      'RET-000002',
    ]);
  });

  it('allows a partial return and caps later returns at what was purchased', () => {
    purchasing.getState().receivePurchaseInvoice(invoice()); // 5 paid + 2 bonus = 7 units
    expect(qtyOf('bat-1a')).toBe(127);

    // Panadol bought 5 paid + 2 bonus, but only 2 paid go back to the supplier now.
    purchasing.getState().receiveReturnInvoice(
      returnInvoice({ qty: 2, bonusQty: 0, totalQty: 2, bonusValue: 0, netExclVat: 7, totalInclVat: 7 })
    );
    expect(qtyOf('bat-1a')).toBe(125);
    expect(purchasing.getState().invoices[1].lines[0]).toMatchObject({ qty: 2, bonusQty: 0 });

    // The rest of the same purchase can still be returned later (3 paid + 2 bonus).
    purchasing.getState().receiveReturnInvoice({
      ...returnInvoice({ qty: 3, bonusQty: 2, totalQty: 5 }),
      id: 'ret-test-2',
      invoiceNo: 'RET-000002',
    });
    expect(qtyOf('bat-1a')).toBe(120);

    // Nothing is left on the original document. The shelf still has 120 units from the seed lot,
    // but that stock did not come from this invoice, so the return must be refused.
    expect(() =>
      purchasing.getState().receiveReturnInvoice({
        ...returnInvoice(),
        id: 'ret-test-3',
        invoiceNo: 'RET-000003',
      })
    ).toThrow(/still returnable/i);
    expect(qtyOf('bat-1a')).toBe(120);
    expect(purchasing.getState().invoices).toHaveLength(3); // purchase + two returns
  });
});
