import { randomUUID } from 'node:crypto';
import { loadState, recordInvoice } from '../store/secureStore.js';
import { loadIdentity, toUblSupplier } from '../store/identity.js';
import { archiveInvoice, findFailedSubmissionByInvoiceNo } from '../store/invoiceArchive.js';
import type { UblBillingReference, UblDocumentType, UblInvoiceInput, UblInvoiceLine } from '../ubl/types.js';
import { signInvoice } from './signInvoice.js';
import { submitInvoice as submitToZatca } from './client.js';
import { interpretSubmitResult } from './response.js';
import { withInvoiceChainLock } from './chain.js';

export interface SaleInvoiceLineDto {
  id: string;
  itemNameEn: string;
  qty: number;
  // UN/ECE Rec 20/21 unit the quantity is in. PCE (piece) remains the default so existing callers
  // that never send one keep the exact document they always produced; the POS sends XCT/XBX/SR/U2
  // when an item is sold by carton, box, strip or tablet.
  unitCode?: string;
  unitPrice: number;
  vatRate: number;
  discountAmount: number;
}

export interface SubmitSaleInvoiceRequest {
  invoiceNo: string;
  invoiceType: 'standard' | 'simplified';
  // Defaults to 'invoice'. A sales return sends 'credit_note' with a billing reference to the
  // original sale; the UBL builder then emits document type 381 instead of 388.
  documentType?: UblDocumentType;
  billingReference?: UblBillingReference;
  note?: string;
  date: string; // ISO
  customerName: string;
  customerVatNumber?: string;
  lines: SaleInvoiceLineDto[];
  paymentMethod: 'cash' | 'card' | 'insurance' | 'other';
}

export interface SubmitSaleInvoiceResult {
  status: 'cleared' | 'reported' | 'accepted_with_warnings' | 'failed';
  qrBase64: string;
  invoiceHashBase64: string;
  zatcaResponse: unknown;
  signedXmlBase64: string;
  // Structured reason from ZATCA's answer (warnings/errors/validation results). A `failed` status
  // must always carry this so the UI can show what to fix instead of "ZATCA rejected the document".
  reason?: string;
  clearedInvoiceXmlBase64?: string;
  // Identity of the document (see types/sales.ts on the frontend): UUID is per document, ICV is the
  // strictly increasing per-device counter. Both are needed to reprint, audit or resubmit.
  uuid: string;
  icv: number;
  environment: 'sandbox' | 'simulation' | 'production';
}

function toUblLines(lines: SaleInvoiceLineDto[]): UblInvoiceLine[] {
  return lines.map((l) => ({
    id: l.id,
    itemNameEn: l.itemNameEn,
    qty: l.qty,
    unitCode: l.unitCode || 'PCE',
    unitPrice: l.unitPrice,
    vatRate: l.vatRate,
    lineDiscountAmount: l.discountAmount,
  }));
}

// The HTTP route receives untrusted JSON. Casting it straight to the request type let a malformed
// body reach `new Date(undefined)` or build an empty invoice, producing a 500 instead of a useful
// 400. This is intentionally a small, explicit validator rather than a schema framework.
export function validateSubmissionRequest(body: unknown): { ok: true; value: SubmitSaleInvoiceRequest } | { ok: false; errors: string[] } {
  const value = (body ?? {}) as Partial<SubmitSaleInvoiceRequest>;
  const errors: string[] = [];

  if (typeof value.invoiceNo !== 'string' || !value.invoiceNo.trim()) errors.push('invoiceNo is required.');
  if (value.invoiceType !== 'standard' && value.invoiceType !== 'simplified') errors.push('invoiceType must be standard or simplified.');
  if (typeof value.date !== 'string' || Number.isNaN(Date.parse(value.date))) errors.push('date must be an ISO date/time.');
  if (typeof value.customerName !== 'string' || !value.customerName.trim()) errors.push('customerName is required.');
  if (value.invoiceType === 'standard' && !/^3\d{13}3$/.test(value.customerVatNumber ?? '')) {
    errors.push('customerVatNumber (15 digits, starting and ending with 3) is required on a standard invoice.');
  }
  if (!['cash', 'card', 'insurance', 'other'].includes(value.paymentMethod ?? '')) {
    errors.push('paymentMethod must be cash, card, insurance or other.');
  }
  if (!Array.isArray(value.lines) || value.lines.length === 0) {
    errors.push('lines must be a non-empty array.');
  } else {
    value.lines.forEach((line, index) => {
      if (!line || typeof line.itemNameEn !== 'string' || !line.itemNameEn.trim()) errors.push(`lines[${index}].itemNameEn is required.`);
      for (const key of ['qty', 'unitPrice', 'vatRate', 'discountAmount'] as const) {
        if (typeof line?.[key] !== 'number' || !Number.isFinite(line[key]) || line[key] < 0) {
          errors.push(`lines[${index}].${key} must be a non-negative number.`);
        }
      }
    });
  }
  const docType = value.documentType ?? 'invoice';
  if (!['invoice', 'credit_note', 'debit_note'].includes(docType)) {
    errors.push('documentType must be invoice, credit_note or debit_note.');
  }
  if (docType !== 'invoice' && (!value.billingReference || !value.billingReference.id)) {
    errors.push('billingReference.id is required on a credit or debit note.');
  }
  if (docType !== 'invoice' && typeof value.note !== 'string') {
    errors.push('note (the reason for the credit/debit note) is required.');
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { ...value, documentType: docType } as SubmitSaleInvoiceRequest };
}

