// Unit tests for the ZATCA Phase 2 sales-invoice helpers (utils/zatcaInvoice.ts).
//
// These are the rules that must not drift between checkout and a later resubmission: which tender
// is reported, what exactly is sent for a saved sale, and which stored status follows which server
// answer. A wrong mapping here would either misreport a legal document or silently mark an
// unsubmitted invoice as compliant, so each case pins an exact value rather than a shape.
import { describe, expect, it } from 'vitest';

import type { Payment, SaleHeader, SaleLine } from '../types/sales';
import {
  buildSubmitRequest,
  needsResubmission,
  primaryPaymentMethod,
  shortUuid,
  statusFromSubmission,
  zatcaPatchFromSubmission,
  zatcaSummary,
} from './zatcaInvoice';

function line(overrides: Partial<SaleLine> = {}): SaleLine {
  return {
    id: 'l1',
    itemId: 'itm-1',
    itemNameAr: 'باراسيتامول',
    itemNameEn: 'Paracetamol 500mg',
    batchId: 'b1',
    batchNo: 'PC24A17',
    expiryDate: '2027-12-05',
    qty: 2,
    unitPrice: 4.5,
    vatRate: 0,
    discountAmount: 0,
    netExclVat: 9,
    vatAmount: 0,
    totalInclVat: 9,
    returnedQty: 0,
    ...overrides,
  };
}

function invoice(overrides: Partial<SaleHeader> = {}): SaleHeader {
  return {
    id: 'inv-1',
    invoiceNo: 'SIM-000001',
    invoiceType: 'simplified',
    date: '2026-11-01T10:00:00.000Z',
    lines: [line()],
    subtotalExclVat: 9,
    totalDiscount: 0,
    totalVatAmount: 0,
    totalInclVat: 9,
    payments: [{ method: 'cash', amount: 9 }],
    zatcaQrBase64: 'qr',
    zatcaStatus: 'pending_submission',
    status: 'completed',
    cashierName: 'Administrator',
    ...overrides,
  };
}

function payment(overrides: Partial<Payment> = {}): Payment {
  return { method: 'cash', amount: 10, ...overrides };
}

describe('primaryPaymentMethod', () => {
  it('reports the largest non-points tender on a split sale', () => {
    expect(primaryPaymentMethod([
      payment({ method: 'points', amount: 30 }),
      payment({ method: 'card', amount: 20 }),
      payment({ method: 'cash', amount: 15 }),
    ])).toBe('card');
  });

  it('treats a points-only sale as cash - ZATCA has no points tender', () => {
    expect(primaryPaymentMethod([payment({ method: 'points', amount: 40 })])).toBe('cash');
  });

  it('never reports points even when they dominate the sale', () => {
    expect(primaryPaymentMethod([
      payment({ method: 'points', amount: 90 }),
      payment({ method: 'insurance', amount: 10 }),
    ])).toBe('insurance');
  });
});

describe('buildSubmitRequest', () => {
  it('sends the stored line economics unchanged', () => {
    const req = buildSubmitRequest(invoice({
      lines: [line({ qty: 3, unitPrice: 7.25, discountAmount: 1.5, vatRate: 0.15 })],
    }));
    expect(req.lines).toEqual([{
      id: 'l1',
      itemNameEn: 'Paracetamol 500mg',
      qty: 3,
      unitPrice: 7.25,
      vatRate: 0.15,
      discountAmount: 1.5,
    }]);
    expect(req.invoiceNo).toBe('SIM-000001');
    expect(req.invoiceType).toBe('simplified');
  });

  it('keeps the buyer VAT number on a standard invoice and drops it on a simplified one', () => {
    expect(buildSubmitRequest(invoice({ invoiceType: 'standard', customerVatNumber: '300012345600003' }))
      .customerVatNumber).toBe('300012345600003');
    // A walk-in sale carries no buyer VAT at all - never an empty string, which ZATCA reads as a
    // present-but-blank registration number.
    expect(buildSubmitRequest(invoice({ customerVatNumber: '' })).customerVatNumber).toBeUndefined();
  });

  it('falls back through the customer name fields and finally to Walk-in Customer', () => {
    expect(buildSubmitRequest(invoice({ customerNameEn: 'Acme Co' })).customerName).toBe('Acme Co');
    expect(buildSubmitRequest(invoice({ customerNameAr: 'شركة' })).customerName).toBe('شركة');
    expect(buildSubmitRequest(invoice()).customerName).toBe('Walk-in Customer');
  });
});

