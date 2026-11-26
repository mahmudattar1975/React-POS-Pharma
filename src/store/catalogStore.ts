import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Item, Batch, Offer, ControlledStatus, PackLevel, PackConfig } from '../types/catalog';
import { seedItems, seedBatches, seedOffers } from '../utils/seedData';
import type { ErpItem, ErpBatch } from '../api/erpApi';
import { computeCostPrice } from '../utils/pricing';
import { tabletsPerBox, tabletsPerUnit } from '../utils/packUnits';
import { assertItemIdentityUnique, itemCodes, itemNumberOf, nextItemNumber } from '../utils/itemMaster';
import { isValidNupcoCode, nupcoCodeConflictMessage, normaliseNupcoCode } from '../utils/wasfaty';
import type { WasfatyMappingChange, WasfatyMappingSnapshot } from '../types/wasfaty';
import { backupReceiving, reverseReceiving } from '../api/receivingApi';
import { usePendingSyncStore } from './pendingSyncStore';
import { useAuthStore } from './authStore';
import {
  LEGACY_BRANCH_ID,
  SHARED_SEED_BRANCH_ID,
  belongsToBranch,
  currentBranchId,
  stampLegacyBranch,
} from '../utils/branchScope';

// Items pulled in live from XPH get a namespaced id (`erp-<itemNo>`) so they can never collide
// with the local seed catalog's own ids (`itm-1`, etc.) - the two catalogs coexist in the same
// store rather than one replacing the other, since seed data still works standalone with no
// server running (see cartStore.ts's fallback).
export function erpItemId(itemNo: number): string {
  return `erp-${itemNo}`;
}

// A SQL catalogue row (Excel import or boot sync) may omit isActive: that flag is branch-local and
// must not be overwritten by a terminal that only knows the shared master fields.
export type ImportedItemRow = Omit<Item, 'isActive'> & { isActive?: boolean };

function erpBatchId(itemNo: number, batchNo: string): string {
  return `erp-batch-${itemNo}-${batchNo}`;
}

// One head-office transfer document (see HeadOfficeReceivingPage.tsx's file import) can list
// several items, all sharing the same Transfer No. - recorded once per transfer, not per line, so
// re-uploading the same file a second time can be detected and flagged before it double-credits
// stock, rather than silently importing it again.
export interface ImportedTransfer {
  transferNo: string;
  importedAt: string;
}

// An immutable audit trail of every receiving event - Batch.qtyOnHand mutates as stock sells, so
// it alone can't answer "how much was received, and when" once any of it has been sold. Reports/
// ReportsPage.tsx's Goods Received report reads this, never the live Batch rows, for that reason.
export type ReceivingSource = 'vendor' | 'head_office';

export interface ReceivingEvent {
  id: string;
  // Branch whose shelf received (or, for a negative qty, returned) these units.
  branchId?: string;
  date: string; // ISO datetime, when this receiving event was recorded
  itemId: string;
  itemNameEn: string;
  itemNameAr: string;
  batchNo: string;
  expiryDate: string | null;
  qty: number;
  purchasePrice: number;
  purchaseDiscountPercent: number;
  costPrice: number;
  source: ReceivingSource;
  transferNo?: string; // set only for a head-office transfer that came from a file import
  // Set only for a vendor receiving posted through a Purchase Invoice (see
  // store/purchasingStore.ts) - lets the receiving log trace each event back to its document.
  purchaseInvoiceNo?: string;
  // Free-goods portion of qty, recorded only on the audit event/backup - qty itself is the TOTAL
  // units put in the batch (paid + bonus), because that's what physically sits on the shelf.
  // Kept separate so the receiving log can show the paid/free split of a purchase-invoice line
  // (legacy FQTYITEM tracks the same split as CUR_QTY / CUR_BONUS_QTY).
  bonusQty?: number;
}

// The mapping audit trail is bounded so a long-lived browser session cannot grow localStorage
// without limit; 500 entries is several years of normal mapping edits.
const WASFATY_MAPPING_LOG_LIMIT = 500;

function mappingSnapshot(item: Item): WasfatyMappingSnapshot {
  return {
    nupcoCode: item.nupcoCode,
    wasfatyPrice: item.wasfatyPrice,
    wasfatyEligible: item.wasfatyEligible,
  };
}

function mappingChanged(a: WasfatyMappingSnapshot, b: WasfatyMappingSnapshot): boolean {
  return (
    normaliseNupcoCode(a.nupcoCode ?? '') !== normaliseNupcoCode(b.nupcoCode ?? '') ||
    (a.wasfatyPrice ?? undefined) !== (b.wasfatyPrice ?? undefined) ||
    (a.wasfatyEligible === true) !== (b.wasfatyEligible === true)
  );
}

