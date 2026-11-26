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
import { batchReceiveDiscount, nextCustomerNumber, nextVendorNumber, purchaseReturnLineKey, returnedQuantitiesByLine } from '../utils/purchasing';
import { mergeVendorMaster } from '../utils/vendors';
import { branchNumberPrefix } from '../utils/invoiceNumber';
import { LEGACY_BRANCH_ID, belongsToBranch, currentBranchId, stampBranch } from '../utils/branchScope';
import { useCatalogStore } from './catalogStore';

interface BranchPurchaseCounter {
  purchase: number;
  return: number;
}

// Old installs had one global PUR/RET counter for the demo register. Keep it as RIY's sequence;
// a newly configured branch starts at 1 instead of inheriting 15 purchase documents from it.
function counterForBranch(
  counters: Record<string, BranchPurchaseCounter> | undefined,
  branchId: string,
  legacy: BranchPurchaseCounter,
): BranchPurchaseCounter {
  // The global counters remain authoritative for the original register; branchCounters only
  // track terminals configured after branch scoping was added.
  if (branchId === LEGACY_BRANCH_ID) return legacy;
  return counters?.[branchId] ?? { purchase: 0, return: 0 };
}

function bumpBranchCounter(
  counters: Record<string, BranchPurchaseCounter> | undefined,
  branchId: string,
  kind: keyof BranchPurchaseCounter,
): Record<string, BranchPurchaseCounter> {
  const next = { ...(counters ?? {}) };
  const current = next[branchId] ?? { purchase: 0, return: 0 };
  next[branchId] = { ...current, [kind]: current[kind] + 1 };
  return next;
}

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
  // Per-branch PUR/RET sequences; the two global counters above remain the RIY (cc-br-001) ones.
  branchCounters?: Record<string, BranchPurchaseCounter>;
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
  // Modifying a return reverses its own outgoing stock, then posts the corrected lines. The RET
  // number and document id stay fixed; the return being edited does not count against its own
  // purchase cap and its old units count as available stock.
  updateReturnInvoice: (id: string, invoice: PurchaseInvoice) => void;
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

// A purchase return takes goods OFF the shelf: every line posts a negative physical quantity
// (paid + bonus) through catalogStore.receiveStock, and catalogStore.reversePurchaseInvoice can
// later reverse those negative events to put the units back on the same batches.
type ReturnRequestLine = { itemId: string; batchNo: string; itemNameEn: string; qty: number; bonusQty: number };

function requestedReturnLines(invoice: PurchaseInvoice): Map<string, ReturnRequestLine> {
  const requested = new Map<string, ReturnRequestLine>();
  for (const line of invoice.lines) {
    const key = purchaseReturnLineKey(line.itemId, line.batchNo);
    const current = requested.get(key);
    if (current) {
      current.qty += line.qty;
      current.bonusQty += line.bonusQty || 0;
    } else {
      requested.set(key, {
        itemId: line.itemId,
        batchNo: line.batchNo,
        itemNameEn: line.itemNameEn,
        qty: line.qty,
        bonusQty: line.bonusQty || 0,
      });
    }
  }
  return requested;
}

function assertReturnItemsExist(invoice: PurchaseInvoice): void {
  for (const line of invoice.lines) {
    if (!useCatalogStore.getState().itemById(line.itemId)) {
      throw new Error(
        `Item ${line.itemNameEn} (${line.itemId}) is not in the catalog - return ${invoice.invoiceNo} cannot be posted.`
      );
    }
  }
}

