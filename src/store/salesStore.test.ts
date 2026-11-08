// The post-payment directions step writes onto an already-recorded sale. These tests pin the two
// things that must stay true: only the line's `dosage` annotation changes (never money, status or
// ZATCA evidence), and clearing a direction is applied just like setting one.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaleHeader, SaleLine } from '../types/sales';
import { seedDosages } from '../utils/seedData';
import { snapshotDosage } from '../utils/dosages';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
  key: () => null,
  length: 0,
});

type SalesModule = typeof import('./salesStore');

let sales: SalesModule['useSalesStore'];

beforeAll(async () => {
  sales = (await import('./salesStore')).useSalesStore;
});

function line(id: string, overrides: Partial<SaleLine> = {}): SaleLine {
  return {
    id,
    itemId: 'itm-1',
    itemNameAr: 'باراسيتامول 500 مجم',
    itemNameEn: 'Paracetamol 500mg (20 tabs)',
    batchId: 'bat-1a',
    batchNo: 'PC23F01',
    expiryDate: '2026-12-10',
    qty: 1,
    unit: 'Strip',
    unitPrice: 4.5,
    vatRate: 0,
    discountAmount: 0,
    netExclVat: 4.5,
    vatAmount: 0,
    totalInclVat: 4.5,
    returnedQty: 0,
    ...overrides,
  };
}

function sale(): SaleHeader {
  return {
    id: 'sale-1',
    invoiceNo: 'SIM-000001',
    invoiceType: 'simplified',
    date: '2026-11-05T10:00:00.000Z',
    customerNameAr: 'عميل نقدي',
    customerNameEn: 'Walk-In Customer',
    lines: [line('line-1'), line('line-2', { itemId: 'itm-2', itemNameEn: 'Amoxicillin Syrup' })],
    subtotalExclVat: 9,
    totalDiscount: 0,
    totalVatAmount: 0,
    totalInclVat: 9,
    payments: [{ method: 'cash', amount: 9 }],
    zatcaQrBase64: '',
    zatcaStatus: 'phase2_reported',
    status: 'completed',
    cashierName: 'admin',
    costCenterId: 'cc-main',
  };
}

beforeEach(() => {
  sales.setState({ invoices: [sale()], returns: [], simplifiedCounter: 1, standardCounter: 0 });
});

describe('sales dosage update after payment', () => {
  it('sets directions on one line without touching the other line or the document', () => {
    const before = sales.getState().invoices[0];
    const snap = snapshotDosage(seedDosages[0]);

    sales.getState().updateInvoiceDosages('sale-1', [{ lineId: 'line-1', dosage: snap }]);

    const after = sales.getState().invoices[0];
    expect(after.lines[0].dosage).toEqual(snap);
    expect(after.lines[1].dosage).toBeUndefined();
    expect(after.lines[0].totalInclVat).toBe(before.lines[0].totalInclVat);
    expect(after.totalInclVat).toBe(before.totalInclVat);
    expect(after.zatcaStatus).toBe('phase2_reported');
    expect(after.payments).toEqual(before.payments);
    expect(after.status).toBe('completed');
  });

  it('clears a direction again, because the step is optional and reversible', () => {
    sales.getState().updateInvoiceDosages('sale-1', [
      { lineId: 'line-1', dosage: snapshotDosage(seedDosages[0]) },
    ]);
    sales.getState().updateInvoiceDosages('sale-1', [{ lineId: 'line-1', dosage: undefined }]);
    expect(sales.getState().invoices[0].lines[0].dosage).toBeUndefined();
  });

  it('leaves the sale untouched when the invoice or line id does not exist', () => {
    const before = sales.getState().invoices[0];
    sales.getState().updateInvoiceDosages('missing-sale', [
      { lineId: 'line-1', dosage: snapshotDosage(seedDosages[0]) },
    ]);
    sales.getState().updateInvoiceDosages('sale-1', [
      { lineId: 'missing-line', dosage: snapshotDosage(seedDosages[0]) },
    ]);
    expect(sales.getState().invoices[0]).toEqual(before);
  });
});
