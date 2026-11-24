// Pure helpers for the controlled-drug register: month reconciliation and the CDS-ready CSV.
// Kept out of the page so the balance arithmetic is unit-testable (the acceptance criterion is that
// the register balance and Batch.qtyOnHand agree after a dispense + return).
import type {
  ControlledRegisterEntry,
  ControlledRegisterKind,
} from '../types/controlledRegister';
import { maskNationalId } from './wasfaty';

export const CONTROLLED_REGISTER_KIND_LABEL: Record<ControlledRegisterKind, string> = {
  opening: 'Opening balance',
  dispense: 'Dispense',
  return: 'Return',
  damage: 'Damage write-off',
  expiry: 'Expiry write-off',
};

export interface ControlledReconciliationRow {
  key: string;
  itemId: string;
  itemNameEn: string;
  itemNameAr: string;
  branchId?: string;
  opening: number;
  inQty: number;
  outQty: number;
  closing: number;
  // Only supplied when reconciling one branch: stock is not tagged by branch, so a comparison
  // across branches would be meaningless.
  stockOnHand?: number;
  variance?: number;
}

function monthOf(entry: ControlledRegisterEntry): string {
  return entry.at.slice(0, 7);
}

export function reconcileControlledRegister(
  entries: ControlledRegisterEntry[],
  month: string,
  branchId?: string,
  stockByItem?: Map<string, number>,
): ControlledReconciliationRow[] {
  const inScope = entries.filter((entry) => (branchId ? entry.branchId === branchId : true));
  const touched = inScope.filter((entry) => monthOf(entry) === month);
  const rows = new Map<string, ControlledReconciliationRow>();

  for (const entry of touched) {
    const key = `${entry.itemId}\u0000${entry.branchId ?? ''}`;
    if (!rows.has(key)) {
      const earlier = inScope
        .filter(
          (candidate) =>
            candidate.itemId === entry.itemId &&
            candidate.branchId === entry.branchId &&
            monthOf(candidate) < month,
        )
        .sort((a, b) => a.at.localeCompare(b.at));
      rows.set(key, {
        key,
        itemId: entry.itemId,
        itemNameEn: entry.itemNameEn,
        itemNameAr: entry.itemNameAr,
        branchId: entry.branchId,
        opening: earlier.length > 0 ? earlier[earlier.length - 1].balanceAfter : 0,
        inQty: 0,
        outQty: 0,
        closing: 0,
      });
    }
    const row = rows.get(key)!;
    if (entry.direction === 'in') row.inQty += entry.baseQty;
    else row.outQty += entry.baseQty;
  }

  for (const row of rows.values()) {
    row.closing = row.opening + row.inQty - row.outQty;
    if (stockByItem) {
      row.stockOnHand = stockByItem.get(row.itemId) ?? 0;
      row.variance = row.closing - row.stockOnHand;
    }
  }

  return [...rows.values()].sort((a, b) => a.itemNameEn.localeCompare(b.itemNameEn));
}

function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const CSV_HEADERS = [
  'Date/time',
  'Type',
  'Item',
  'Arabic name',
  'Batch',
  'Expiry',
  'Qty in',
  'Qty out',
  'Balance',
  'Branch',
  'Prescription no',
  'Prescriber',
  'Patient ID',
  'Invoice no',
  'Return no',
  'Pharmacist',
  'Witness',
  'Reason',
  'Reversal of',
];

// CDS-ready in the practical sense: one row per movement, human-readable type, signed in/out
// columns, the running balance, and every prescription/patient field the regulator asks for. The
// patient ID is masked exactly like the on-screen register - the export is a working document, not
// a place to leak full national IDs.
export function controlledRegisterCsv(
  entries: ControlledRegisterEntry[],
  branchNames: Record<string, string> = {},
): string {
  const lines = [CSV_HEADERS.map(csvCell).join(',')];
  for (const entry of [...entries].sort((a, b) => a.at.localeCompare(b.at))) {
    lines.push(
      [
        entry.at,
        CONTROLLED_REGISTER_KIND_LABEL[entry.kind],
        entry.itemNameEn,
        entry.itemNameAr,
        entry.batchNo ?? '',
        entry.expiryDate ?? '',
        entry.direction === 'in' ? entry.baseQty : '',
        entry.direction === 'out' ? entry.baseQty : '',
        entry.balanceAfter,
        entry.branchId ? branchNames[entry.branchId] ?? entry.branchId : 'Unassigned',
        entry.prescriptionNo ?? '',
        entry.prescriberName ?? '',
        maskNationalId(entry.patientNationalId),
        entry.invoiceNo ?? '',
        entry.returnNo ?? '',
        entry.pharmacist,
        entry.witness ?? '',
        entry.reason ?? '',
        entry.reversalOf ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\r\n');
}
