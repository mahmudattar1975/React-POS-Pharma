// Local controlled-drug register. Same local-first zustand + persist pattern as the prescription
// registry and sales store: no backend is involved, and the CSV export is the paper/regulator
// hand-off.
//
// The register is written by the same call sites that move stock (POS dispense, Returns, the
// write-off dialog), immediately BEFORE the batch quantity changes. That ordering lets the first
// movement of an item in a branch seed an `opening` row from the stock actually on the shelf, so
// the running balance and Batch.qtyOnHand start from the same number and stay comparable.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ControlledMovementInput,
  ControlledRegisterDirection,
  ControlledRegisterEntry,
} from '../types/controlledRegister';
import { useCatalogStore } from './catalogStore';
import { currentBranchId, rowsForBranch } from '../utils/branchScope';

interface ControlledRegisterState {
  entries: ControlledRegisterEntry[];
  // Appends the opening row (only for the first movement of an item in a branch) plus the movement
  // row, and returns the rows it added. Callers move the stock themselves, before/after this call
  // as documented above.
  recordMovement: (input: ControlledMovementInput) => ControlledRegisterEntry[];
}

function directionFor(input: ControlledMovementInput): ControlledRegisterDirection {
  if (input.direction) return input.direction;
  return input.kind === 'return' ? 'in' : 'out';
}

function stockOnHand(itemId: string): number {
  // The register's `branchId` field is a cost-center id; stock ownership follows the terminal's
  // configured branch, which is what Batch.branchId records.
  return rowsForBranch(useCatalogStore.getState().batches, currentBranchId())
    .filter((batch) => batch.itemId === itemId)
    .reduce((sum, batch) => sum + batch.qtyOnHand, 0);
}

export const useControlledRegisterStore = create<ControlledRegisterState>()(
  persist(
    (set, get) => ({
      entries: [],

      recordMovement: (input) => {
        const qty = Math.abs(input.baseQty);
        if (!(qty > 0)) return [];

        const at = input.at ?? new Date().toISOString();
        const direction = directionFor(input);
        const scope = get().entries.filter(
          (entry) => entry.itemId === input.itemId && entry.branchId === input.branchId,
        );

        // First movement of this item in this branch: record what was already on the shelf, so the
        // log starts from a real balance instead of zero (which would read as an unexplained gain).
        const opening: ControlledRegisterEntry | null =
          scope.length === 0
            ? {
                id: `creg-${crypto.randomUUID()}`,
                at,
                kind: 'opening',
                direction: 'in',
                itemId: input.itemId,
                itemNameEn: input.itemNameEn,
                itemNameAr: input.itemNameAr,
                batchNo: input.batchNo,
                expiryDate: input.expiryDate,
                baseQty: stockOnHand(input.itemId),
                balanceAfter: stockOnHand(input.itemId),
                branchId: input.branchId,
                pharmacist: input.pharmacist,
                reason: 'Opening balance from stock on hand',
              }
            : null;

        const balanceBefore = opening ? opening.baseQty : scope[scope.length - 1].balanceAfter;
        const delta = direction === 'in' ? qty : -qty;

        // A return should point at what it reverses even when the caller does not know the row id.
        const reversalOf =
          input.reversalOf ??
          (input.kind === 'return' && input.invoiceId && input.saleLineId
            ? [...get().entries]
                .reverse()
                .find(
                  (entry) =>
                    entry.kind === 'dispense' &&
                    entry.invoiceId === input.invoiceId &&
                    entry.saleLineId === input.saleLineId,
                )?.id
            : undefined);

        const entry: ControlledRegisterEntry = {
          id: `creg-${crypto.randomUUID()}`,
          at,
          kind: input.kind,
          direction,
          itemId: input.itemId,
          itemNameEn: input.itemNameEn,
          itemNameAr: input.itemNameAr,
          batchNo: input.batchNo,
          expiryDate: input.expiryDate,
          baseQty: qty,
          balanceAfter: balanceBefore + delta,
          branchId: input.branchId,
          prescriptionId: input.prescriptionId,
          prescriptionNo: input.prescriptionNo,
          prescriberName: input.prescriberName,
          patientNationalId: input.patientNationalId,
          invoiceId: input.invoiceId,
          invoiceNo: input.invoiceNo,
          saleLineId: input.saleLineId,
          returnNo: input.returnNo,
          pharmacist: input.pharmacist,
          witness: input.witness,
          reason: input.reason,
          reversalOf,
        };

        set((state) => ({ entries: opening ? [...state.entries, opening, entry] : [...state.entries, entry] }));
        return opening ? [opening, entry] : [entry];
      },
    }),
    { name: 'pharmacy-controlled-register' },
  ),
);
