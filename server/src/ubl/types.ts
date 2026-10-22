export interface UblPartyAddress {
  street: string;
  city: string;
  postalCode: string;
  district: string;
  country: string; // ISO 3166-1 alpha-2, e.g. "SA"
}

export interface UblSupplier {
  nameEn: string;
  vatNumber: string;
  crNumber: string;
  address: UblPartyAddress;
}

export interface UblCustomer {
  name: string;
  vatNumber?: string;
  address?: UblPartyAddress;
}

export interface UblInvoiceLine {
  id: string;
  itemNameEn: string;
  qty: number;
  unitCode: string; // UN/ECE Recommendation 20 unit code, e.g. "PCE"
  unitPrice: number; // VAT-exclusive
  vatRate: number; // e.g. 0.15
  lineDiscountAmount: number; // VAT-exclusive
}

export type UblInvoiceKind = 'standard' | 'simplified'; // B2B (clearance) vs B2C (reporting)
export type UblDocumentType = 'invoice' | 'credit_note' | 'debit_note';

export interface UblInvoiceInput {
  kind: UblInvoiceKind;
  documentType: UblDocumentType;
  id: string; // human-readable invoice number
  uuid: string;
  icv: number; // Invoice Counter Value - strictly incrementing per device, never reused
  previousInvoiceHash: string; // base64 sha256 of the previous invoice's canonical XML ("0" chain root)
  issueDateTime: Date;
  currency: string; // "SAR"
  supplier: UblSupplier;
  customer: UblCustomer;
  lines: UblInvoiceLine[];
  paymentMeansCode: string; // e.g. "10" cash, "48" card - UNCL4461 subset ZATCA accepts
}
