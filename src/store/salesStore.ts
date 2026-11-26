import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SaleHeader, ReturnHeader } from '../types/sales';
import type { DosageSnapshot } from '../types/dosage';
import type { WasfatyDispenseInfo } from '../types/wasfaty';
import { backupSale, backupReturn } from '../api/salesApi';
import { usePendingSyncStore } from './pendingSyncStore';
import { useRsdOutboxStore } from './rsdOutboxStore';
import { useSettingsStore } from './settingsStore';
import { branchNumberPrefix } from '../utils/invoiceNumber';
import {
  LEGACY_BRANCH_ID,
  branchIdOf,
  currentBranchId,
  stampBranch,
} from '../utils/branchScope';

// Only these fields may be changed by a ZATCA submission/retry. The rest of a sale is a frozen
// legal record; a retry must never be able to touch prices, lines, the customer or the tender.
type ZatcaEvidencePatch = Partial<Pick<
  SaleHeader,
  'zatcaStatus' | 'zatcaQrBase64' | 'zatcaUuid' | 'zatcaIcv' |
  'zatcaInvoiceHashBase64' | 'zatcaSubmittedAt' | 'zatcaEnvironment' | 'zatcaFailureReason'
>>;

interface BranchSaleCounter {
  simplified: number;
  standard: number;
}

// Old localStorage had one global SIM/STD counter for the demo register. Keep it as the RIY
// counter; every other branch starts at 1 so PH001 does not inherit SIM-000016 from RIY.
function counterForBranch(
  counters: Record<string, BranchSaleCounter> | undefined,
  branchId: string,
  legacy: BranchSaleCounter,
): BranchSaleCounter {
  // The global counters remain authoritative for the original register; branchCounters only
  // track terminals configured after branch scoping was added.
  if (branchId === LEGACY_BRANCH_ID) return legacy;
  return counters?.[branchId] ?? { simplified: 0, standard: 0 };
}

function bumpBranchCounter(
  counters: Record<string, BranchSaleCounter> | undefined,
  branchId: string,
  invoiceType: SaleHeader['invoiceType'],
): Record<string, BranchSaleCounter> {
  const next = { ...(counters ?? {}) };
  const current = next[branchId] ?? { simplified: 0, standard: 0 };
  next[branchId] =
    invoiceType === 'simplified'
      ? { ...current, simplified: current.simplified + 1 }
      : { ...current, standard: current.standard + 1 };
  return next;
}

interface SalesState {
  invoices: SaleHeader[];
  returns: ReturnHeader[];
  simplifiedCounter: number;
  standardCounter: number;
  // Per-branch sequences. Old installs only had the two global counters above, which are retained
  // as the RIY (cc-br-001) sequence for backward compatibility.
  branchCounters?: Record<string, BranchSaleCounter>;
  nextInvoiceNo: (invoiceType: SaleHeader['invoiceType']) => string;
  recordSale: (invoice: SaleHeader) => void;
  recordReturn: (ret: ReturnHeader, updatedInvoice: SaleHeader) => void;
  invoiceByNo: (invoiceNo: string) => SaleHeader | undefined;
  // ZATCA Phase 2 evidence is written to an invoice AFTER it exists - the resubmission flow can
  // only learn the UUID/ICV/hash by asking ZATCA about a document that was already issued. Scoped
  // to the ZATCA fields so a retry can never touch prices, lines or the customer.
  updateInvoiceZatca: (invoiceId: string, patch: ZatcaEvidencePatch) => void;
  // A return is submitted to ZATCA as a credit note. It gets the same scoped evidence update as the
  // original sale, but lives on the ReturnHeader so a refund never rewrites the issued invoice.
  updateReturnZatca: (returnId: string, patch: ZatcaEvidencePatch) => void;
  // Directions are chosen on the post-payment screen (after the money is settled, before the
  // receipt prints), so they are written onto the already-recorded sale. Only the clinical
  // annotation changes: prices, VAT, payments, ZATCA evidence and customer are never touched, and
  // DOS is not part of the UBL tax document, so an invoice already submitted stays valid.
  updateInvoiceDosages: (
    invoiceId: string,
    patches: { lineId: string; dosage?: DosageSnapshot }[],
  ) => void;
  // The local sale is issued before the Wasfaty server has answered (a dispense must never be
  // blocked by that server being down). When the server later returns the NUPCO dispense id or the
  // authorization state, only the operational `wasfaty` block is patched - prices, payments, VAT
  // and the ZATCA document are already final and must not move.
  patchInvoiceWasfaty: (invoiceId: string, patch: Partial<WasfatyDispenseInfo>) => void;
}

