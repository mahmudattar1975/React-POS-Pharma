// Wasfaty (وصفتي) / NUPCO - shared client-side vocabulary.
//
// The app has two very different Wasfaty surfaces and this file names both:
//
//  1. A SALE is either retail or wasfaty. A wasfaty sale has a prescription header, a pharmacist,
//     a zero patient share on covered lines, and a claim amount per line (money model Option A:
//     the tax invoice is issued at the NUPCO-approved value, settled 100% by a `wasfaty` tender,
//     so the patient pays only for non-covered items).
//
//  2. A DISPENSE is the operational record: who dispensed what, against which prescription,
//     authorization and batch, and where that record is in its lifecycle. Phase 0 writes it with
//     provider `manual`; the same shape is what a live NUPCO connector will fill in later.
//
// "Accurate" is an important word here: NUPCO does not publish a public API contract, so nothing
// in this file pretends to be NUPCO's wire format. It is OUR provider-neutral contract, and the
// server-side adapter is the only place that will ever know NUPCO's real endpoints/payloads.

export type WasfatyProvider = 'manual' | 'mock' | 'direct' | 'hub';

export type WasfatyDispenseStatus =
  | 'manual_recorded' // Phase 0: pharmacist recorded a dispense without a live NUPCO authorization
  | 'authorization_pending' // request sent, waiting for NUPCO
  | 'authorized'
  | 'partially_authorized'
  | 'rejected'
  | 'dispensed'
  | 'cancelled'
  | 'claim_pending'
  | 'claimed'
  | 'reconciled';

export type WasfatyClaimStatus =
  | 'pending'
  | 'submitted'
  | 'reported'
  | 'paid'
  | 'variance'
  | 'reconciled'
  | 'cancelled';

// The prescription data captured at the counter. This is deliberately separate from
// PrescriptionInfo (types/sales.ts): PrescriptionInfo is the SFDA/RASD-shaped record used for
// controlled-substance sales, while this one is the Wasfaty-specific identity (patient ID,
// Wasfaty reference, NUPCO authorization). A sale can have both, and they must not be merged.
export interface WasfatySession {
  patientNationalId: string; // 10 digits; masked everywhere except the dispense screen
  prescriptionNo: string;
  wasfatyReferenceNo?: string;
  authorizationNo?: string;
  prescriberName: string;
  prescriberId?: string;
  prescriptionDate: string; // ISO date
  pharmacistId?: string; // defaults to the signed-in cashier/pharmacist
}

export interface WasfatyDispenseInfo extends WasfatySession {
  provider: WasfatyProvider;
  status: WasfatyDispenseStatus;
  // Server-side identifiers. Present once the dispense has been mirrored to the app's API; the
  // sale remains valid (and printable) if the server was unreachable and this is still undefined.
  dispenseId?: string;
  nupcoPrescriptionId?: string;
  nupcoDispenseId?: string;
  submittedAt?: string;
  authorizedAt?: string;
  dispensedAt?: string;
  rejectionReason?: string;
  claimStatus?: WasfatyClaimStatus;
  claimMonth?: string; // YYYY-MM
  totalClaimAmount?: number;
  totalPatientShare?: number;
  // Local-only transport state for the sale -> server mirror. Never printed.
  syncState?: 'synced' | 'queued' | 'failed';
}

// One line of a body returned by the provider-neutral API (see server/src/wasfaty/types.ts).
export interface WasfatyPrescriptionLine {
  lineId: string;
  nupcoCode: string;
  nameEn: string;
  nameAr?: string;
  qty: number;
  unit?: string;
  dose?: string;
  substitutionAllowed?: boolean;
}

export interface WasfatyPrescription {
  prescriptionId: string;
  prescriptionNo: string;
  patientIdLast4: string;
  prescriber: { name: string; id?: string };
  issuedAt: string;
  status: 'active' | 'dispensed' | 'expired' | 'cancelled';
  lines: WasfatyPrescriptionLine[];
  source: WasfatyProvider;
}