function currentActor(): string {
  const session = useAuthStore.getState().session;
  return session?.fullName?.trim() || session?.username?.trim() || 'Unknown user';
}

function mappingChangeEntry(
  item: Item,
  before: WasfatyMappingSnapshot,
  after: WasfatyMappingSnapshot,
  source: 'manual' | 'import',
  at = new Date().toISOString(),
  by = currentActor(),
): WasfatyMappingChange {
  return {
    id: `wml-${crypto.randomUUID()}`,
    itemId: item.id,
    itemNameEn: item.nameEn,
    itemNo: itemNumberOf(item),
    at,
    by,
    source,
    before,
    after,
  };
}

// Only real changes are recorded. A "Saved" click that re-states the same code and price must not
// bury the meaningful edit above it, and an import that re-sends an unchanged list should be a
// no-op rather than 500 identical entries.
function appendMappingLog(
  log: WasfatyMappingChange[],
  entries: WasfatyMappingChange[],
): WasfatyMappingChange[] {
  if (entries.length === 0) return log;
  return [...log, ...entries].slice(-WASFATY_MAPPING_LOG_LIMIT);
}

interface CatalogState {
  items: Item[];
  batches: Batch[];
  offers: Offer[];
  importedTransfers: ImportedTransfer[];
  receivingLog: ReceivingEvent[];
  // Who changed each NUPCO mapping, when, and what it was before. Newest last, bounded by
  // WASFATY_MAPPING_LOG_LIMIT.
  wasfatyMappingLog: WasfatyMappingChange[];
  isTransferImported: (transferNo: string) => boolean;
  recordTransferImported: (transferNo: string) => void;
  findItemByBarcode: (barcode: string) => Item | undefined;
  batchesForItem: (itemId: string) => Batch[];
  batchById: (batchId: string) => Batch | undefined;
  itemById: (itemId: string) => Item | undefined;
  decrementBatch: (batchId: string, qty: number) => void;
  incrementBatch: (batchId: string, qty: number) => void;
  receiveStock: (input: {
    itemId: string;
    batchNo: string;
    expiryDate: string | null;
    qty: number;
    purchasePrice: number;
    purchaseDiscountPercent: number;
    source: ReceivingSource;
    transferNo?: string;
    purchaseInvoiceNo?: string;
    bonusQty?: number;
    // Packed items: the quantity and price above are expressed in this level (carton/box/strip/
    // tablet) and converted to tablets here - the one unit stock is kept in.
    packLevel?: PackLevel;
  }) => void;
  // Reverses the stock a posted purchase invoice added: every receiving event tagged with that
  // invoice number is removed and its batch quantity reduced by the same amount. Refuses (throws)
  // when part of that stock has already been sold or moved, so an invoice can never silently
  // erase stock that is no longer on the shelf - use a return/credit note in that case.
  reversePurchaseInvoice: (purchaseInvoiceNo: string) => void;
  setControlledStatus: (itemId: string, status: ControlledStatus | undefined) => void;
  // Wasfaty/NUPCO mapping, owned by this store because Item rows live here. Same immediate,
  // store-level duplicate guarantee as the barcode guard: two items can never answer to one NUPCO
  // code even if a caller bypasses the mapping screen. Clearing the code also records
  // `wasfatyEligible: false` explicitly so a persisted catalogue cannot be re-seeded into coverage
  // on the next reload (see the merge below).
  setWasfatyMapping: (
    itemId: string,
    input: { nupcoCode?: string; wasfatyPrice?: number; wasfatyEligible?: boolean },
    source?: 'manual' | 'import',
  ) => void;
  // Bulk counterpart used by the NUPCO list import. Every row is validated before anything is
  // written, so a bad row can never leave a half-applied mapping behind.
  applyWasfatyMappings: (
    updates: { itemId: string; nupcoCode: string; wasfatyPrice?: number; wasfatyEligible: boolean }[],
    source?: 'manual' | 'import',
  ) => void;
  // Removing a dosage from the global library must not leave dangling item links. Kept in this
  // store (which owns Item rows) so every caller gets the same clean-up. Issued sales are untouched:
  // their directions live in SaleLine.dosage, not in this link.
  unlinkDosage: (dosageId: string) => void;
  // Item Master CRUD (see components/Inventory/ItemMasterPage.tsx). The barcode/item identity
  // guards live in utils/itemMaster.ts and run here too, so no caller can bypass the dialog's
  // validation and create a duplicate barcode.
  addItem: (input: Omit<Item, 'id' | 'itemNo'>) => Item;
  updateItem: (id: string, input: Omit<Item, 'id' | 'itemNo'>) => void;
  // Adopts rows returned by the Excel import API. Existing local rows are matched by barcode so
  // their id/itemNo (and therefore their batches, offers and historical documents) stay intact;
  // only the imported master fields are replaced. New rows get a local item number immediately.
  upsertImportedItems: (imported: ImportedItemRow[]) => void;
  // Enabling a pack ladder on an item that already has stock: the shelf balance was counted in the
  // item's OLD unit (typically its free-text `unit`, e.g. "Strip") while packed items are counted
  // in tablets. This multiplies each batch by that old-unit-to-tablet factor and divides its
  // prices by the same factor, so the physical quantity and the stock value both stay unchanged -
  // only the unit of measure does. 138 strips become 2,760 tablets at the same total cost.
  convertStockToBase: (itemId: string, factor: number, pack?: PackConfig) => void;
  setItemActive: (id: string, isActive: boolean) => void;
  // Hard delete is only allowed while nothing is on hand: a discontinued item that still has stock
  // must be sold/returned/expensed first, otherwise the shelf would keep units whose master row no
  // longer exists.
  deleteItem: (id: string) => void;
  addOffer: (input: Omit<Offer, 'id'>) => void;
  updateOffer: (id: string, input: Omit<Offer, 'id'>) => void;
  deleteOffer: (id: string) => void;
  // Merges a live XPH item (and its current batches) into the local catalog, keyed by its own
  // namespaced id - replaces any existing entry for the same item so a re-scan always reflects
  // the latest qty/price from XPH rather than stale data from an earlier scan this session.
  upsertErpItem: (item: ErpItem, batches: ErpBatch[]) => string;
}

