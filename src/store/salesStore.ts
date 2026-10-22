import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SaleHeader, ReturnHeader } from '../types/sales';
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
    }),
    { name: 'pharmacy-sales' }
  )
);
