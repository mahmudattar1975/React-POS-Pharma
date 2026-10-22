import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { loadState, recordInvoice } from '../store/secureStore.js';
import type { UblInvoiceInput, UblInvoiceLine } from '../ubl/types.js';
import { signInvoice } from './signInvoice.js';
import { submitInvoice as submitToZatca } from './client.js';

export interface SaleInvoiceLineDto {
  id: string;
  itemNameEn: string;
  qty: number;
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
  paymentMethod: 'cash' | 'card' | 'insurance';
}

export interface SubmitSaleInvoiceResult {
  status: 'cleared' | 'reported' | 'accepted_with_warnings' | 'failed';
  qrBase64: string;
  invoiceHashBase64: string;
  zatcaResponse: unknown;
  signedXmlBase64: string;
}

function toUblLines(lines: SaleInvoiceLineDto[]): UblInvoiceLine[] {
  return lines.map((l) => ({
    id: l.id,
    itemNameEn: l.itemNameEn,
    qty: l.qty,
    unitCode: 'PCE',
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
    supplier: {
      nameEn: config.seller.nameEn,
      vatNumber: config.seller.vatNumber,
      crNumber: config.seller.crNumber,
      address: {
        street: config.seller.street,
        city: config.seller.city,
        postalCode: config.seller.postalCode,
        district: config.seller.district,
        country: config.seller.country,
      },
    },
    customer: { name: req.customerName, vatNumber: req.customerVatNumber },
    lines: toUblLines(req.lines),
    // UNCL4461 subset ZATCA accepts: 10 cash, 48 bank card, 1 "instrument not defined" - used
    // here for insurance since there's no dedicated code for a third-party payer settlement.
    paymentMeansCode: req.paymentMethod === 'cash' ? '10' : req.paymentMethod === 'card' ? '48' : '1',
  };

  const signed = await signInvoice(input, state.production);
  const invoiceBase64 = Buffer.from(signed.signedXml, 'utf8').toString('base64');

  const clearance = req.invoiceType === 'standard';
  const response = await submitToZatca(state.production, signed.invoiceHashBase64, input.uuid, invoiceBase64, clearance);

  // Only advance the invoice chain (ICV/PIH) once ZATCA has accepted the submission - a failed
  // submission must be retried with the SAME counter value, not skip ahead in the chain.
  const accepted = !String(response.status ?? '').toLowerCase().includes('reject');
  if (accepted) {
    await recordInvoice(icv, signed.invoiceHashBase64);
  }

  return {
    status: accepted ? (clearance ? 'cleared' : 'reported') : 'failed',
    qrBase64: signed.qrBase64,
    invoiceHashBase64: signed.invoiceHashBase64,
    zatcaResponse: response,
    signedXmlBase64: invoiceBase64,
  };
}
