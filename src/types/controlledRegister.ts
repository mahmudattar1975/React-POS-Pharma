// Controlled-drug register (represcription.md §5 P1, §10 Phase 3).
//
// One immutable row per stock movement of a controlled item, written next to the real stock
// mutation so the register's running balance can be reconciled against Batch.qtyOnHand. Entries are
// never edited or deleted: a correction or a customer return is a new row, optionally pointing at
// the row it reverses (`reversalOf`), which is what makes the log an audit trail rather than a
// mutable counter.
//
// Quantities are always in BASE stock units (tablets for a packed item, selling units otherwise),
// because that is the unit Batch.qtyOnHand is kept in and the only way a balance can be compared
// with stock without re-deriving pack ladders.
export type ControlledRegisterKind =
  | 'opening' // seeded from stock on hand the first time an item moves in a branch
  | 'dispense' // sold against a prescription / at the till
  | 'return' // customer return, reverses a dispense row
  | 'damage' // write-off: broken, spilled, lost
  | 'expiry'; // write-off: expired stock destroyed

export type ControlledRegisterDirection = 'in' | 'out';

export interface ControlledRegisterEntry {
  id: string;
  at: string; // ISO datetime
  kind: ControlledRegisterKind;
  direction: ControlledRegisterDirection;
  itemId: string;
  itemNameEn: string;
  itemNameAr: string;
  batchNo?: string;
  expiryDate?: string | null;
  // Always positive; `direction` says whether it added to or subtracted from the balance.
  baseQty: number;
  // Running balance for this item + branch after this row, in base units.
  balanceAfter: number;
  // Cost-center/branch id. Undefined means unassigned (the POS without a configured branch).
  branchId?: string;
  prescriptionId?: string; // registry id
  prescriptionNo?: string;
  prescriberName?: string;
  patientNationalId?: string;
  invoiceId?: string;
  invoiceNo?: string;
  saleLineId?: string;
  returnNo?: string;
  pharmacist: string;
  witness?: string;
  reason?: string;
  // Set on a return/correction row, pointing at the dispense/write-off row it reverses.
  reversalOf?: string;
}

export interface ControlledMovementInput {
  kind: Exclude<ControlledRegisterKind, 'opening'>;
  direction?: ControlledRegisterDirection; // default: return = in, everything else = out
  itemId: string;
  itemNameEn: string;
  itemNameAr: string;
  batchNo?: string;
  expiryDate?: string | null;
  baseQty: number; // positive magnitude, base units
  branchId?: string;
  prescriptionId?: string;
  prescriptionNo?: string;
  prescriberName?: string;
  patientNationalId?: string;
  invoiceId?: string;
  invoiceNo?: string;
  saleLineId?: string;
  returnNo?: string;
  pharmacist: string;
  witness?: string;
  reason?: string;
  reversalOf?: string;
  at?: string; // tests / back-dated imports; the app always uses the real time
}
