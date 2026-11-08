import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SaleHeader, ReturnHeader } from '../types/sales';
import type { DosageSnapshot } from '../types/dosage';
import type { WasfatyDispenseInfo } from '../types/wasfaty';
import { backupSale, backupReturn } from '../api/salesApi';
import { usePendingSyncStore } from './pendingSyncStore';

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
  updateInvoiceZatca: (invoiceId: string, patch: Partial<SaleHeader>) => void;
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
          updatedInvoicePointsRedeemedRefunded: updatedInvoice.pointsRedeemedRefunded,
          updatedLineReturnedQtys: updatedInvoice.lines.map((l) => ({ lineId: l.id, returnedQty: l.returnedQty })),
        };
        backupReturn(returnPayload).catch((err) => {
          console.warn('Return backup failed, queued for retry:', err);
          usePendingSyncStore.getState().enqueue({ kind: 'return', payload: returnPayload });
        });
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
    { name: 'pharmacy-sales' }
  )
);