// Partial returns: when the return is linked to an original purchase, the sum of every return
// against that document may never exceed what was bought. Stock on hand alone is not enough - a
// batch can also hold units from other deliveries, so a 100-unit purchase could otherwise be
// "returned" twice as long as the shelf still has stock. `excludeInvoiceId` lets an edit ignore
// the return being replaced, whose old quantities become available again.
function assertReturnWithinPurchase(
  invoices: PurchaseInvoice[],
  invoice: PurchaseInvoice,
  requested: Map<string, ReturnRequestLine>,
  excludeInvoiceId?: string
): void {
  if (!invoice.originalInvoiceNo) return;
  const original = invoices.find(
    (i) =>
      !i.isReturn &&
      i.vendorId === invoice.vendorId &&
      i.vendorInvoiceNo === invoice.originalInvoiceNo
  );
  if (!original) return;

  const purchased = new Map<string, { qty: number; bonusQty: number }>();
  for (const line of original.lines) {
    const key = purchaseReturnLineKey(line.itemId, line.batchNo);
    const current = purchased.get(key) ?? { qty: 0, bonusQty: 0 };
    current.qty += line.qty;
    current.bonusQty += line.bonusQty || 0;
    purchased.set(key, current);
  }
  const alreadyReturned = returnedQuantitiesByLine(
    invoices,
    invoice.vendorId,
    invoice.originalInvoiceNo,
    excludeInvoiceId
  );
  for (const [key, req] of requested) {
    const bought = purchased.get(key);
    if (!bought) {
      throw new Error(
        `Batch ${req.batchNo} (${req.itemNameEn}) is not on original invoice ${invoice.originalInvoiceNo} - ` +
        `return ${invoice.invoiceNo} cannot be posted against it.`
      );
    }
    const previous = alreadyReturned.get(key) ?? { qty: 0, bonusQty: 0 };
    const remainingQty = Math.max(0, bought.qty - previous.qty);
    const remainingBonus = Math.max(0, bought.bonusQty - previous.bonusQty);
    if (req.qty > remainingQty + 1e-9 || req.bonusQty > remainingBonus + 1e-9) {
      throw new Error(
        `Only ${remainingQty} paid + ${remainingBonus} bonus unit(s) of ${req.itemNameEn} ` +
        `(batch ${req.batchNo}) are still returnable against ${invoice.originalInvoiceNo}; ` +
        `this return asks for ${req.qty} paid + ${req.bonusQty} bonus.`
      );
    }
  }
}

// Refuse before moving anything when the batch is not in stock or no longer holds what the return
// asks for - otherwise the return would create negative stock. `restored` is the edited return's
// own outgoing quantities: an edit reverses it first, so those units count as available.
function assertReturnStockAvailable(
  invoice: PurchaseInvoice,
  requested: Map<string, ReturnRequestLine>,
  restored?: Map<string, ReturnRequestLine>
): void {
  for (const [key, req] of requested) {
    const batch = useCatalogStore
      .getState()
      .batchesForItem(req.itemId)
      .find((b) => b.batchNo === req.batchNo);
    if (!batch) {
      throw new Error(`Batch ${req.batchNo} is not in stock - return ${invoice.invoiceNo} cannot be posted.`);
    }
    const back = restored?.get(key);
    const restoredQty = (back?.qty ?? 0) + (back?.bonusQty ?? 0);
    if (batch.qtyOnHand + restoredQty + 1e-9 < req.qty + req.bonusQty) {
      throw new Error(
        `Batch ${req.batchNo} has ${batch.qtyOnHand} on hand but the return asks for ${req.qty + req.bonusQty}. ` +
        `Only goods still in stock can be returned; return ${invoice.invoiceNo} was not posted.`
      );
    }
  }
}

function postReturnStock(invoice: PurchaseInvoice): void {
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
}

