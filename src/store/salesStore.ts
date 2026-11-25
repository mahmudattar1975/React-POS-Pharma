import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SaleHeader, ReturnHeader } from '../types/sales';
import type { DosageSnapshot } from '../types/dosage';
import type { WasfatyDispenseInfo } from '../types/wasfaty';
import { backupSale, backupReturn } from '../api/salesApi';
import { usePendingSyncStore } from './pendingSyncStore';
import { useRsdOutboxStore } from './rsdOutboxStore';
import { useSettingsStore } from './settingsStore';

// Only these fields may be changed by a ZATCA submission/retry. The rest of a sale is a frozen
// legal record; a retry must never be able to touch prices, lines, the customer or the tender.
type ZatcaEvidencePatch = Partial<Pick<
  SaleHeader,
  'zatcaStatus' | 'zatcaQrBase64' | 'zatcaUuid' | 'zatcaIcv' |
  'zatcaInvoiceHashBase64' | 'zatcaSubmittedAt' | 'zatcaEnvironment' | 'zatcaFailureReason'
>>;

interface SalesState {
  invoices: SaleHeader[];
  returns: ReturnHeader[];
  simplifiedCounter: number;
  standardCounter: number;
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

      nextInvoiceNo: (invoiceType) => {
        const prefix = invoiceType === 'simplified' ? 'SIM' : 'STD';
        const n = invoiceType === 'simplified' ? get().simplifiedCounter + 1 : get().standardCounter + 1;
        return `${prefix}-${String(n).padStart(6, '0')}`;
      },

      recordSale: (invoice) => {
        set((s) => ({
          invoices: [...s.invoices, invoice],
          simplifiedCounter: invoice.invoiceType === 'simplified' ? s.simplifiedCounter + 1 : s.simplifiedCounter,
          standardCounter: invoice.invoiceType === 'standard' ? s.standardCounter + 1 : s.standardCounter,
        }));
        // Local save above already happened and is the record of truth - this is a best-effort
        // backup to this app's own database (see api/salesApi.ts). A sale must never fail or wait
        // on this, so it's fire-and-forget; a failure here (server down, DB not set up yet) is
        // queued for retry rather than just logged and forgotten, so the SQL mirror's batch
        // quantities don't permanently drift just because the server happened to be down for this
        // one sale (see store/pendingSyncStore.ts).
        backupSale(invoice).catch((err) => {
          console.warn('Sale backup failed, queued for retry:', err);
          usePendingSyncStore.getState().enqueue({ kind: 'sale', payload: invoice });
        });
        // SFDA RSD: enqueue the serialised DRUG packs on this invoice and let the outbox send them
        // in the background. Item Master's "Batch / expiry tracking" switch is the drug gate (see
        // utils/rsdUnits.ts), so supplies are skipped. This never blocks or fails the sale.
        // Reporting is opt-in: with RSD off in Settings the sale is still recorded exactly as
        // before, it simply is not a national movement this register is responsible for.
        if (useSettingsStore.getState().settings.rsdEnabled === true) {
          useRsdOutboxStore.getState().enqueueSale(invoice);
        }
      },

      recordReturn: (ret, updatedInvoice) => {
        set((s) => ({
          returns: [...s.returns, ret],
          invoices: s.invoices.map((inv) => (inv.id === updatedInvoice.id ? updatedInvoice : inv)),
        }));
        const returnPayload = {
          ret,
          updatedInvoiceStatus: updatedInvoice.status,
          updatedInvoicePointsEarnedClawedBack: updatedInvoice.pointsEarnedClawedBack,
          updatedInvoiceTotalIncentiveClawedBack: updatedInvoice.totalIncentiveClawedBack,
          updatedInvoicePointsRedeemedRefunded: updatedInvoice.pointsRedeemedRefunded,
          updatedLineReturnedQtys: updatedInvoice.lines.map((l) => ({ lineId: l.id, returnedQty: l.returnedQty })),
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
            updatedInvoice,
            ret.lines.map((line) => line.saleLineId),
            ret.reason,
          );
        }
      },

      invoiceByNo: (invoiceNo) => get().invoices.find((i) => i.invoiceNo === invoiceNo),

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
      version: 3,
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
          })),
          returns: (state.returns ?? []).map((ret) => ({
            ...ret,
            zatcaStatus: ret.zatcaStatus ?? 'pending_submission',
          })),
          simplifiedCounter: state.simplifiedCounter ?? 0,
          standardCounter: state.standardCounter ?? 0,
        } as SalesState;
      },
    }
  )
);