// What the POS needs to send for a Phase 0 manual dispense. Prices are the ones actually invoiced
// (VAT-exclusive unit price + inclusive claim), so a claim can never be recomputed from a changed
// item master later.
export interface WasfatyDispenseLineInput {
  lineId: string;
  nupcoCode: string;
  itemId: string;
  itemNameEn: string;
  itemNameAr?: string;
  batchNo?: string;
  expiryDate?: string;
  qty: number;
  unit?: string;
  nupcoUnitPrice: number;
  patientShare: number;
  claimAmount: number;
}

export interface WasfatyManualDispenseInput {
  saleId: string;
  invoiceNo: string;
  session: WasfatySession;
  lines: WasfatyDispenseLineInput[];
  // The tax document's own total, so the API can assert the claim arithmetic instead of trusting
  // a client-computed figure.
  invoiceTotalInclVat: number;
  claimTotal: number;
  currency: string;
}

export interface WasfatyDispenseRecord {
  id: string;
  provider: WasfatyProvider;
  status: WasfatyDispenseStatus;
  saleId?: string;
  invoiceNo?: string;
  prescriptionNo: string;
  wasfatyReferenceNo?: string;
  authorizationNo?: string;
  nupcoPrescriptionId?: string;
  nupcoDispenseId?: string;
  patientIdLast4?: string;
  pharmacistId?: string;
  submittedAt?: string;
  authorizedAt?: string;
  dispensedAt?: string;
  rejectionReason?: string;
  claimId?: string;
  claimStatus?: WasfatyClaimStatus;
  claimMonth?: string;
  totalClaimAmount?: number;
  totalPatientShare?: number;
  lines: WasfatyDispenseLineInput[];
  createdAt: string;
  updatedAt: string;
}

export interface WasfatyClaim {
  id: string;
  dispenseId: string;
  invoiceNo?: string;
  prescriptionNo: string;
  month: string;
  expectedAmount: number;
  reportedAmount?: number;
  paidAmount?: number;
  status: WasfatyClaimStatus;
  varianceReason?: string;
  createdAt: string;
  updatedAt: string;
}

// The claim-export row, stable regardless of NUPCO's eventual report format (Appendix B of
// Wasfaty.md). Every value here comes from a SAVED sale; nothing is recomputed from today's item
// master, because that would rewrite history.
export interface WasfatyClaimRow {
  invoiceNo: string;
  invoiceDate: string;
  branchId?: string;
  branchName: string;
  channel: 'wasfaty';
  prescriptionNo: string;
  authorizationNo: string;
  dispenseId: string;
  patientIdMasked: string;
  nupcoCode: string;
  itemNameEn: string;
  itemNameAr: string;
  batchNo: string;
  expiryDate: string;
  qty: number;
  unit: string;
  nupcoUnitPrice: number;
  lineTotal: number;
  patientShare: number;
  claimAmount: number;
  pharmacist: string;
  status: string;
  exception: string;
}

export interface WasfatyClaimSummary {
  rows: number;
  invoices: number;
  claimAmount: number;
  patientShare: number;
  lineTotal: number;
  exceptions: number;
  byException: Record<string, number>;
}

export interface WasfatyClaimFilter {
  month?: string; // YYYY-MM, blank = all months
  branchId?: string; // blank/undefined = all branches
  branchNames?: Record<string, string>; // costCenterId -> display name
}

// One entry in the NUPCO mapping audit trail. The mapping is financial data (it decides what the
// claim is worth and whether an item is covered), so who changed it and what it was before must be
// recoverable even though the item row itself only keeps the current value.
export interface WasfatyMappingSnapshot {
  nupcoCode?: string;
  wasfatyPrice?: number;
  wasfatyEligible?: boolean;
}

export interface WasfatyMappingChange {
  id: string;
  itemId: string;
  itemNameEn: string;
  itemNo?: number;
  at: string; // ISO timestamp
  by: string; // signed-in cashier, or "Unknown user"
  source: 'manual' | 'import';
  before: WasfatyMappingSnapshot;
  after: WasfatyMappingSnapshot;
}