export async function submitSaleInvoice(req: SubmitSaleInvoiceRequest): Promise<SubmitSaleInvoiceResult> {
  // ICV/PIH form a chain: signing and recording cannot be interleaved with another submission or
  // two invoices would carry the same counter. The lock is process-local, which is correct for this
  // single-process dev server; a multi-instance deployment must move it into the database.
  return withInvoiceChainLock(async () => {
    const state = await loadState();
    if (!state.production) {
      throw new Error('No Production CSID on file - complete ZATCA onboarding (Settings > ZATCA) before submitting real invoices.');
    }

    // The seller block comes from the same stored identity the CSID's CSR was built from - see
    // store/identity.ts. Falling back to `.env` here would let the signed document describe a
    // different VAT registration than the certificate.
    const { identity } = await loadIdentity();

    // A failed attempt is archived but does not advance the chain. If it is still the last attempt
    // for this document, reusing its UUID keeps the retry the SAME ZATCA document; the ICV comes
    // from current state, so it is identical only when no later invoice has used that counter.
    const previousFailed = await findFailedSubmissionByInvoiceNo(req.invoiceNo);
    const icv = state.icv + 1;
    const input: UblInvoiceInput = {
      kind: req.invoiceType,
      documentType: req.documentType ?? 'invoice',
      ...(req.billingReference ? { billingReference: req.billingReference } : {}),
      ...(req.note ? { note: req.note } : {}),
      id: req.invoiceNo,
      uuid: previousFailed?.uuid ?? randomUUID(),
      icv,
      previousInvoiceHash: state.lastInvoiceHash,
      issueDateTime: new Date(req.date),
      currency: 'SAR',
      supplier: toUblSupplier(identity.seller),
      customer: { name: req.customerName, vatNumber: req.customerVatNumber },
      lines: toUblLines(req.lines),
      // UNCL4461 subset ZATCA accepts: 10 cash, 48 bank card, 1 "Instrument not defined" - used
      // here for insurance (no dedicated code for a third-party payer settlement) and for 'other'
      // (an unknown tender: store credit note, gift certificate, etc.), whose exact meaning is
      // literally what code 1 exists for.
      paymentMeansCode: req.paymentMethod === 'cash' ? '10' : req.paymentMethod === 'card' ? '48' : '1',
    };

    const signed = await signInvoice(input, state.production);
    const invoiceBase64 = Buffer.from(signed.signedXml, 'utf8').toString('base64');

    const clearance = req.invoiceType === 'standard';
    const response = await submitToZatca(state.production, signed.invoiceHashBase64, input.uuid, invoiceBase64, clearance);

    // Fail closed: only an explicit accepted status with no errors advances the chain. Unknown,
    // missing or ERROR answers stay failed instead of being recorded as compliant.
    const outcome = interpretSubmitResult(response, clearance);

    // Retain the document BEFORE advancing the chain. ZATCA requires the seller to keep the signed
    // invoice, and archiving first means the worst case of a crash here is a duplicate archived row,
    // never an accepted invoice whose chain pointer moved on without a retained copy of itself.
    await archiveInvoice({
      uuid: input.uuid,
      icv,
      invoiceNo: req.invoiceNo,
      invoiceType: req.invoiceType,
      documentType: input.documentType,
      billingReference: input.billingReference,
      note: input.note,
      issueDate: req.date,
      status: outcome.status,
      invoiceHashBase64: signed.invoiceHashBase64,
      qrBase64: signed.qrBase64,
      signedXml: signed.signedXml,
      clearedInvoiceXmlBase64: outcome.clearedInvoiceXmlBase64,
      reason: outcome.reason,
      response,
      submittedAt: new Date().toISOString(),
      environment: state.environment,
    });

    if (outcome.accepted) {
      await recordInvoice(icv, signed.invoiceHashBase64);
    }

    return {
      status: outcome.status,
      qrBase64: signed.qrBase64,
      invoiceHashBase64: signed.invoiceHashBase64,
      zatcaResponse: response,
      reason: outcome.reason,
      clearedInvoiceXmlBase64: outcome.clearedInvoiceXmlBase64,
      signedXmlBase64: invoiceBase64,
      uuid: input.uuid,
      icv,
      environment: state.environment,
    };
  });
}
