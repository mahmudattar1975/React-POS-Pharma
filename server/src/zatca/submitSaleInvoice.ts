import { randomUUID } from 'node:crypto';
import { loadState, recordInvoice } from '../store/secureStore.js';
import { loadIdentity, toUblSupplier } from '../store/identity.js';
import { archiveInvoice } from '../store/invoiceArchive.js';
import type { UblInvoiceInput, UblInvoiceLine } from '../ubl/types.js';
import { signInvoice } from './signInvoice.js';
import { submitInvoice as submitToZatca } from './client.js';

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

export async function submitSaleInvoice(req: SubmitSaleInvoiceRequest): Promise<SubmitSaleInvoiceResult> {
  const state = await loadState();
  if (!state.production) {
    throw new Error('No Production CSID on file - complete ZATCA onboarding (Settings > ZATCA) before submitting real invoices.');
  }

  // The seller block comes from the same stored identity the CSID's CSR was built from - see
  // store/identity.ts. Falling back to `.env` here would let the signed document describe a
  // different VAT registration than the certificate.
  const { identity } = await loadIdentity();

  const icv = state.icv + 1;
  const input: UblInvoiceInput = {
    kind: req.invoiceType,
    documentType: 'invoice',
    id: req.invoiceNo,
    uuid: randomUUID(),
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

  // Only advance the invoice chain (ICV/PIH) once ZATCA has accepted the submission - a failed
  // submission must be retried with the SAME counter value, not skip ahead in the chain.
  const accepted = !String(response.status ?? '').toLowerCase().includes('reject');
  const status = accepted ? (clearance ? 'cleared' : 'reported') : 'failed';

  // Retain the document BEFORE advancing the chain. ZATCA requires the seller to keep the signed
  // invoice, and archiving first means the worst case of a crash here is a duplicate archived row,
  // never an accepted invoice whose chain pointer moved on without a retained copy of itself.
  await archiveInvoice({
    uuid: input.uuid,
    icv,
    invoiceNo: req.invoiceNo,
    invoiceType: req.invoiceType,
    issueDate: req.date,
    status,
    invoiceHashBase64: signed.invoiceHashBase64,
    qrBase64: signed.qrBase64,
    signedXml: signed.signedXml,
    response,
    submittedAt: new Date().toISOString(),
    environment: state.environment,
  });

  if (accepted) {
    await recordInvoice(icv, signed.invoiceHashBase64);
  }

  return {
    status,
    qrBase64: signed.qrBase64,
    invoiceHashBase64: signed.invoiceHashBase64,
    zatcaResponse: response,
    signedXmlBase64: invoiceBase64,
    uuid: input.uuid,
    icv,
    environment: state.environment,
  };
}
