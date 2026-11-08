// Vendor + purchase-invoice master. The stock movement itself is NOT duplicated here - each
// invoice line posts through catalogStore's receiveStock ((one ReceivingEvent per line, tagged
// with the invoice number), so batch creation/top-up, the audit log, and the server backup path
// all stay single-sourced. This store only owns the header/lines document layer: vendor master,
// sequential PUR numbers, the vendor-invoice dedup guard, and the posted-invoice history.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PurchaseInvoice, Vendor } from '../types/purchasing';
import { seedVendors } from '../utils/seedData';
import { batchReceiveDiscount, nextVendorNumber } from '../utils/purchasing';
import { mergeVendorMaster } from '../utils/vendors';
import { useCatalogStore } from './catalogStore';

interface PurchasingState {
  vendors: Vendor[];
  invoices: PurchaseInvoice[];
  // Same satisfied-by-recording pattern as salesStore's simplified/standard counters - nextPurchaseNo
  // only previews the next number; receivePurchaseInvoice bumps it.
  invoiceCounter: number;
  // Preview of the next system-assigned vendor number; addVendor assigns it for real. Same
  // satisfied-by-recording pattern as nextPurchaseNo below.
  nextVendorNo: () => string;
  addVendor: (input: Omit<Vendor, 'id' | 'vendorNo'>) => Vendor;
  // vendorNo is deliberately not patchable - it is the key purchase invoices and item-master rows
  // store, so renaming a vendor must never rewrite history or the catalogue link.
  updateVendor: (id: string, input: Partial<Omit<Vendor, 'id' | 'vendorNo'>>) => void;
  removeVendor: (id: string) => void;
  nextPurchaseNo: () => string;
  // The paper invoice's supplier number is the practical dedup key (this app's PUR number is
  // generated here and means nothing to the vendor) - re-entering the same vendor + vendor invoice
  // number is almost always an accidental double-post of the same delivery.
  isVendorInvoiceNoUsed: (vendorId: string, vendorInvoiceNo: string) => boolean;
  receivePurchaseInvoice: (invoice: PurchaseInvoice) => void;
}

export const usePurchasingStore = create<PurchasingState>()(
  persist(
    (set, get) => ({
      vendors: seedVendors,
      invoices: [],
      invoiceCounter: 0,

      nextVendorNo: () => nextVendorNumber(get().vendors),

      addVendor: (input) => {
        // The vendor number is derived from the highest existing one, never user input - so it
        // stays unique and gap-free even if vendors are added in quick succession.
        const vendor: Vendor = {
          ...input,
          id: `ven-${Date.now()}`,
          vendorNo: nextVendorNumber(get().vendors),
          updatedAt: new Date().toISOString(),
        };
        set((s) => ({ vendors: [...s.vendors, vendor] }));
        return vendor;
      },

      updateVendor: (id, input) => {
        set((s) => ({
          vendors: s.vendors.map((v) =>
            v.id === id ? { ...v, ...input, vendorNo: v.vendorNo, updatedAt: new Date().toISOString() } : v
          ),
        }));
      },

      removeVendor: (id) => {
        set((s) => ({ vendors: s.vendors.filter((v) => v.id !== id) }));
      },

      nextPurchaseNo: () => `PUR-${String(get().invoiceCounter + 1).padStart(6, '0')}`,

      isVendorInvoiceNoUsed: (vendorId, vendorInvoiceNo) =>
        get().invoices.some(
          (i) => i.vendorId === vendorId && i.vendorInvoiceNo === vendorInvoiceNo.trim()
        ),

      receivePurchaseInvoice: (invoice) => {
        // Post the stock first, then record the document. The item-existence check up front keeps
        // this all-or-nothing-ish: a line whose item vanished from the catalog (a  reset, a
        // stale localStorage merge, etc.) would otherwise record an invoice whose lines silently
        // never reached stock - composite receipted documents shouldn't half-post.
        for (const line of invoice.lines) {
          if (!useCatalogStore.getState().itemById(line.itemId)) {
            throw new Error(
              `Item ${line.itemNameEn} (${line.itemId}) is not in the catalog - invoice ${invoice.invoiceNo} was not posted to stock.`
            );
          }
          useCatalogStore.getState().receiveStock({
            itemId: line.itemId,
            batchNo: line.batchNo,
            expiryDate: line.expiryDate,
            // qty is the PHYSICAL units (paid + free goods) - both land on the shelf.
            qty: line.qty + line.bonusQty,
            // Line price is what the batch records (the discount arrives pre-diluted below).
            purchasePrice: line.unitPurchasePrice,
            // Single fraction carrying the tier discount AND the free-goods dilution, so the
            // batch's costPrice reproduces the legacy FQTYITEM.NET_PUR_PRICE = net/(paid+bonus).
            purchaseDiscountPercent: batchReceiveDiscount(
              line.netExclVat,
              line.totalQty,
              line.unitPurchasePrice
            ),
            source: 'vendor',
            purchaseInvoiceNo: invoice.invoiceNo,
            bonusQty: line.bonusQty || undefined,
            packLevel: line.packLevel,
          });
        }
        set((s) => ({
          invoices: [...s.invoices, invoice],
          invoiceCounter: s.invoiceCounter + 1,
        }));
      },
    }),
    {
      name: 'pharmacy-purchasing',
      // Same merge philosophy as catalogStore's comment: keep persisted vendors/invoices, but
      // append any NEW seed vendor so an existing browser session (localStorage already saved)
      // still sees freshly added seed entries.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PurchasingState>;
        // Vendor merge: keep owner edits, backfill numbering on pre-number rows, fill new
        // vendor-file fields on seed rows, and append any NEW seed vendor. Shared pure helper so
        // the rule is unit-tested without touching localStorage.
        const persistedVendors = mergeVendorMaster(p.vendors, current.vendors);
        // Invoices saved before the multi-tier/bonus fields existed (Phase 1 of the legacy-parity
        // work) carry only the single purchaseDiscountPercent - backfill the derived slots so
        // history rows don't render `undefined.toFixed` in the page/dialog. They never had tiers
        // to lose, so tier amounts stay 0 and the old fraction is preserved as identity.
        const persistedInvoices = (p.invoices ?? current.invoices).map((inv) => ({
          ...inv,
          totalBonusValue: inv.totalBonusValue ?? 0,
          lines: inv.lines.map((l) => ({
            ...l,
            bonusQty: l.bonusQty ?? 0,
            totalQty: l.totalQty ?? l.qty,
            bonusValue: l.bonusValue ?? 0,
            discount1Percent: l.discount1Percent ?? l.purchaseDiscountPercent ?? 0,
            discount2Percent: l.discount2Percent ?? 0,
            discount3Percent: l.discount3Percent ?? 0,
            discount1Amount: l.discount1Amount ?? 0,
            discount2Amount: l.discount2Amount ?? 0,
            discount3Amount: l.discount3Amount ?? 0,
            discountTotal: l.discountTotal ?? 0,
          })),
        }));
        return {
          ...current,
          ...p,
          vendors: persistedVendors,
          invoices: persistedInvoices,
        };
      },
    }
  )
);