describe('statusFromSubmission', () => {
  it('maps cleared/reported onto the matching stored status', () => {
    expect(statusFromSubmission({ status: 'cleared' }, 'standard')).toBe('phase2_cleared');
    expect(statusFromSubmission({ status: 'reported' }, 'simplified')).toBe('phase2_reported');
  });

  it('maps accepted_with_warnings by the DOCUMENT type, not the answer wording', () => {
    expect(statusFromSubmission({ status: 'accepted_with_warnings' }, 'standard')).toBe('phase2_cleared');
    expect(statusFromSubmission({ status: 'accepted_with_warnings' }, 'simplified')).toBe('phase2_reported');
  });

  it('treats failed as a rejection', () => {
    expect(statusFromSubmission({ status: 'failed' }, 'simplified')).toBe('submission_failed');
  });
});

describe('zatcaPatchFromSubmission', () => {
  it('stores the full Phase 2 evidence on acceptance', () => {
    const patch = zatcaPatchFromSubmission({
      status: 'cleared',
      qrBase64: 'stamped-qr',
      invoiceHashBase64: 'hash==',
      uuid: '8b6c-uuid',
      icv: 12,
      environment: 'simulation',
    }, 'standard', '2026-11-01T10:05:00.000Z');

    expect(patch).toMatchObject({
      zatcaStatus: 'phase2_cleared',
      zatcaQrBase64: 'stamped-qr',
      zatcaInvoiceHashBase64: 'hash==',
      zatcaUuid: '8b6c-uuid',
      zatcaIcv: 12,
      zatcaEnvironment: 'simulation',
      zatcaSubmittedAt: '2026-11-01T10:05:00.000Z',
      zatcaFailureReason: undefined,
    });
  });

  it('never overwrites the QR or claims a submission time on rejection', () => {
    const patch = zatcaPatchFromSubmission(
      { status: 'failed', uuid: 'u2', icv: 13 },
      'simplified',
      '2026-11-01T10:05:00.000Z',
    );
    expect(patch.zatcaStatus).toBe('submission_failed');
    expect(patch.zatcaQrBase64).toBeUndefined();
    expect(patch.zatcaSubmittedAt).toBeUndefined();
    expect(patch.zatcaFailureReason).toBeTruthy();
  });
});

describe('needsResubmission', () => {
  it('covers never-tried, attempted-and-not-accepted and rejected invoices', () => {
    expect(needsResubmission({ zatcaStatus: 'phase1_fallback' })).toBe(true);
    expect(needsResubmission({ zatcaStatus: 'pending_submission' })).toBe(true);
    expect(needsResubmission({ zatcaStatus: 'submission_failed' })).toBe(true);
  });

  it('leaves accepted invoices alone', () => {
    expect(needsResubmission({ zatcaStatus: 'phase2_cleared' })).toBe(false);
    expect(needsResubmission({ zatcaStatus: 'phase2_reported' })).toBe(false);
  });
});

describe('zatcaSummary', () => {
  it('counts documents per state, not money', () => {
    const summary = zatcaSummary([
      { zatcaStatus: 'phase2_cleared' },
      { zatcaStatus: 'phase2_reported' },
      { zatcaStatus: 'phase1_fallback' },
      { zatcaStatus: 'pending_submission' },
      { zatcaStatus: 'submission_failed' },
    ]);
    expect(summary).toEqual({
      total: 5, cleared: 1, reported: 1, needsSubmission: 2, failed: 1,
    });
  });
});

describe('shortUuid', () => {
  it('keeps short values intact and abbreviates long ones without hiding the tail', () => {
    expect(shortUuid(undefined)).toBe('—');
    expect(shortUuid('short')).toBe('short');
    expect(shortUuid('12345678-1234-1234-1234-123456789abc')).toBe('12345678…9abc');
  });
});
