// Vendor + purchase-invoice master. The stock movement itself is NOT duplicated here - each
// invoice line posts through catalogStore's receiveStock ((one ReceivingEvent per line, tagged
// with the invoice number), so batch creation/top-up, the audit log, and the server backup path
// all stay single-sourced. This store only owns the header/lines document layer: vendor master,
// sequential PUR numbers, the vendor-invoice dedup guard, and the posted-invoice history.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PurchaseInvoice, Vendor } from '../types/purchasing';
import { PARTY_TYPE_FLAG } from '../types/party';
import { seedVendors } from '../utils/seedData';
import { batchReceiveDiscount, nextCustomerNumber, nextVendorNumber } from '../utils/purchasing';
import { mergeVendorMaster } from '../utils/vendors';
import { useCatalogStore } from './catalogStore';

interface PurchasingState {
  // The FCODCSVN-style party table: vendors (type_flag 1) and business customers (type_flag 2)
  // share this array and its vendor-file fields. Kept under the historical `vendors` name so the
  // persisted localStorage shape needs no migration; read it through utils/party.ts.
  vendors: Vendor[];
  invoices: PurchaseInvoice[];
  // Same satisfied-by-recording pattern as salesStore's simplified/standard counters - nextPurchaseNo
  // only previews the next number; receivePurchaseInvoice bumps it.
  invoiceCounter: number;
  // Returns have their own gap-free sequence (RET-000001...). Posting a return must never consume
  // a PUR number, or the purchase sequence would skip one for every credit note.
  returnCounter: number;
  // Preview of the next system-assigned number on each side; addVendor/addCustomer assigns it for
  // real. Same satisfied-by-recording pattern as nextPurchaseNo below.
  nextVendorNo: () => string;
  nextCustomerNo: () => string;
  addVendor: (input: Omit<Vendor, 'id' | 'vendorNo' | 'typeFlag'>) => Vendor;
  addCustomer: (input: Omit<Vendor, 'id' | 'vendorNo' | 'typeFlag'>) => Vendor;
  // vendorNo is deliberately not patchable - it is the key purchase invoices and item-master rows
  // store, so renaming a party must never rewrite history or the catalogue link. typeFlag is
  // equally fixed: a row is created as one side and never reclassified in place.
  updateVendor: (id: string, input: Partial<Omit<Vendor, 'id' | 'vendorNo' | 'typeFlag'>>) => void;
  removeVendor: (id: string) => void;
  nextPurchaseNo: () => string;
  nextReturnNo: () => string;
  // The paper invoice's supplier number is the practical dedup key (this app's PUR number is
  // generated here and means nothing to the vendor) - re-entering the same vendor + vendor invoice
  // number is almost always an accidental double-post of the same delivery.
  isVendorInvoiceNoUsed: (vendorId: string, vendorInvoiceNo: string, excludeInvoiceId?: string) => boolean;
  receivePurchaseInvoice: (invoice: PurchaseInvoice) => void;
  // Modify/delete a posted invoice. Stock is reversed through catalogStore first, so a change is
  // refused when part of the delivery has already been sold (see reversePurchaseInvoice).
  // invoiceNo and id stay fixed on modify; the PUR sequence is never reused.
  updatePurchaseInvoice: (id: string, invoice: PurchaseInvoice) => void;
  deletePurchaseInvoice: (id: string) => void;
  receiveReturnInvoice: (invoice: PurchaseInvoice) => void;
}