export const useCatalogStore = create<CatalogState>()(
  persist(
    (set, get) => ({
      items: seedItems,
      batches: seedBatches,
      offers: seedOffers,
      importedTransfers: [],
      receivingLog: [],
      wasfatyMappingLog: [],

      isTransferImported: (transferNo) => get().importedTransfers.some((t) => t.transferNo === transferNo),
      recordTransferImported: (transferNo) =>
        set((s) => ({ importedTransfers: [...s.importedTransfers, { transferNo, importedAt: new Date().toISOString() }] })),

      findItemByBarcode: (barcode) => {
        const key = barcode.trim().toLowerCase();
        return get().items.find((i) =>
          itemCodes(i).some((code) => code.toLowerCase() === key)
        );
      },
      // The catalog is shared, stock is not: FEFO and every batch picker only see this terminal's
      // batches. Rows from before branch scoping belong to the original RIY register.
      batchesForItem: (itemId) =>
        get().batches.filter((b) => b.itemId === itemId && belongsToBranch(b, currentBranchId())),
      batchById: (batchId) =>
        get().batches.find((b) => b.id === batchId && belongsToBranch(b, currentBranchId())),
      itemById: (itemId) => get().items.find((i) => i.id === itemId),

      decrementBatch: (batchId, qty) =>
        set((s) => ({
          batches: s.batches.map((b) => (b.id === batchId ? { ...b, qtyOnHand: Math.max(0, b.qtyOnHand - qty) } : b)),
        })),

      incrementBatch: (batchId, qty) =>
        set((s) => ({
          batches: s.batches.map((b) => (b.id === batchId ? { ...b, qtyOnHand: b.qtyOnHand + qty } : b)),
        })),

      receiveStock: ({ itemId, batchNo, expiryDate, qty, purchasePrice, purchaseDiscountPercent, source, transferNo, purchaseInvoiceNo, bonusQty, packLevel }) => {
        const item = get().items.find((i) => i.id === itemId);
        // A packed item is stocked in tablets. Converting once here means every caller (vendor
        // invoice, manual receiving, head-office import) can keep entering the unit the delivery
        // actually arrived in - 1 carton, 1 box - and never has to know the ladder.
        const perUnit = item?.pack ? tabletsPerUnit(item.pack, packLevel ?? 'box') : 1;
        const baseQty = qty * perUnit;
        const basePurchasePrice = purchasePrice / perUnit;
        const baseBonusQty = (bonusQty ?? 0) * perUnit;
        // purchaseDiscountPercent arrives pre-folded: everything the caller wants expressed as one
        // fraction. Purchase-invoice lines pass their tier discount PLUS the bonus dilution (see
        // utils/purchasing.ts batchReceiveDiscount) so the batch cost lands on the legacy
        // NET_PUR_PRICE convention (net across paid+bonus units, live XPH: 8100.081/500 = 16.200).
        const costPrice = computeCostPrice(basePurchasePrice, purchaseDiscountPercent);
        const receivedDate = new Date().toISOString().slice(0, 10);
        // Same lot number in another branch is a different shelf balance; never top that up.
        const existing = get().batches.find(
          (b) => b.itemId === itemId && b.batchNo === batchNo && belongsToBranch(b, currentBranchId()),
        );
        // Unique suffix, not just Date.now(): one purchase invoice can post several brand-new
        // lots of the SAME item in the same tick, and a shared id would make every sale/list
        // operation treat the two lots as one batch (decrementing both, colliding React keys).
        const batchId = existing ? existing.id : `bat-${itemId}-${crypto.randomUUID()}`;

        const event: ReceivingEvent = {
          id: `rcv-${itemId}-${crypto.randomUUID()}`,
          branchId: currentBranchId(),
          date: new Date().toISOString(),
          itemId,
          itemNameEn: item?.nameEn ?? '',
          itemNameAr: item?.nameAr ?? '',
          batchNo,
          expiryDate,
          qty: baseQty,
          purchasePrice: basePurchasePrice,
          purchaseDiscountPercent,
          costPrice,
          source,
          transferNo,
          purchaseInvoiceNo,
          bonusQty: baseBonusQty > 0 ? baseBonusQty : undefined,
        };

        set((s) => {
          const receivingLog = [...s.receivingLog, event];
          if (existing) {
            // Topping up the same batch number - same lot, same purchase, so its pricing is left
            // as originally recorded rather than overwritten by whatever's in the form right now.
            // The receiving event above still records this specific delivery, even though the
            // batch row itself doesn't show a separate line for it.
            return {
              batches: s.batches.map((b) => (b.id === existing.id ? { ...b, qtyOnHand: b.qtyOnHand + baseQty } : b)),
              receivingLog,
            };
          }
          const newBatch: Batch = {
            id: batchId,
            branchId: currentBranchId(),
            itemId,
            batchNo,
            expiryDate,
            receivedDate,
            qtyOnHand: baseQty,
            purchasePrice: basePurchasePrice,
            purchaseDiscountPercent,
            costPrice,
          };
          return { batches: [...s.batches, newBatch], receivingLog };
        });

        // Best-effort backup, same "never block the action, queue on failure" pattern as
        // salesStore.ts - without this, the SQL mirror's batches table only ever moved on a sale,
        // never on receiving, and would drift out of sync in the opposite direction.
        const backupPayload = {
          batchId,
          itemId,
          itemNameAr: item?.nameAr ?? '',
          itemNameEn: item?.nameEn ?? '',
          barcode: item?.barcode,
          unit: item?.unit,
          category: item?.category,
          basePrice: item?.basePrice,
          vatRate: item?.vatRate,
          requiresBatchTracking: item?.requiresBatchTracking,
          reorderLevel: item?.reorderLevel,
          batchNo,
          expiryDate,
          receivedDate,
          qty: baseQty,
          purchasePrice: basePurchasePrice,
          purchaseDiscountPercent,
          costPrice,
          bonusQty: baseBonusQty > 0 ? baseBonusQty : undefined,
        };
        backupReceiving(backupPayload).catch((err) => {
          console.warn('Receiving backup failed, queued for retry:', err);
          usePendingSyncStore.getState().enqueue({ kind: 'receiving', payload: backupPayload });
        });
      },

      reversePurchaseInvoice: (purchaseInvoiceNo) => {
        const branchId = currentBranchId();
        const events = get().receivingLog.filter(
          (e) => e.purchaseInvoiceNo === purchaseInvoiceNo && belongsToBranch(e, branchId),
        );
        // Nothing was posted for this invoice (legacy rows saved before the receiving log tagged
        // invoice numbers) - the document can still be removed without touching stock.
        if (events.length === 0) return;

        // One line tops up an existing batch and a second line of the same invoice can top it up
        // again, so aggregate per item+batch before checking what is still on hand.
        const received = new Map<string, { itemId: string; batchNo: string; qty: number }>();
        for (const event of events) {
          const key = `${event.itemId}\u0000${event.batchNo}`;
          const current = received.get(key);
          if (current) current.qty += event.qty;
          else received.set(key, { itemId: event.itemId, batchNo: event.batchNo, qty: event.qty });
        }

        for (const { itemId, batchNo, qty } of received.values()) {
          const batch = get().batches.find(
            (b) => b.itemId === itemId && b.batchNo === batchNo && belongsToBranch(b, branchId),
          );
          if (!batch) {
            throw new Error(
              `Batch ${batchNo} for item ${itemId} is no longer in the catalog - invoice ${purchaseInvoiceNo} cannot be reversed safely.`
            );
          }
          // Tiny epsilon for the floating-point quantity arithmetic used by packed items.
          if (batch.qtyOnHand + 1e-9 < qty) {
            throw new Error(
              `Batch ${batchNo} has ${batch.qtyOnHand} on hand but invoice ${purchaseInvoiceNo} received ${qty}. ` +
              'Part of that delivery has already been sold or moved, so the invoice cannot be deleted or changed. ' +
              'Post a purchase return / credit note instead.'
            );
          }
        }

        set((s) => {
          const batches = s.batches.map((b) => {
            const key = `${b.itemId}\u0000${b.batchNo}`;
            const hit = received.get(key);
            if (!hit || !belongsToBranch(b, branchId)) return b;
            // Kept at zero rather than removed: the batch may predate this invoice (opening stock
            // or another delivery), and its row is the cost reference for anything already sold.
            return { ...b, qtyOnHand: Math.max(0, b.qtyOnHand - hit.qty) };
          });
          return {
            batches,
            receivingLog: s.receivingLog.filter(
              (e) => e.purchaseInvoiceNo !== purchaseInvoiceNo || !belongsToBranch(e, branchId),
            ),
          };
        });

        // Best-effort SQL mirror, same "never block the action" pattern as the receiving backup.
        for (const { itemId, batchNo, qty } of received.values()) {
          reverseReceiving({ itemId, batchNo, qty }).catch((err) => {
            console.warn('Receiving reversal backup failed:', err);
          });
        }
      },

      setControlledStatus: (itemId, status) =>
        set((s) => ({ items: s.items.map((i) => (i.id === itemId ? { ...i, controlledStatus: status } : i)) })),

      setWasfatyMapping: (itemId, input, source = 'manual') => {
        const item = get().items.find((i) => i.id === itemId);
        if (!item) throw new Error('Item not found.');
        const code = normaliseNupcoCode(input.nupcoCode ?? '');
        if (code !== '' && !isValidNupcoCode(code)) {
          throw new Error('A NUPCO item code is 13 digits.');
        }
        if (code !== '') {
          const conflict = nupcoCodeConflictMessage(get().items, code, itemId);
          if (conflict) throw new Error(conflict);
        }
        const eligible = input.wasfatyEligible ?? (code !== '' || item.wasfatyEligible === true);
        if (code !== '' && !eligible) {
          throw new Error('Turn on Wasfaty eligibility before mapping a NUPCO code.');
        }
        if (input.wasfatyPrice !== undefined && (!Number.isFinite(input.wasfatyPrice) || input.wasfatyPrice < 0)) {
          throw new Error('The NUPCO-approved price must be 0 or more.');
        }
        const before = mappingSnapshot(item);
        const after: WasfatyMappingSnapshot = {
          nupcoCode: code === '' ? undefined : code,
          wasfatyPrice: input.wasfatyPrice,
          // false is meaningful and persisted: it says "this item is not on the approved
          // list", which must survive a reload even though the code is now undefined.
          wasfatyEligible: eligible ? true : false,
        };
        set((s) => ({
          items: s.items.map((i) => (i.id === itemId ? { ...i, ...after } : i)),
          wasfatyMappingLog: appendMappingLog(
            s.wasfatyMappingLog,
            mappingChanged(before, after) ? [mappingChangeEntry(item, before, after, source)] : [],
          ),
        }));
      },

      applyWasfatyMappings: (updates, source = 'import') => {
        const current = get().items;
        const byId = new Map(current.map((i) => [i.id, i]));
        const updating = new Set(updates.map((u) => u.itemId));
        const seenCodes = new Map<string, string>();

        for (const update of updates) {
          const item = byId.get(update.itemId);
          if (!item) throw new Error(`Item ${update.itemId} was not found.`);
          const code = normaliseNupcoCode(update.nupcoCode);
          if (!isValidNupcoCode(code)) {
            throw new Error(`${item.nameEn}: a NUPCO item code is 13 digits.`);
          }
          const previous = seenCodes.get(code);
          if (previous && previous !== update.itemId) {
            throw new Error(`Two rows in this import use NUPCO code ${code}.`);
          }
          seenCodes.set(code, update.itemId);
          if (update.wasfatyPrice !== undefined && (!Number.isFinite(update.wasfatyPrice) || update.wasfatyPrice < 0)) {
            throw new Error(`${item.nameEn}: the NUPCO-approved price must be 0 or more.`);
          }
          if (!update.wasfatyEligible) {
            throw new Error(`${item.nameEn}: a mapped NUPCO code must be marked as eligible.`);
          }
        }

        // Conflicts against the rest of the catalogue. Items in this batch are allowed to swap or
        // re-state codes among themselves, which is why they are excluded from the owner search.
        for (const update of updates) {
          const code = normaliseNupcoCode(update.nupcoCode);
          const owner = current.find(
            (i) => !updating.has(i.id) && i.nupcoCode && normaliseNupcoCode(i.nupcoCode) === code,
          );
          if (owner) {
            throw new Error(`NUPCO code ${code} is already mapped to ${owner.nameEn}.`);
          }
        }

        const patchById = new Map(updates.map((u) => [u.itemId, u]));
        const at = new Date().toISOString();
        const by = currentActor();
        set((s) => {
          const entries: WasfatyMappingChange[] = [];
          const items = s.items.map((item) => {
            const update = patchById.get(item.id);
            if (!update) return item;
            const before = mappingSnapshot(item);
            const after: WasfatyMappingSnapshot = {
              nupcoCode: normaliseNupcoCode(update.nupcoCode),
              wasfatyPrice: update.wasfatyPrice,
              wasfatyEligible: true,
            };
            if (mappingChanged(before, after)) {
              entries.push(mappingChangeEntry(item, before, after, source, at, by));
            }
            return { ...item, ...after };
          });
          return { items, wasfatyMappingLog: appendMappingLog(s.wasfatyMappingLog, entries) };
        });
      },

      unlinkDosage: (dosageId) =>
        set((s) => ({
          items: s.items.map((i) => {
            if (!i.dosageIds?.includes(dosageId)) return i;
            const dosageIds = i.dosageIds.filter((id) => id !== dosageId);
            return {
              ...i,
              dosageIds: dosageIds.length > 0 ? dosageIds : undefined,
              defaultDosageId: i.defaultDosageId === dosageId ? undefined : i.defaultDosageId,
            };
          }),
        })),

      addItem: (input) => {
        assertItemIdentityUnique(get().items, input.barcode, input.gtin ?? '', undefined, input.barcodes ?? []);
        const item: Item = {
          ...input,
          id: `itm-${crypto.randomUUID()}`,
          itemNo: nextItemNumber(get().items),
        };
        set((s) => ({ items: [...s.items, item] }));
        return item;
      },

      updateItem: (id, input) => {
        assertItemIdentityUnique(get().items, input.barcode, input.gtin ?? '', id, input.barcodes ?? []);
        set((s) => ({
          // itemNo is an identity assigned at creation - an edit may change everything else, but
          // renumbering an item would break printed labels and external references to it.
          items: s.items.map((i) => (i.id === id ? { ...input, id, itemNo: i.itemNo } : i)),
        }));
      },

      upsertImportedItems: (imported) => {
        const current = get().items;
        const byCode = new Map<string, Item>();
        for (const item of current) {
          for (const code of itemCodes(item)) byCode.set(code.toLowerCase(), item);
        }
        const usedIds = new Set(current.map((i) => i.id));
        let nextNumber = nextItemNumber(current);
        const patches = new Map<string, Item>();
        const fresh: Item[] = [];

        for (const row of imported) {
          const key = row.barcode.trim().toLowerCase();
          const existing = byCode.get(key);
          const master = {
            barcode: row.barcode,
            nameAr: row.nameAr,
            nameEn: row.nameEn,
            unit: row.unit,
            category: row.category,
            categoryId: row.categoryId,
            basePrice: row.basePrice,
            vatRate: row.vatRate,
            requiresBatchTracking: row.requiresBatchTracking,
            reorderLevel: row.reorderLevel,
            controlledStatus: row.controlledStatus ?? undefined,
          } as Partial<Item>;
          // A boot sync has no branch-local active flag: keep this terminal's current choice
          // instead of silently re-enabling an item it had discontinued.
          if (row.isActive !== undefined) master.isActive = row.isActive;
          if (existing) {
            // Keep local-only metadata (pack ladder, dosage links, Wasfaty mapping, alias codes)
            // that a catalogue import has no source for.
            patches.set(existing.id, { ...existing, ...master });
            continue;
          }
          const id = row.id && !usedIds.has(row.id) ? row.id : `itm-${crypto.randomUUID()}`;
          usedIds.add(id);
          const itemNo = row.itemNo ?? nextNumber;
          nextNumber = Math.max(nextNumber, itemNo + 1);
          fresh.push({ ...row, ...master, id, itemNo, isActive: row.isActive ?? true });
        }

        set((s) => ({
          items: [...s.items.map((item) => patches.get(item.id) ?? item), ...fresh],
        }));
      },

      convertStockToBase: (itemId, factor, pack) => {
        if (!Number.isFinite(factor) || factor <= 1) return;
        // per-unit prices are always present on a batch; divide then keep 3 decimals so a cost like
        // 2.80 / 20 = 0.14 does not accumulate floating-point noise.
        const perTablet = (value: number) => Math.round((value / factor) * 1000) / 1000;
        // A batch sale-price override is quoted per OLD selling unit, while packed pricing reads it
        // as the BOX price (utils/pricing.ts resolveSalePrice). Scale it by boxes-per-old-unit, not
        // by 1/factor, or an ERP price of 4.50 per strip would be read as 4.50 per box.
        const saleMultiplier = pack ? tabletsPerBox(pack) / factor : 1;
        const perBox = (value: number) => Math.round(value * saleMultiplier * 1000) / 1000;
        set((s) => ({
          batches: s.batches.map((b) =>
            b.itemId === itemId
              ? {
                  ...b,
                  // Tablets are whole units; the factor is always an integer ladder size.
                  qtyOnHand: Math.round(b.qtyOnHand * factor),
                  purchasePrice: perTablet(b.purchasePrice),
                  costPrice: perTablet(b.costPrice),
                  salePriceOverride:
                    b.salePriceOverride === undefined ? undefined : perBox(b.salePriceOverride),
                }
              : b
          ),
        }));
      },

      setItemActive: (id, isActive) =>
        set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, isActive } : i)) })),

      deleteItem: (id) => {
        const item = get().items.find((i) => i.id === id);
        if (!item) return;
        const onHand = get()
          .batches.filter((b) => b.itemId === id)
          .reduce((sum, b) => sum + b.qtyOnHand, 0);
        if (onHand > 0) {
          throw new Error(
            `Cannot delete ${item.nameEn}: ${onHand} unit(s) are still on hand. Sell, return or write them off first, or mark the item discontinued instead.`
          );
        }
        // Zero-quantity batches and offers go with the item so the catalog has no orphan rows; the
        // receiving log and issued invoices stay untouched because they are the audit trail and
        // already carry their own item-name snapshots.
        set((s) => ({
          items: s.items.filter((i) => i.id !== id),
          batches: s.batches.filter((b) => b.itemId !== id),
          offers: s.offers.filter((o) => o.itemId !== id),
        }));
      },

      addOffer: (input) =>
        set((s) => (s.offers.some((o) => o.itemId === input.itemId)
          ? s
          : { offers: [...s.offers, { ...input, id: `off-${Date.now()}` }] })),

      updateOffer: (id, input) =>
        set((s) => (s.offers.some((o) => o.id !== id && o.itemId === input.itemId)
          ? s
          : { offers: s.offers.map((o) => (o.id === id ? { ...input, id } : o)) })),

      deleteOffer: (id) => set((s) => ({ offers: s.offers.filter((o) => o.id !== id) })),

      upsertErpItem: (erpItem, erpBatches) => {
        const id = erpItemId(erpItem.itemNo);
        // controlledStatus has no source in XPH (confirmed - see types/catalog.ts) and is only
        // ever set manually in this app, so a re-scan must preserve whatever was set locally
        // rather than wiping it out along with the rest of the refreshed item data.
        const existing = get().items.find((i) => i.id === id);
        const item: Item = {
          id,
          barcode: erpItem.barcode,
          nameAr: erpItem.nameAr,
          nameEn: erpItem.nameEn,
          unit: erpItem.unit,
          category: 'XPH',
          // No item-level price on FcodStock (confirmed via server/src/erp/README.md's research) -
          // real pricing is per batch. This falls back to 0 only when an item has genuinely no
          // batches with stock, in which case there's no price to sell it at anyway.
          basePrice: erpBatches[0]?.salePrice ?? 0,
          vatRate: erpItem.vatRate,
          requiresBatchTracking: erpItem.requiresBatchTracking,
          reorderLevel: 0,
          controlledStatus: existing?.controlledStatus,
          // Item-level directions are curated locally (XPH has no DOS concept), so a re-scan must
          // keep them exactly like controlledStatus rather than dropping the links.
          dosageIds: existing?.dosageIds,
          defaultDosageId: existing?.defaultDosageId,
          // Wasfaty mapping is likewise local pharmacy data with no XPH source - a scan refresh
          // must never silently un-map an item and stop it being dispensed.
          nupcoCode: existing?.nupcoCode,
          wasfatyPrice: existing?.wasfatyPrice,
          wasfatyEligible: existing?.wasfatyEligible,
        };
        const batches: Batch[] = erpBatches.map((b) => ({
          id: erpBatchId(erpItem.itemNo, b.batchNo),
          branchId: currentBranchId(),
          itemId: id,
          batchNo: b.batchNo,
          expiryDate: b.expiryDate,
          receivedDate: new Date().toISOString().slice(0, 10), // not tracked by this integration - see erp/README.md
          qtyOnHand: b.qtyOnHand,
          // Purchase-side pricing isn't exposed by this read-only sales integration - not needed
          // for selling, only for the Inventory report's own cost/margin columns.
          purchasePrice: 0,
          purchaseDiscountPercent: 0,
          costPrice: 0,
          salePriceOverride: b.salePrice,
        }));

        set((s) => ({
          items: [...s.items.filter((i) => i.id !== id), item],
          // A rescan replaces only this terminal's batches for the item - another branch may hold
          // the same item with its own stock and must not be wiped out by an ERP refresh here.
          batches: [
            ...s.batches.filter((b) => b.itemId !== id || !belongsToBranch(b, currentBranchId())),
            ...batches,
          ],
        }));

        return id;
      },
    }),
    {
      name: 'pharmacy-catalog',
      // Without this, zustand's default merge just spreads persistedState over the freshly-built
      // initial state - so items/batches/offers from localStorage (a returning browser session)
      // fully REPLACE the current seedItems/seedBatches/seedOffers arrays, silently hiding any new
      // demo item added to seedData.ts from every browser that already has an older catalog saved.
      // Instead: keep the persisted rows (so local edits like controlledStatus or decremented qty
      // survive a reload), but append any seed row whose id isn't already present.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<CatalogState>;
        // Backfill the dosage links added to the starter items in seedData.ts. The check is on the
        // FIELD being absent, not empty: an owner who deliberately cleared every direction on an
        // item must not have the seed links silently reinstated on the next reload.
        const seedById = new Map(current.items.map((i) => [i.id, i]));
        const persistedItems = (p.items ?? current.items).map((i) => {
          const seed = seedById.get(i.id);
          let next = i;
          if (next.dosageIds === undefined && seed?.dosageIds) {
            next = { ...next, dosageIds: seed.dosageIds, defaultDosageId: seed.defaultDosageId };
          }
          // Same field-absence rule for the Wasfaty mapping added to the starter items. A deliberate
          // clear stores `wasfatyEligible: false`, so this only fills rows saved before the field
          // existed - it never re-maps an item the owner took off the list.
          if (
            next.nupcoCode === undefined &&
            next.wasfatyEligible === undefined &&
            (seed?.nupcoCode !== undefined || seed?.wasfatyEligible !== undefined)
          ) {
            next = {
              ...next,
              nupcoCode: seed.nupcoCode,
              wasfatyPrice: seed.wasfatyPrice,
              wasfatyEligible: seed.wasfatyEligible,
            };
          }
          return next;
        });
        // Backfills batches saved before purchasePrice/purchaseDiscountPercent existed on Batch -
        // without this, a batch from an older browser session has those fields as `undefined`,
        // and InventoryPage.tsx's `batch.purchasePrice.toFixed(2)` throws, blanking the whole page
        // (confirmed live: TypeError, no error boundary catches it). costPrice is the best
        // available stand-in for the old "purchase price" since nothing before this tracked a
        // separate pre-discount price.
        // The batches shipped in seedData.ts are demo starter stock, not goods any real branch
        // received. Give them a shared id so a brand-new till can sell on day one even when its
        // terminal is configured to a branch other than the legacy RIY register. Stock a browser
        // actually saved before branch scoping had no id and is treated as the old RIY register.
        const seedBatchIds = new Set(current.batches.map((b) => b.id));
        const persistedBatches = (p.batches ?? current.batches).map((b) => ({
          ...b,
          branchId:
            b.branchId ??
            (seedBatchIds.has(b.id) ? SHARED_SEED_BRANCH_ID : LEGACY_BRANCH_ID),
          purchasePrice: b.purchasePrice ?? b.costPrice ?? 0,
          purchaseDiscountPercent: b.purchaseDiscountPercent ?? 0,
          costPrice: b.costPrice ?? 0,
        }));
        const persistedReceivingLog = (p.receivingLog ?? current.receivingLog).map(stampLegacyBranch);
        const persistedOffers = p.offers ?? current.offers;
        const itemIds = new Set(persistedItems.map((i) => i.id));
        const batchIds = new Set(persistedBatches.map((b) => b.id));
        const offerIds = new Set(persistedOffers.map((o) => o.id));
        return {
          ...current,
          ...p,
          items: [...persistedItems, ...current.items.filter((i) => !itemIds.has(i.id))],
          batches: [
            ...persistedBatches,
            ...current.batches
              .filter((b) => !batchIds.has(b.id))
              .map((b) => ({ ...b, branchId: b.branchId ?? SHARED_SEED_BRANCH_ID })),
          ],
          receivingLog: persistedReceivingLog,
          offers: [...persistedOffers, ...current.offers.filter((o) => !offerIds.has(o.id))],
        };
      },
    }
  )
);
