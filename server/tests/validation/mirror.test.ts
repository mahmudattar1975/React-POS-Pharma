// Regression tests for the HIGH data-integrity findings (SEC-03/04/05). These pin the boundary
// rules before a malformed SQL mirror request can touch stock, totals or another branch's sale.
import { describe, expect, it } from 'vitest';
import { validateReceiving, validateReversal } from '../../src/validation/receiving.js';
import { validateReturnInput, validateSaleInput } from '../../src/validation/sales.js';

function sale(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sale-1',
    invoiceNo: 'RIY-SIM-000001',
    invoiceType: 'simplified',
    date: new Date('2026-11-27T10:00:00Z').toISOString(),
    lines: [{
      id: 'line-1',
      itemId: 'itm-1',
      itemNameAr: '',
      itemNameEn: 'Paracetamol',
      batchId: 'bat-1',
      batchNo: 'B1',
      expiryDate: '2027-01-01',
      qty: 2,
      unitPrice: 50,
      vatRate: 0.15,
      discountAmount: 0,
      netExclVat: 100,
      vatAmount: 15,
      totalInclVat: 115,
      returnedQty: 0,
    }],
    subtotalExclVat: 100,
    totalDiscount: 0,
    totalVatAmount: 15,
    totalInclVat: 115,
    payments: [{ method: 'cash', amount: 115 }],
    zatcaQrBase64: 'base64',
    zatcaStatus: 'phase1_fallback',
    status: 'completed',
    cashierName: 'forged-cashier',
    ...overrides,
  };
}

function receiving(overrides: Record<string, unknown> = {}) {
  return {
    receivingId: 'rcv-1',
    batchId: 'bat-1',
    itemId: 'itm-1',
    itemNameAr: '',
    itemNameEn: 'Paracetamol',
    batchNo: 'B1',
    expiryDate: '2027-01-01',
    receivedDate: '2026-11-27',
    qty: 10,
    purchasePrice: 10,
    purchaseDiscountPercent: 0,
    costPrice: 10,
    ...overrides,
  };
}

describe('sale mirror validation (SEC-04)', () => {
  it('accepts a consistent sale and derives the cashier from the verified token', () => {
    const parsed = validateSaleInput(sale(), 'Amal Saleh');
    expect(parsed.cashierName).toBe('Amal Saleh');
    expect(parsed.status).toBe('completed');
    expect(parsed.lines[0].netExclVat).toBe(100);
  });

  it('rejects non-positive or fractional quantities before any stock write', () => {
    expect(() => validateSaleInput(sale({ lines: [{ ...sale().lines[0], qty: -1 }] }), 'Cashier')).toThrow(/qty/i);
    expect(() => validateSaleInput(sale({ lines: [{ ...sale().lines[0], qty: 1.5 }] }), 'Cashier')).toThrow(/qty/i);
  });

  it('rejects inconsistent line and header arithmetic', () => {
    expect(() => validateSaleInput(sale({ lines: [{ ...sale().lines[0], vatAmount: 999 }] }), 'Cashier')).toThrow(/vatAmount/i);
    expect(() => validateSaleInput(sale({ totalInclVat: 999 }), 'Cashier')).toThrow(/totalInclVat/i);
    expect(() => validateSaleInput(sale({ payments: [{ method: 'cash', amount: 1 }] }), 'Cashier')).toThrow(/payments/i);
  });

  it('normalizes the status to completed and rejects VAT rates outside a fraction', () => {
    expect(validateSaleInput(sale({ status: 'returned' }), 'Cashier').status).toBe('completed');
    expect(() => validateSaleInput(sale({ lines: [{ ...sale().lines[0], vatRate: 15 }] }), 'Cashier')).toThrow(/vatRate/i);
  });
});

describe('return mirror validation (SEC-03)', () => {
  const ret = {
    id: 'return-1',
    returnNo: 'RIY-CN-000001',
    date: new Date('2026-11-27T11:00:00Z').toISOString(),
    originalInvoiceId: 'sale-1',
    originalInvoiceNo: 'RIY-SIM-000001',
    lines: [{ saleLineId: 'line-1', itemNameEn: 'Paracetamol', qty: 1, refundAmount: 57.5 }],
    totalRefund: 57.5,
    reason: 'damaged',
    updatedInvoiceStatus: 'partially_returned',
  };

  it('accepts a consistent return', () => {
    expect(validateReturnInput(ret).lines[0].qty).toBe(1);
  });

  it('rejects a refund total that does not match its lines', () => {
    expect(() => validateReturnInput({ ...ret, totalRefund: 999 })).toThrow(/totalRefund/i);
  });

  it('rejects non-positive return quantities', () => {
    expect(() => validateReturnInput({ ...ret, lines: [{ ...ret.lines[0], qty: 0 }] })).toThrow(/qty/i);
  });
});

describe('receiving mirror validation (SEC-05)', () => {
  it('accepts a positive delivery and keeps the event id for idempotency', () => {
    expect(validateReceiving(receiving()).receivingId).toBe('rcv-1');
  });

  it('rejects negative, zero and non-numeric quantities', () => {
    for (const qty of [-5, 0, 'abc']) {
      expect(() => validateReceiving(receiving({ qty }))).toThrow(/qty/i);
    }
    expect(() => validateReversal({ itemId: 'itm-1', batchNo: 'B1', qty: -5 })).toThrow(/qty/i);
  });

  it('rejects a discount fraction above 1 and an invalid date', () => {
    expect(() => validateReceiving(receiving({ purchaseDiscountPercent: 2 }))).toThrow(/purchaseDiscountPercent/i);
    expect(() => validateReceiving(receiving({ receivedDate: 'not-a-date' }))).toThrow(/receivedDate/i);
  });
});