// Posts every line of an invoice into stock through catalogStore's receiveStock, so batch
// creation/top-up, the audit log and the server backup path stay single-sourced. Validates all
// items up front: a line whose item vanished from the catalog would otherwise record an invoice
// whose lines silently never reached stock.
function postInvoiceStock(invoice: PurchaseInvoice): void {
  for (const line of invoice.lines) {
    if (!useCatalogStore.getState().itemById(line.itemId)) {
      throw new Error(
        `Item ${line.itemNameEn} (${line.itemId}) is not in the catalog - invoice ${invoice.invoiceNo} was not posted to stock.`
      );
    }
  }
  for (const line of invoice.lines) {
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
}


// Reverses the stock for a previously-posted invoice by walking every line backward through
// catalogStore.receiveStock with negated quantities (paid+bonus). Refused when part of the
// delivery has already been sold or moved - see catalogStore's own guard. After stock reversal
// the invoice record stays in history with its id/invoiceNo unchanged so the audit trail is
// preserved; a separate credit-note document can then be posted if desired.

// Only a change to the lines (item, qty, batch, price, discount) touches stock; correcting the
// party, date or notes must not churn the receiving log.
function sameStockLines(a: PurchaseInvoice, b: PurchaseInvoice): boolean {
  if (a.lines.length !== b.lines.length) return false;
  return a.lines.every((line, i) => JSON.stringify(line) === JSON.stringify(b.lines[i]));
}

export const usePurchasingStore = create<PurchasingState>()(
  persist(
    (set, get) => ({
      vendors: seedVendors,
      invoices: [],
      invoiceCounter: 0,
      returnCounter: 0,

      nextVendorNo: () => nextVendorNumber(get().vendors),
      nextCustomerNo: () => nextCustomerNumber(get().vendors),

      addVendor: (input) => {
        // The vendor number is derived from the highest existing one, never user input - so it
        // stays unique and gap-free even if vendors are added in quick succession.
        const vendor: Vendor = {
          ...input,
          // This side of the table is always a supplier, whatever the caller passes.
          typeFlag: PARTY_TYPE_FLAG.vendor,
          id: `ven-${Date.now()}`,
          vendorNo: nextVendorNumber(get().vendors),
          updatedAt: new Date().toISOString(),
        };
        set((s) => ({ vendors: [...s.vendors, vendor] }));
        return vendor;
      },

      addCustomer: (input) => {
        // Customer accounts share the vendor-file fields but get their own CUS- sequence.
        const customer: Vendor = {
          ...input,
          typeFlag: PARTY_TYPE_FLAG.customer,
          id: `cus-acc-${Date.now()}`,
          vendorNo: nextCustomerNumber(get().vendors),
          updatedAt: new Date().toISOString(),
        };
        set((s) => ({ vendors: [...s.vendors, customer] }));
        return customer;
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
      nextReturnNo: () => `RET-${String(get().returnCounter + 1).padStart(6, '0')}`,

      isVendorInvoiceNoUsed: (vendorId, vendorInvoiceNo, excludeInvoiceId) =>
        get().invoices.some(
          (i) =>
            i.id !== excludeInvoiceId &&
            i.vendorId === vendorId &&
            i.vendorInvoiceNo === vendorInvoiceNo.trim()
        ),

      receivePurchaseInvoice: (invoice) => {
        // Post the stock first, then record the document (see postInvoiceStock's all-or-nothing
        // item check).
        postInvoiceStock(invoice);
        set((s) => ({
          invoices: [...s.invoices, invoice],
          invoiceCounter: s.invoiceCounter + 1,
        }));
      },

      updatePurchaseInvoice: (id, invoice) => {
        const existing = get().invoices.find((i) => i.id === id);
        if (!existing) throw new Error(`Purchase invoice ${id} is no longer in the history.`);
        // Validate the replacement's items before any stock moves, so a bad edit cannot leave the
        // old receipt reversed and the new one unposted.
        for (const line of invoice.lines) {
          if (!useCatalogStore.getState().itemById(line.itemId)) {
            throw new Error(
              `Item ${line.itemNameEn} (${line.itemId}) is not in the catalog - invoice ${existing.invoiceNo} was not changed.`
            );
          }
        }
        if (!sameStockLines(existing, invoice)) {
          // Refuses when part of the old delivery has already been sold - see catalogStore.
          useCatalogStore.getState().reversePurchaseInvoice(existing.invoiceNo);
          postInvoiceStock(invoice);
        }
        set((s) => ({
          invoices: s.invoices.map((i) =>
            i.id === id
              // Identity and system number stay fixed: they key the stock receipt and the history.
              ? { ...invoice, id: existing.id, invoiceNo: existing.invoiceNo }
              : i
          ),
        }));
      },

      deletePurchaseInvoice: (id) => {
        const existing = get().invoices.find((i) => i.id === id);
        if (!existing) return;
        // Throws (and leaves both the invoice and stock untouched) when the delivery has already
        // been partly sold or moved.
        useCatalogStore.getState().reversePurchaseInvoice(existing.invoiceNo);
        set((s) => ({ invoices: s.invoices.filter((i) => i.id !== id) }));
      },
      receiveReturnInvoice: (invoice) => {
        // Validate items before reversing
        for (const line of invoice.lines) {
          if (!useCatalogStore.getState().itemById(line.itemId)) {
            throw new Error(
              'Item ' + line.itemNameEn + ' (' + line.itemId + ') is not in the catalog - return ' + invoice.invoiceNo + ' cannot be posted.'
            );
          }
        }

        // A purchase return takes goods OFF the shelf and sends them back to the supplier. Refuse
        // before moving anything when the batch is not in stock or no longer holds what the return
        // asks for - otherwise the return would create negative stock. Same rule the invoice
        // delete/edit path uses, aggregated per item+batch because one return can repeat a lot.
        const requested = new Map<string, { itemId: string; batchNo: string; qty: number }>();
        for (const line of invoice.lines) {
          const key = `${line.itemId}\u0000${line.batchNo}`;
          const qty = line.qty + (line.bonusQty || 0);
          const current = requested.get(key);
          if (current) current.qty += qty;
          else requested.set(key, { itemId: line.itemId, batchNo: line.batchNo, qty });
        }
        for (const { itemId, batchNo, qty } of requested.values()) {
          const batch = useCatalogStore.getState().batches.find((b) => b.itemId === itemId && b.batchNo === batchNo);
          if (!batch) {
            throw new Error(
              `Batch ${batchNo} is not in stock - return ${invoice.invoiceNo} cannot be posted.`
            );
          }
          if (batch.qtyOnHand + 1e-9 < qty) {
            throw new Error(
              `Batch ${batchNo} has ${batch.qtyOnHand} on hand but the return asks for ${qty}. ` +
              `Only goods still in stock can be returned; return ${invoice.invoiceNo} was not posted.`
            );
          }
        }

        // Reverse stock: negate quantities (physical and bonus)
        for (const line of invoice.lines) {
          useCatalogStore.getState().receiveStock({
            itemId: line.itemId,
            batchNo: line.batchNo,
            expiryDate: line.expiryDate,
            qty: -(line.qty + line.bonusQty),
            purchasePrice: line.unitPurchasePrice,
            purchaseDiscountPercent: batchReceiveDiscount(
              line.netExclVat,
              line.totalQty,
              line.unitPurchasePrice
            ),
            source: 'vendor',
            purchaseInvoiceNo: invoice.invoiceNo,
            bonusQty: -(line.bonusQty || 0),
            packLevel: line.packLevel,
          });
        }

        set((s) => ({
          invoices: [...s.invoices, invoice],
          returnCounter: s.returnCounter + 1,
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
          // Invoices posted before the party picker could switch sides came from a vendor.
          partyType: inv.partyType ?? PARTY_TYPE_FLAG.vendor,
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
        // Returns persisted before they had their own counter were saved with a 13-digit
        // RET-<timestamp> number. Only the new gap-free RET-000001 shape may drive the backfill -
        // matching a timestamp would set the counter to an absurd value and stall the sequence.
        const maxReturnNo = persistedInvoices.reduce((max, inv) => {
          const match = inv.isReturn ? /^RET-(\d{6})$/.exec(inv.invoiceNo) : null;
          return match ? Math.max(max, Number(match[1])) : max;
        }, 0);
        return {
          ...current,
          ...p,
          vendors: persistedVendors,
          invoices: persistedInvoices,
          // Keep the persisted counter when it is ahead (a return may have been deleted), and
          // never recompute invoiceCounter downward - deleted purchases must not reuse PUR numbers.
          returnCounter: Math.max(p.returnCounter ?? 0, maxReturnNo),
        };
      },
    }
  )
);
