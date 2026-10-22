import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Item, Batch, Offer, ControlledStatus } from '../types/catalog';
import { seedItems, seedBatches, seedOffers } from '../utils/seedData';
import type { ErpItem, ErpBatch } from '../api/erpApi';
import { computeCostPrice } from '../utils/pricing';
import { backupReceiving } from '../api/receivingApi';
import { usePendingSyncStore } from './pendingSyncStore';

// Items pulled in live from XPH get a namespaced id (`erp-<itemNo>`) so they can never collide
// with the local seed catalog's own ids (`itm-1`, etc.) - the two catalogs coexist in the same
// store rather than one replacing the other, since seed data still works standalone with no
// server running (see cartStore.ts's fallback).
export function erpItemId(itemNo: number): string {
  return `erp-${itemNo}`;
}

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
  date: string; // ISO datetime, when this receiving event was recorded
  itemId: string;
  itemNameEn: string;
  itemNameAr: string;
  batchNo: string;
  expiryDate: string;
  qty: number;
  purchasePrice: number;
  purchaseDiscountPercent: number;
  costPrice: number;
  source: ReceivingSource;
  transferNo?: string; // set only for a head-office transfer that came from a file import
}

interface CatalogState {
  items: Item[];
  batches: Batch[];
  offers: Offer[];
  importedTransfers: ImportedTransfer[];
  receivingLog: ReceivingEvent[];
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
    expiryDate: string;
    qty: number;
    purchasePrice: number;
    purchaseDiscountPercent: number;
    source: ReceivingSource;
    transferNo?: string;
  }) => void;
  setControlledStatus: (itemId: string, status: ControlledStatus | undefined) => void;
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

      isTransferImported: (transferNo) => get().importedTransfers.some((t) => t.transferNo === transferNo),
      recordTransferImported: (transferNo) =>
        set((s) => ({ importedTransfers: [...s.importedTransfers, { transferNo, importedAt: new Date().toISOString() }] })),

      findItemByBarcode: (barcode) => get().items.find((i) => i.barcode === barcode),
      batchesForItem: (itemId) => get().batches.filter((b) => b.itemId === itemId),
      batchById: (batchId) => get().batches.find((b) => b.id === batchId),
      itemById: (itemId) => get().items.find((i) => i.id === itemId),

      decrementBatch: (batchId, qty) =>
        set((s) => ({
          batches: s.batches.map((b) => (b.id === batchId ? { ...b, qtyOnHand: Math.max(0, b.qtyOnHand - qty) } : b)),
        })),

      incrementBatch: (batchId, qty) =>
        set((s) => ({
          batches: s.batches.map((b) => (b.id === batchId ? { ...b, qtyOnHand: b.qtyOnHand + qty } : b)),
        })),

      receiveStock: ({ itemId, batchNo, expiryDate, qty, purchasePrice, purchaseDiscountPercent, source, transferNo }) => {
        const item = get().items.find((i) => i.id === itemId);
        const costPrice = computeCostPrice(purchasePrice, purchaseDiscountPercent);
        const receivedDate = new Date().toISOString().slice(0, 10);
        const existing = get().batches.find((b) => b.itemId === itemId && b.batchNo === batchNo);
        const batchId = existing ? existing.id : `bat-${itemId}-${Date.now()}`;

        const event: ReceivingEvent = {
          id: `rcv-${itemId}-${Date.now()}`,
          date: new Date().toISOString(),
          itemId,
          itemNameEn: item?.nameEn ?? '',
          itemNameAr: item?.nameAr ?? '',
          batchNo,
          expiryDate,
          qty,
          purchasePrice,
          purchaseDiscountPercent,
          costPrice,
          source,
          transferNo,
        };

        set((s) => {
          const receivingLog = [...s.receivingLog, event];
          if (existing) {
            // Topping up the same batch number - same lot, same purchase, so its pricing is left
            // as originally recorded rather than overwritten by whatever's in the form right now.
            // The receiving event above still records this specific delivery, even though the
            // batch row itself doesn't show a separate line for it.
            return {
              batches: s.batches.map((b) => (b.id === existing.id ? { ...b, qtyOnHand: b.qtyOnHand + qty } : b)),
              receivingLog,
            };
          }
          const newBatch: Batch = {
            id: batchId,
            itemId,
            batchNo,
            expiryDate,
            receivedDate,
            qtyOnHand: qty,
            purchasePrice,
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
          qty,
          purchasePrice,
          purchaseDiscountPercent,
          costPrice,
        };
        backupReceiving(backupPayload).catch((err) => {
          console.warn('Receiving backup failed, queued for retry:', err);
          usePendingSyncStore.getState().enqueue({ kind: 'receiving', payload: backupPayload });
        });
      },

      setControlledStatus: (itemId, status) =>
        set((s) => ({ items: s.items.map((i) => (i.id === itemId ? { ...i, controlledStatus: status } : i)) })),

      addOffer: (input) =>
        set((s) => ({ offers: [...s.offers, { ...input, id: `off-${Date.now()}` }] })),

      updateOffer: (id, input) =>
        set((s) => ({ offers: s.offers.map((o) => (o.id === id ? { ...input, id } : o)) })),

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
        };
        const batches: Batch[] = erpBatches.map((b) => ({
          id: erpBatchId(erpItem.itemNo, b.batchNo),
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
          batches: [...s.batches.filter((b) => b.itemId !== id), ...batches],
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
        const persistedItems = p.items ?? current.items;
        // Backfills batches saved before purchasePrice/purchaseDiscountPercent existed on Batch -
        // without this, a batch from an older browser session has those fields as `undefined`,
        // and InventoryPage.tsx's `batch.purchasePrice.toFixed(2)` throws, blanking the whole page
        // (confirmed live: TypeError, no error boundary catches it). costPrice is the best
        // available stand-in for the old "purchase price" since nothing before this tracked a
        // separate pre-discount price.
        const persistedBatches = (p.batches ?? current.batches).map((b) => ({
          ...b,
          purchasePrice: b.purchasePrice ?? b.costPrice ?? 0,
          purchaseDiscountPercent: b.purchaseDiscountPercent ?? 0,
          costPrice: b.costPrice ?? 0,
        }));
        const persistedOffers = p.offers ?? current.offers;
        const itemIds = new Set(persistedItems.map((i) => i.id));
        const batchIds = new Set(persistedBatches.map((b) => b.id));
        const offerIds = new Set(persistedOffers.map((o) => o.id));
        return {
          ...current,
          ...p,
          items: [...persistedItems, ...current.items.filter((i) => !itemIds.has(i.id))],
          batches: [...persistedBatches, ...current.batches.filter((b) => !batchIds.has(b.id))],
          offers: [...persistedOffers, ...current.offers.filter((o) => !offerIds.has(o.id))],
        };
      },
    }
  )
);
