import type { ControlledStatus, PackLevel } from './catalog';
import type { DosageSnapshot } from './dosage';
import type { WasfatyDispenseInfo } from './wasfaty';

export type InvoiceType = 'simplified' | 'standard'; // B2C reported-after vs B2B cleared-before, per ZATCA
// 'wasfaty' is the NUPCO/Wasfaty coverage tender for a covered line under money model Option A: the
// invoice is issued at the NUPCO-approved value and settled 100% by this leg, so the patient's own
// cash/card legs only cover non-covered items. It is NOT 'insurance': the payer, the claim record
// and the reporting are different, and merging the two would make both reports wrong.
export type PaymentMethod = 'cash' | 'card' | 'insurance' | 'points' | 'wasfaty' | 'other'; // 'other' is for any non-standard method (e.g. a store credit note) that doesn't fit the above
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
  // Only for items with a pack ladder: the level sold (box/strip/tablet) and the tablet count it
  // represented, so a later return puts back exactly what left the shelf even if the item's pack
  // config was edited in the meantime.
  packLevel?: PackLevel;
  baseQty?: number;
  unit?: string; // selling unit shown on the receipt ("Box", "Strip", "Tablet")
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
  // Patient-facing directions dispensed with this line, frozen at checkout. Stored on the SALE, not
  // just referenced by id, so a reprint years later shows exactly what the patient was told even
  // after the DOS master or the item's suggested links have changed. Optional by design: not every
  // sale needs written directions.
  dosage?: DosageSnapshot;
  // Department cost center for THIS line (Phase B.1), stamped at checkout from the item's category
  // via costCenterStore.categoryMap. Snapshot semantics: changing the map later never rewrites an
  // issued invoice. Undefined means the category had no rule (or the item had no category), in
  // which case the invoice HEADER's costCenterId (the branch) still applies - the Expenses report
  // falls back to it line by line, so historical invoices keep reporting exactly as they did.
  costCenterId?: string;
  // dotnet-pos's PosItem.Id for this line, if the sale was successfully mirrored there (see
  // POSPage.tsx's completeSale) - undefined if that call failed or hasn't been attempted (older
  // invoices). ReturnsPage uses this to also mirror a return there for commission clawback.
  posItemId?: number;
  // ---- Wasfaty / NUPCO coverage, frozen at checkout (money model Option A) ---------------------
  // Present only on a covered line. `nupcoCode` is the mapped code that was actually dispensed,
  // `nupcoUnitPrice` is the price the invoice used for the Wasfaty claim, `patientShare` is 0.00
  // for a covered line, and `claimAmount` is the VAT-inclusive amount NUPCO/supplier reimburses.
  // These are snapshots: editing the item's mapping or the NUPCO price later must not rewrite an
  // issued invoice or an already-submitted claim.
  nupcoCode?: string;
  nupcoUnitPrice?: number;
  patientShare?: number;
  claimAmount?: number;
  wasfatyLineId?: string;
}

export type SaleChannel = 'retail' | 'wasfaty';

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
//
// 'pending_submission' is the state BETWEEN those two: the request was built and attempted, and
// the server explicitly answered "not now" (no CSID yet, ZATCA unreachable). It is kept apart
// from 'phase1_fallback' because the two need different actions - a fallback has never been tried,
// a pending one has a known reason recorded in zatcaFailureReason - and apart from
// 'submission_failed' because a hard rejection usually means the DOCUMENT is wrong, which needs a
// human, not a retry.
export type ZatcaSubmissionStatus =
  | 'phase2_cleared'
  | 'phase2_reported'
  | 'phase1_fallback'
  | 'pending_submission'
  | 'submission_failed';

export interface SaleHeader {
  id: string;
  invoiceNo: string;
  invoiceType: InvoiceType;
  date: string; // ISO datetime
  customerId?: string;
  customerNameAr?: string;
  customerNameEn?: string;
  // Buyer VAT registration number, REQUIRED on a standard (B2B) tax invoice - ZATCA clears against
  // it, so it is part of the document, not just customer-master metadata. Optional because
  // simplified (B2C) invoices have no buyer VAT and pre-Phase-2 invoices never stored one.
  customerVatNumber?: string;
  lines: SaleLine[];
  subtotalExclVat: number;
  totalDiscount: number;
  totalVatAmount: number;
  totalInclVat: number;
  payments: Payment[];
  zatcaQrBase64: string;
  zatcaStatus: ZatcaSubmissionStatus;
  // ---- ZATCA Phase 2 evidence (see utils/zatcaInvoice.ts and server/README.md) ----------------
  // The ZATCA-assigned UUID is part of the document identity: it is what a clearance/reporting
  // response, the QR and the signed XML all refer to, so reprinting or auditing an invoice needs
  // it stored here, not only inside the XML held by the server.
  zatcaUuid?: string;
  // Invoice Counter Value actually used for this document. ZATCA requires a strictly increasing
  // per-device sequence, so the number a sale was submitted with is part of its legal identity
  // and must never be re-derived or guessed later.
  zatcaIcv?: number;
  // SHA-256 (base64) of the canonical XML. This is the value that becomes the PIH of the NEXT
  // invoice in the chain, and it is what ZATCA's response validates against - keeping it here
  // lets the app prove which document was actually accepted.
  zatcaInvoiceHashBase64?: string;
  zatcaSubmittedAt?: string; // ISO datetime of the accepted submission
  zatcaEnvironment?: 'sandbox' | 'simulation' | 'production';
  // Why the last attempt did not succeed, in the words the server returned. Shown as-is on the
  // Sales invoices tab so "ZATCA server is down" is never confused with "ZATCA rejected this".
  zatcaFailureReason?: string;
  status: InvoiceStatus;
  cashierName: string;
  // Branch cost center this sale is attributed to (Phase A cost-center tagging, see
  // types/costCenters.ts) - set by default from settings.costCenterId with ZERO extra cashier
  // input (POS friction must stay zero), optional field so pre-cost-center invoices stay valid;
  // undefined rows surface in the Expenses page's unassigned exception list.
  costCenterId?: string;
  pointsEarned?: number; // loyalty points earned on this sale (walk-in/no-phone customers never earn)
  pointsRedeemed?: number; // loyalty points spent via a 'points' payment row, if any
  // Cumulative amount of the above already clawed back / refunded by returns processed so far -
  // tracked so a series of partial returns against the same invoice never double-adjusts the
  // customer's points balance (see ReturnsPage's cumulative-ratio logic).
  pointsEarnedClawedBack?: number;
  pointsRedeemedRefunded?: number;
  prescription?: PrescriptionInfo; // present when any line required a prescription/controlled-substance capture at checkout
  // ---- Wasfaty / NUPCO ------------------------------------------------------------------------
  // 'retail' (or undefined, for older invoices) is an ordinary sale. 'wasfaty' means at least one
  // line was dispensed against a Wasfaty prescription and settled by the coverage tender. The
  // `wasfaty` object is the operational record; `prescription` above stays the SFDA/RASD-shaped
  // record and is not repurposed.
  channel?: SaleChannel;
  wasfaty?: WasfatyDispenseInfo;
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
