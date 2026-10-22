import type { ControlledStatus } from './catalog';

export type InvoiceType = 'simplified' | 'standard'; // B2C reported-after vs B2B cleared-before, per ZATCA
export type PaymentMethod = 'cash' | 'card' | 'insurance' | 'points' | 'other'; // 'other' is for any non-standard method (e.g. a store credit note) that doesn't fit the above
export type CardNetwork = 'mada' | 'visa' | 'mastercard' | 'amex' | 'other';
export type InvoiceStatus = 'completed' | 'returned' | 'partially_returned';

export interface Payment {
  method: PaymentMethod;
  amount: number;
  cardNetwork?: CardNetwork; // set only when method === 'card' - which scheme, for reconciliation against the card terminal's own batch report
  insuranceCompany?: string; // set only when method === 'insurance'
  insuranceApprovalCode?: string; // optional claim/authorization reference from the insurer, for reconciliation
}

export interface SaleLine {
  id: string;
  itemId: string;
  itemNameAr: string;
  itemNameEn: string;
  batchId: string;
  batchNo: string;
  expiryDate: string;
  qty: number;
  unitPrice: number; // VAT-exclusive
  vatRate: number;
  offerLabel?: string;
  manualDiscountType?: 'amount' | 'percent';
  manualDiscountValue?: number;
  discountAmount: number; // total line discount (offer + manual + tier), VAT-exclusive terms
  netExclVat: number; // (qty * unitPrice) - discountAmount
  vatAmount: number;
  totalInclVat: number;
  returnedQty: number; // running total already returned against this line
  controlledStatus?: ControlledStatus; // snapshot of Item.controlledStatus at sale time, for the receipt/audit record
  // dotnet-pos's PosItem.Id for this line, if the sale was successfully mirrored there (see
  // POSPage.tsx's completeSale) - undefined if that call failed or hasn't been attempted (older
  // invoices). ReturnsPage uses this to also mirror a return there for commission clawback.
  posItemId?: number;
}

// The exact 4 fields SFDA's own RASD "Pharmacy Sale" webservice protocol requires per transaction
// (doctorid, patientnationalid, prescriptionid, prescriptiondate - confirmed from the legacy
// PowerBuilder RASD module's real SOAP request shape, phrasd_webservices.pbl). Captured and
// retained locally for now (SFDA electronic reporting itself - Raqeeb/CDS - needs real licensed
// credentials this app doesn't have), but shaped to match what that reporting would need later.
// 'wasfaty': a government e-prescription from NUPCO's Wasfaty ("وصفتي") service - the patient
// brings a prescription already issued electronically by a hospital/PHC physician, downloaded
// and dispensed against at the pharmacy. 'private': an ordinary paper/verbal prescription this
// pharmacy is recording itself, same as before Wasfaty support existed.
//
// This is local record-keeping only, not a live Wasfaty integration - joining Wasfaty for real
// requires NUPCO pharmacy accreditation this app has no way to verify, and its actual API
// contract (endpoints, auth, request/response shapes) wasn't available to build against (see the
// conversation this was added in). wasfatyReferenceNo just captures the reference number for the
// pharmacy's own records until/unless a real API integration is built later.
export type PrescriptionSource = 'private' | 'wasfaty';

export interface PrescriptionInfo {
  source: PrescriptionSource;
  wasfatyReferenceNo?: string; // set only when source === 'wasfaty'
  prescriberName: string;
  prescriberId?: string; // doctor's license/ID - not always available, so optional
  prescriptionId: string;
  prescriptionDate: string; // ISO date
  patientNationalId: string;
}

// 'phase2_cleared'/'phase2_reported': the ZATCA server signed + submitted this invoice and ZATCA
// accepted it (standard invoices are cleared before printing; simplified ones are reported after).
// 'phase1_fallback': the ZATCA server was unreachable or not yet onboarded at checkout time, so
// the sale went through with the simpler Phase 1 QR (see utils/zatcaQr.ts) - the sale still
// completes (a POS can't block a sale on a backend being down), but this invoice was never
// actually reported to ZATCA and needs resubmitting once the server/onboarding is available.
export type ZatcaSubmissionStatus = 'phase2_cleared' | 'phase2_reported' | 'phase1_fallback' | 'submission_failed';

export interface SaleHeader {
  id: string;
  invoiceNo: string;
  invoiceType: InvoiceType;
  date: string; // ISO datetime
  customerId?: string;
  customerNameAr?: string;
  customerNameEn?: string;
  lines: SaleLine[];
  subtotalExclVat: number;
  totalDiscount: number;
  totalVatAmount: number;
  totalInclVat: number;
  payments: Payment[];
  zatcaQrBase64: string;
  zatcaStatus: ZatcaSubmissionStatus;
  status: InvoiceStatus;
  cashierName: string;
  pointsEarned?: number; // loyalty points earned on this sale (walk-in/no-phone customers never earn)
  pointsRedeemed?: number; // loyalty points spent via a 'points' payment row, if any
  // Cumulative amount of the above already clawed back / refunded by returns processed so far -
  // tracked so a series of partial returns against the same invoice never double-adjusts the
  // customer's points balance (see ReturnsPage's cumulative-ratio logic).
  pointsEarnedClawedBack?: number;
  pointsRedeemedRefunded?: number;
  prescription?: PrescriptionInfo; // present when any line required a prescription/controlled-substance capture at checkout
  // dotnet-pos's Pos.Id, if this sale was successfully mirrored there for commission/shift
  // tracking (see POSPage.tsx's completeSale) - undefined if that call failed or wasn't
  // attempted (e.g. older invoices from before this existed).
  posSaleId?: number;
}

export interface ReturnLine {
  saleLineId: string;
  itemNameEn: string;
  qty: number;
  refundAmount: number; // inclusive of VAT
}

export interface ReturnHeader {
  id: string;
  returnNo: string;
  date: string;
  originalInvoiceId: string;
  originalInvoiceNo: string;
  lines: ReturnLine[];
  totalRefund: number;
  reason: string;
}