export const usePurchasingStore = create<PurchasingState>()(
  persist(
    (set, get) => ({
      vendors: seedVendors,
      invoices: [],
      invoiceCounter: 0,
      returnCounter: 0,
      branchCounters: {},

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

      nextPurchaseNo: () => {
        const state = get();
        const counter = counterForBranch(state.branchCounters, currentBranchId(), {
          purchase: state.invoiceCounter,
          return: state.returnCounter,
        });
        return `${branchNumberPrefix()}PUR-${String(counter.purchase + 1).padStart(6, '0')}`;
      },
      nextReturnNo: () => {
        const state = get();
        const counter = counterForBranch(state.branchCounters, currentBranchId(), {
          purchase: state.invoiceCounter,
          return: state.returnCounter,
        });
        return `${branchNumberPrefix()}RET-${String(counter.return + 1).padStart(6, '0')}`;
      },

      isVendorInvoiceNoUsed: (vendorId, vendorInvoiceNo, excludeInvoiceId) => {
        const branchId = currentBranchId();
        return get().invoices.some(
          (i) =>
            belongsToBranch(i, branchId) &&
            i.id !== excludeInvoiceId &&
            i.vendorId === vendorId &&
            i.vendorInvoiceNo === vendorInvoiceNo.trim()
        );
      },

      receivePurchaseInvoice: (invoice) => {
        const stamped = stampBranch(invoice);
        // Post the stock first, then record the document (see postInvoiceStock's all-or-nothing
        // item check). catalogStore.receiveStock reads the same terminal branch, so both land
        // under the same id.
        postInvoiceStock(stamped);
        set((s) => ({
          invoices: [...s.invoices, stamped],
          invoiceCounter:
            currentBranchId() === LEGACY_BRANCH_ID ? s.invoiceCounter + 1 : s.invoiceCounter,
          branchCounters: bumpBranchCounter(s.branchCounters, currentBranchId(), 'purchase'),
        }));
      },

      updatePurchaseInvoice: (id, invoice) => {
        const existing = get().invoices.find(
          (i) => i.id === id && belongsToBranch(i, currentBranchId()),
        );
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
              // Identity, branch and system number stay fixed: they key the stock receipt and the
              // history, and an edit must never move a document into another branch.
              ? {
                  ...invoice,
                  id: existing.id,
                  invoiceNo: existing.invoiceNo,
                  branchId: existing.branchId ?? invoice.branchId,
                }
              : i
          ),
        }));
      },

      deletePurchaseInvoice: (id) => {
        const existing = get().invoices.find(
          (i) => i.id === id && belongsToBranch(i, currentBranchId()),
        );
        if (!existing) return;
        // Throws (and leaves both the invoice and stock untouched) when the delivery has already
        // been partly sold or moved.
        useCatalogStore.getState().reversePurchaseInvoice(existing.invoiceNo);
        set((s) => ({ invoices: s.invoices.filter((i) => i.id !== id) }));
      },
      receiveReturnInvoice: (invoice) => {
        const stamped = stampBranch(invoice);
        const branchId = currentBranchId();
        assertReturnItemsExist(stamped);
        const requested = requestedReturnLines(stamped);
        assertReturnWithinPurchase(
          get().invoices.filter((i) => belongsToBranch(i, branchId)),
          stamped,
          requested,
        );
        assertReturnStockAvailable(stamped, requested);
        postReturnStock(stamped);
        set((s) => ({
          invoices: [...s.invoices, stamped],
          returnCounter: branchId === LEGACY_BRANCH_ID ? s.returnCounter + 1 : s.returnCounter,
          branchCounters: bumpBranchCounter(s.branchCounters, branchId, 'return'),
        }));
      },

      updateReturnInvoice: (id, invoice) => {
        const existing = get().invoices.find(
          (i) => i.id === id && belongsToBranch(i, currentBranchId()),
        );
        if (!existing) throw new Error(`Purchase return ${id} is no longer in the history.`);
        if (!existing.isReturn) throw new Error(`Invoice ${existing.invoiceNo} is not a purchase return.`);
        assertReturnItemsExist(invoice);
        const requested = requestedReturnLines(invoice);
        // The return being edited no longer counts against the purchase cap, and its own outgoing
        // units count as available stock because saving reverses it before posting the replacement.
        assertReturnWithinPurchase(
          get().invoices.filter((i) => belongsToBranch(i, currentBranchId())),
          invoice,
          requested,
          existing.id,
        );
        assertReturnStockAvailable(invoice, requested, requestedReturnLines(existing));
        if (!sameStockLines(existing, invoice)) {
          // Refuses when the old return is no longer fully on hand - see catalogStore.
          useCatalogStore.getState().reversePurchaseInvoice(existing.invoiceNo);
          postReturnStock(invoice);
        }
        set((s) => ({
          invoices: s.invoices.map((i) =>
            i.id === id
              // Identity, system number and the return flag stay fixed: they key the stock
              // movements and the RET sequence.
              ? {
                  ...invoice,
                  id: existing.id,
                  invoiceNo: existing.invoiceNo,
                  isReturn: true,
                  branchId: existing.branchId ?? invoice.branchId,
                }
              : i
          ),
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
          // Anything saved before branch scoping belonged to the original unconfigured RIY till.
          branchId: inv.branchId ?? LEGACY_BRANCH_ID,
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
          branchCounters: p.branchCounters ?? {
            [LEGACY_BRANCH_ID]: {
              purchase: p.invoiceCounter ?? current.invoiceCounter,
              return: Math.max(p.returnCounter ?? 0, maxReturnNo),
            },
          },
          // Keep the persisted counter when it is ahead (a return may have been deleted), and
          // never recompute invoiceCounter downward - deleted purchases must not reuse PUR numbers.
          returnCounter: Math.max(p.returnCounter ?? 0, maxReturnNo),
        };
      },
    }
  )
);
