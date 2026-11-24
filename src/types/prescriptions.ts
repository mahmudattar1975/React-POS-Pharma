// Prescription registry types (see .mdfile/represcription.md §6).
//
// The invoice already carries a small SFDA/RASD-shaped `PrescriptionInfo` snapshot (types/sales.ts).
// This file is the *registry* record behind it: one prescription can cover several invoices and
// several fills, so refills, partial dispensing and the controlled register have somewhere to live
// that is not the invoice. Everything stays local (zustand + persist) - no backend is involved.
import type { DosageSnapshot } from './dosage';

export type PrescriptionSource = 'private' | 'wasfaty';

// 'active'          - captured, nothing dispensed yet.
// 'partially_dispensed' - at least one fill happened, quantity remains.
// 'dispensed'       - every line's authorised quantity (including refills) is used.
// 'expired'         - past the validity window; dispensing needs an override with a reason.
// 'cancelled'       - voided by the pharmacy; never dispensed again.
// 'blocked'         - held for a clinical/compliance reason.
export type PrescriptionStatus =
  | 'active'
  | 'partially_dispensed'
  | 'dispensed'
  | 'expired'
  | 'cancelled'
  | 'blocked';

export interface PrescriptionLine {
  id: string;
  itemId: string;
  // Frozen names/unit at capture time, exactly like a sale line: renaming an item later must not
  // rewrite what the prescriber actually wrote.
  itemNameEn: string;
  itemNameAr: string;
  unit: string;
  // Quantity of ONE fill, in selling units. The total the patient may take is this × (1 + refills).
  quantityPrescribed: number;
  quantityDispensed: number;
  refillsAuthorized: number;
  // The prescriber's sig, frozen as a dosage snapshot (types/dosage.ts) exactly like a sale line's
  // directions: the same structured fields + generated AR/EN sentences the rest of the app already
  // prints, chosen from the DOS master at capture. A later edit to the master cannot rewrite what
  // this patient was told. Optional - not every prescription has writable directions.
  dosage?: DosageSnapshot;
  // Course length the refill/supply rules measure against, used only for records captured before
  // `dosage` existed (or typed by hand). New captures keep it inside `dosage.durationDays`.
  durationDays?: number;
  substitutionAllowed?: boolean; // false = dispense as written
}

// Batch and expiry are part of what the patient's label must state, and they are properties of the
// FILL, not of the prescription (a later refill may come from a different batch). Freezing them on
// the event is what makes a reprint months later honest.
export interface DispenseEventLine {
  prescriptionLineId: string;
  itemId: string;
  qty: number;
  unit: string;
  batchNo?: string;
  expiryDate?: string | null;
}

export interface DispenseEvent {
  id: string;
  invoiceId: string;
  invoiceNo: string;
  dispensedAt: string; // ISO datetime
  dispensedBy: string;
  // Set only when the pharmacist dispensed against an expired/blocked prescription; kept on the
  // event so the audit trail says why the gate was overridden.
  overrideReason?: string;
  lines: DispenseEventLine[];
}

export interface Prescription {
  id: string;
  prescriptionNo: string;
  source: PrescriptionSource;
  wasfatyReferenceNo?: string;
  patientNationalId: string;
  patientName?: string;
  prescriberId?: string;
  prescriberName: string;
  issuedDate: string; // ISO date
  expiryDate: string; // issuedDate + validityDays
  validityDays: number;
  status: PrescriptionStatus;
  lines: PrescriptionLine[];
  dispenseEvents: DispenseEvent[];
  notes?: string;
  createdAt: string;
  createdBy: string;
}

// What the capture dialog sends to the store. Derived fields (id, expiryDate, status, counters)
// are filled in by prescriptionStore, never by the form.
export interface PrescriptionInput {
  prescriptionNo: string;
  source: PrescriptionSource;
  wasfatyReferenceNo?: string;
  patientNationalId: string;
  patientName?: string;
  prescriberId?: string;
  prescriberName: string;
  issuedDate: string;
  validityDays?: number;
  lines: {
    itemId: string;
    itemNameEn: string;
    itemNameAr: string;
    unit: string;
    quantityPrescribed: number;
    refillsAuthorized: number;
    dosage?: DosageSnapshot;
    durationDays?: number;
    substitutionAllowed?: boolean;
  }[];
  notes?: string;
  createdBy: string;
}
