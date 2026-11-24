// The pure half of the RSD outbox. These tests pin the two rules that decide WHAT is reported:
// drugs only (Item Master batch/expiry tracking on at sale time) and full-return-only cancellations,
// plus the per-unit identity that stops a pack being queued twice.
import { describe, expect, it } from 'vitest';
import type { SaleHeader, SaleLine } from '../types/sales';
import type { DrugSerial } from '../types/serial';
import {
  buildCancelOutboxItems,
  buildSaleOutboxItems,
  rsdInvoiceSummary,
  rsdOutboxKey,
  rsdQueueSummary,
  type RsdOutboxItem,
} from './rsdOutbox';

function line(overrides: Partial<SaleLine> = {}): SaleLine {
  return {
    id: 'line-1',
    itemId: 'itm-1',
    itemNameAr: 'دواء',
    itemNameEn: 'Drug',
    batchId: 'bat-1',
    batchNo: 'AX24C09',
    expiryDate: '2027-03-01',
    qty: 1,
    unitPrice: 10,
    vatRate: 0,
    discountAmount: 0,
    netExclVat: 10,
    vatAmount: 0,
    totalInclVat: 10,
    returnedQty: 0,
    ...overrides,
  };
}

function serial(n: string, overrides: Partial<DrugSerial> = {}): DrugSerial {
  return {
    gtin: '06281007320021',
    serialNo: n,
    batchNo: 'AX24C09',
    expiryDate: '2027-03-01',
    ...overrides,
  };
}

function invoice(lines: SaleLine[]): SaleHeader {
  return {
    id: 'sale-1',
    invoiceNo: 'SIM-000001',
    invoiceType: 'simplified',
    date: '2026-11-23T10:00:00.000Z',
    lines,
    subtotalExclVat: 10,
    totalDiscount: 0,
    totalVatAmount: 0,
    totalInclVat: 10,
    payments: [{ method: 'cash', amount: 10 }],
    zatcaQrBase64: '',
    zatcaStatus: 'phase2_reported',
    status: 'completed',
    cashierName: 'admin',
  };
}

function item(overrides: Partial<RsdOutboxItem> = {}): RsdOutboxItem {
  return {
    id: 'out-1',
    kind: 'sale',
    unit: { gtin: '06281007320021', serialNo: 'SN1', batchNo: 'AX24C09', expiryDate: '2027-03-01' },
    invoiceId: 'sale-1',
    invoiceNo: 'SIM-000001',
    saleLineId: 'line-1',
    createdAt: '2026-11-23T10:00:00.000Z',
    updatedAt: '2026-11-23T10:00:00.000Z',
    status: 'pending',
    attempts: 0,
    ...overrides,
  };
}

describe('RSD outbox builders', () => {
  it('queues one sale per serialised drug pack and skips everything else', () => {
    const invoiceUnderTest = invoice([
      line({ id: 'drug', requiresBatchTracking: true, serials: [serial('SN1'), serial('SN2')] }),
      line({ id: 'supply', requiresBatchTracking: false, serials: [serial('SN3')] }),
      line({ id: 'no-serial', requiresBatchTracking: true }),
    ]);

    const items = buildSaleOutboxItems(invoiceUnderTest);

    expect(items.map((entry) => [entry.kind, entry.saleLineId, entry.unit.serialNo])).toEqual([
      ['sale', 'drug', 'SN1'],
      ['sale', 'drug', 'SN2'],
    ]);
    expect(items.every((entry) => entry.invoiceNo === 'SIM-000001')).toBe(true);
  });

  it('cancels only lines this return took all the way back', () => {
    const invoiceUnderTest = invoice([
      line({ id: 'full', requiresBatchTracking: true, qty: 1, returnedQty: 1, serials: [serial('SN1')] }),
      line({ id: 'partial', requiresBatchTracking: true, qty: 2, returnedQty: 1, serials: [serial('SN2'), serial('SN3')] }),
      line({ id: 'untouched', requiresBatchTracking: true, qty: 1, returnedQty: 1, serials: [serial('SN4')] }),
    ]);

    const items = buildCancelOutboxItems(invoiceUnderTest, ['full', 'partial'], 'customer changed mind');

    expect(items.map((entry) => [entry.kind, entry.saleLineId, entry.unit.serialNo])).toEqual([
      ['cancel', 'full', 'SN1'],
    ]);
    expect(items[0].reason).toBe('customer changed mind');
  });

  it('treats a sale and a cancel of the same pack as two different movements', () => {
    const base = { unit: item().unit };
    expect(rsdOutboxKey({ kind: 'sale', ...base })).not.toBe(rsdOutboxKey({ kind: 'cancel', ...base }));
  });
});

describe('RSD summaries', () => {
  it('says an invoice with no queued units is not reportable (no drug, or no serial)', () => {
    expect(rsdInvoiceSummary([])).toEqual({ total: 0, sent: 0, pending: 0, rejected: 0, state: 'none' });
  });

  it('is only "sent" when every unit on the invoice was accepted', () => {
    expect(rsdInvoiceSummary([item({ status: 'sent' }), item({ id: 'out-2', status: 'sent' })])).toMatchObject({
      total: 2,
      sent: 2,
      state: 'sent',
    });
    expect(rsdInvoiceSummary([item({ status: 'sent' }), item({ id: 'out-2', status: 'pending' })])).toMatchObject({
      sent: 1,
      pending: 1,
      state: 'queued',
    });
  });

  it('treats a blocked cancel as needing attention, not as queued', () => {
    const summary = rsdInvoiceSummary([
      item({ status: 'sent' }),
      item({ id: 'out-2', kind: 'cancel', status: 'blocked' }),
    ]);
    expect(summary.state).toBe('rejected');
    expect(summary.rejected).toBe(1);
  });

  it('counts the whole queue by status', () => {
    expect(
      rsdQueueSummary([
        item({ status: 'pending' }),
        item({ id: 'b', status: 'sent' }),
        item({ id: 'c', status: 'rejected' }),
        item({ id: 'd', status: 'blocked' }),
      ]),
    ).toEqual({ total: 4, pending: 1, sent: 1, rejected: 1, blocked: 1 });
  });
});
