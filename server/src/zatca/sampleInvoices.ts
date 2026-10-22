import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import type { UblInvoiceInput, UblDocumentType, UblInvoiceKind } from '../ubl/types.js';

// ZATCA's compliance-invoices check expects one sample of each invoice/credit-note/debit-note
// type, for both standard (B2B) and simplified (B2C) invoices - six samples total - before it
// will issue a Production CSID. These are throwaway documents (never submitted to reporting/
// clearance, only to the compliance-check endpoint) so the content just needs to be structurally
// valid, not tied to a real sale.
const DOCUMENT_TYPES: UblDocumentType[] = ['invoice', 'credit_note', 'debit_note'];
const KINDS: UblInvoiceKind[] = ['standard', 'simplified'];

export function buildSampleInvoices(): Array<{ name: string; input: UblInvoiceInput }> {
  const samples: Array<{ name: string; input: UblInvoiceInput }> = [];

  for (const kind of KINDS) {
    for (const docType of DOCUMENT_TYPES) {
      const input: UblInvoiceInput = {
        kind,
        documentType: docType,
        id: `COMPLIANCE-${kind}-${docType}`,
        uuid: randomUUID(),
        icv: 0,
        previousInvoiceHash: Buffer.from([0]).toString('base64'),
        issueDateTime: new Date(),
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
        customer:
          kind === 'standard'
            ? {
                name: 'Compliance Test Buyer',
                vatNumber: '399999999900003',
                address: { street: 'Test Street', city: 'Riyadh', postalCode: '11111', district: 'Test District', country: 'SA' },
              }
            : { name: 'Walk-in Customer' },
        lines: [
          { id: '1', itemNameEn: 'Sample Item', qty: 1, unitCode: 'PCE', unitPrice: 100, vatRate: 0.15, lineDiscountAmount: 0 },
        ],
        paymentMeansCode: '10',
      };
      samples.push({ name: `${kind}-${docType}`, input });
    }
  }

  return samples;
}