export const useSalesStore = create<SalesState>()(
  persist(
    (set, get) => ({
      invoices: [],
      returns: [],
      simplifiedCounter: 0,
      standardCounter: 0,
      branchCounters: {},

      nextInvoiceNo: (invoiceType) => {
        const typePrefix = invoiceType === 'simplified' ? 'SIM' : 'STD';
        const state = get();
        const counter = counterForBranch(state.branchCounters, currentBranchId(), {
          simplified: state.simplifiedCounter,
          standard: state.standardCounter,
        });
        const n = invoiceType === 'simplified' ? counter.simplified + 1 : counter.standard + 1;
        return `${branchNumberPrefix()}${typePrefix}-${String(n).padStart(6, '0')}`;
      },

      recordSale: (invoice) => {
        const stamped = stampBranch(invoice);
        set((s) => ({
          invoices: [...s.invoices, stamped],
          // Legacy counters keep moving only for the old RIY register; the per-branch sequence is
          // the source of truth for the number that was just issued.
          simplifiedCounter:
            stamped.invoiceType === 'simplified' && branchIdOf(stamped) === LEGACY_BRANCH_ID
              ? s.simplifiedCounter + 1
              : s.simplifiedCounter,
          standardCounter:
            stamped.invoiceType === 'standard' && branchIdOf(stamped) === LEGACY_BRANCH_ID
              ? s.standardCounter + 1
              : s.standardCounter,
          branchCounters: bumpBranchCounter(s.branchCounters, branchIdOf(stamped), stamped.invoiceType),
        }));
        // Local save above already happened and is the record of truth - this is a best-effort
        // backup to this app's own database (see api/salesApi.ts). A sale must never fail or wait
        // on this, so it's fire-and-forget; a failure here (server down, DB not set up yet) is
        // queued for retry rather than just logged and forgotten, so the SQL mirror's batch
        // quantities don't permanently drift just because the server happened to be down for this
        // one sale (see store/pendingSyncStore.ts).
        backupSale(stamped).catch((err) => {
          console.warn('Sale backup failed, queued for retry:', err);
          usePendingSyncStore.getState().enqueue({ kind: 'sale', payload: stamped });
        });
        // SFDA RSD: enqueue the serialised DRUG packs on this invoice and let the outbox send them
        // in the background. Item Master's "Batch / expiry tracking" switch is the drug gate (see
        // utils/rsdUnits.ts), so supplies are skipped. This never blocks or fails the sale.
        // Reporting is opt-in: with RSD off in Settings the sale is still recorded exactly as
        // before, it simply is not a national movement this register is responsible for.
        if (useSettingsStore.getState().settings.rsdEnabled === true) {
          useRsdOutboxStore.getState().enqueueSale(stamped);
        }
      },

      recordReturn: (ret, updatedInvoice) => {
        // A credit note belongs to the branch of the sale it reverses, not to whichever terminal
        // happens to be open now - the return screen only offers invoices from this branch.
        const branchId = branchIdOf(updatedInvoice);
        const stampedReturn = stampBranch(ret, branchId);
        const stampedInvoice = stampBranch(updatedInvoice, branchId);
        set((s) => ({
          returns: [...s.returns, stampedReturn],
          invoices: s.invoices.map((inv) => (inv.id === stampedInvoice.id ? stampedInvoice : inv)),
        }));
        const returnPayload = {
          ret: stampedReturn,
          updatedInvoiceStatus: stampedInvoice.status,
          updatedInvoicePointsEarnedClawedBack: stampedInvoice.pointsEarnedClawedBack,
          updatedInvoiceTotalIncentiveClawedBack: stampedInvoice.totalIncentiveClawedBack,
          updatedInvoicePointsRedeemedRefunded: stampedInvoice.pointsRedeemedRefunded,
          updatedLineReturnedQtys: stampedInvoice.lines.map((l) => ({ lineId: l.id, returnedQty: l.returnedQty })),
        };
        backupReturn(returnPayload).catch((err) => {
          console.warn('Return backup failed, queued for retry:', err);
          usePendingSyncStore.getState().enqueue({ kind: 'return', payload: returnPayload });
        });
        // RSD treats a full return as the cancellation of that pack. Only lines this return took
        // all the way back are enqueued; a partial return cannot say which serial came back.
        // Like sales, this only runs when RSD reporting is enabled on this register.
        if (useSettingsStore.getState().settings.rsdEnabled === true) {
          useRsdOutboxStore.getState().enqueueReturn(
            stampedInvoice,
            stampedReturn.lines.map((line) => line.saleLineId),
            stampedReturn.reason,
          );
        }
      },

      // Returns must not be able to reverse another branch's invoice by typing its number.
      invoiceByNo: (invoiceNo) =>
        get().invoices.find((i) => i.invoiceNo === invoiceNo && branchIdOf(i) === currentBranchId()),

      updateInvoiceZatca: (invoiceId, patch) => {
        set((s) => ({
          invoices: s.invoices.map((inv) => (inv.id === invoiceId ? { ...inv, ...patch } : inv)),
        }));
        // The SQL mirror is a best-effort backup of the SALE; a later ZATCA status change is a
        // local compliance record and is deliberately not pushed there (see api/salesApi.ts),
        // so this never queues a retry or blocks the UI.
      },

      updateReturnZatca: (returnId, patch) => {
        set((s) => ({
          returns: s.returns.map((ret) => (ret.id === returnId ? { ...ret, ...patch } : ret)),
        }));
      },

      updateInvoiceDosages: (invoiceId, patches) => {
        // `has` rather than a truthy check: clearing a line's directions (undefined) is a real
        // edit and must be applied, not mistaken for "no patch for this line".
        const dosageByLine = new Map(patches.map((patch) => [patch.lineId, patch.dosage]));
        set((s) => ({
          invoices: s.invoices.map((inv) =>
            inv.id === invoiceId
              ? {
                  ...inv,
                  lines: inv.lines.map((line) =>
                    dosageByLine.has(line.id) ? { ...line, dosage: dosageByLine.get(line.id) } : line,
                  ),
                }
              : inv,
          ),
        }));
        // Not pushed to the SQL mirror: the server's sale schema stores the tax document, and DOS
        // is patient guidance rather than an invoiced fact. The local sale is the source for
        // reprints (see DosagePrintView), exactly like the checkout-time snapshot.
      },

      patchInvoiceWasfaty: (invoiceId, patch) => {
        set((s) => ({
          invoices: s.invoices.map((inv) =>
            inv.id === invoiceId && inv.wasfaty
              ? { ...inv, wasfaty: { ...inv.wasfaty, ...patch } }
              : inv,
          ),
        }));
      },
    }),
    {
      name: 'pharmacy-sales',
      version: 4,
      // Sales saved before Phase 2 existed have no `zatcaStatus`. Without this back-fill the
      // invoices ledger dereferences `ZATCA_STATUS_LABEL[undefined]` and crashes the whole tab on
      // an upgraded install. Those sales did carry the 5-field Phase 1 QR, so "Phase 1 only" is
      // the honest status: accepted locally, still awaiting a Phase 2 submission.
      // Returns gained credit-note evidence in v3; older refunds were never submitted to ZATCA, so
      // they start as "Not submitted" rather than being falsely marked accepted.
      migrate: (persisted, _version) => {
        const state = (persisted ?? {}) as Partial<SalesState>;
        return {
          ...state,
          invoices: (state.invoices ?? []).map((invoice) => ({
            ...invoice,
            zatcaStatus: invoice.zatcaStatus ?? 'phase1_fallback',
            // Everything persisted before v4 came from the original unconfigured RIY register.
            branchId: invoice.branchId ?? LEGACY_BRANCH_ID,
          })),
          returns: (state.returns ?? []).map((ret) => ({
            ...ret,
            zatcaStatus: ret.zatcaStatus ?? 'pending_submission',
            branchId: ret.branchId ?? LEGACY_BRANCH_ID,
          })),
          simplifiedCounter: state.simplifiedCounter ?? 0,
          standardCounter: state.standardCounter ?? 0,
          branchCounters: state.branchCounters ?? {
            [LEGACY_BRANCH_ID]: {
              simplified: state.simplifiedCounter ?? 0,
              standard: state.standardCounter ?? 0,
            },
          },
        } as SalesState;
      },
    }
  )
);
