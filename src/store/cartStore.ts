import { create } from 'zustand';
import type { Item, Batch } from '../types/catalog';
import type { CartLine } from '../types/cart';
import type { Customer, CustomerTier } from '../types/customer';
import { useCatalogStore } from './catalogStore';
import { useCustomerStore } from './customerStore';
import { seedCustomers } from '../utils/seedData';
import { looksLikeGs1, parseGs1 } from '../utils/gs1';
import { fefoSort } from '../utils/fefo';
import { priceCartLine, computeCartTotals, type CartTotals } from '../utils/pricing';
import * as erpApi from '../api/erpApi';

export type ScanResult =
  | { type: 'added'; item: Item }
  | { type: 'not-found' }
  | { type: 'out-of-stock'; item: Item }
  | { type: 'no-batch-matched'; itemNameEn: string }
  | { type: 'choose-batch'; item: Item; batches: Batch[] };

interface CartState {
  lines: CartLine[];
  customer: Customer;
  setCustomer: (c: Customer) => void;
  totals: () => CartTotals;
  scan: (rawScan: string) => Promise<ScanResult>;
  pickItem: (item: Item) => ScanResult;
  addLineForBatch: (item: Item, batch: Batch, qty: number) => void;
  // Returns what was actually applied vs. what was asked for, so the UI can warn the cashier when
  // the requested quantity was silently clamped to what's on hand (see POSPage's qty input) -
  // previously this just capped the value with no indication anything had been short-filled.
  updateQty: (lineId: string, qty: number) => { appliedQty: number; requestedQty: number };
  setLineDiscount: (lineId: string, discount: { type: 'amount' | 'percent'; value: number } | null) => void;
  removeLine: (lineId: string) => void;
  clear: () => void;
}

function manualDiscountOf(l: CartLine): { type: 'amount' | 'percent'; value: number } | undefined {
  return l.manualDiscountType && l.manualDiscountValue ? { type: l.manualDiscountType, value: l.manualDiscountValue } : undefined;
}

function repriceAll(lines: CartLine[], tier: CustomerTier): CartLine[] {
  const { itemById, batchById, offers } = useCatalogStore.getState();
  return lines.map((l) => {
    const item = itemById(l.itemId);
    const batch = batchById(l.batchId);
    if (!item || !batch) return l;
    return priceCartLine(item, batch, l.qty, offers, tier, l.id, manualDiscountOf(l));
  });
}

function walkInCustomer(): Customer {
  return useCustomerStore.getState().byId('cus-walkin') ?? seedCustomers[0];
}

export const useCartStore = create<CartState>()((set, get) => ({
  lines: [],
  customer: walkInCustomer(),

  setCustomer: (c) => set((s) => ({ customer: c, lines: repriceAll(s.lines, c.tier) })),

  totals: () => computeCartTotals(get().lines),

  scan: async (rawScan) => {
    const scan = rawScan.trim();
    if (!scan) return { type: 'not-found' };

    let gs1BatchNo: string | undefined;
    let gs1ExpiryDate: string | undefined;
    let lookupCode = scan; // the plain barcode to resolve - a GS1 scan's embedded GTIN, or the raw scan otherwise
    if (looksLikeGs1(scan)) {
      const parsed = parseGs1(scan);
      if (parsed.gtin) lookupCode = parsed.gtin;
      gs1BatchNo = parsed.batchNo;
      gs1ExpiryDate = parsed.expiryDate;
    }

    // Try the live XPH catalog first - a POS should show real inventory when it's reachable, not
    // only the local seed data. If the server's down, not onboarded, or the code just isn't a real
    // XPH barcode, this falls through to the local-only lookup below rather than failing the scan -
    // same "keep selling" principle as the ZATCA submission fallback in POSPage.tsx.
    let item: Item | undefined;
    try {
      const erpResult = await erpApi.getErpItemByBarcode(lookupCode);
      if (erpResult) {
        const itemId = useCatalogStore.getState().upsertErpItem(erpResult.item, erpResult.batches);
        item = useCatalogStore.getState().itemById(itemId);
      }
    } catch {
      // ERP server unreachable/erroring - fall through to the local catalog below.
    }

    const { items, batchesForItem, findItemByBarcode } = useCatalogStore.getState();
    if (!item) item = items.find((i) => i.barcode === lookupCode);
    if (!item) item = findItemByBarcode(scan);
    if (!item) return { type: 'not-found' };

    // A GS1 scan names a specific batch - go straight to it instead of asking the cashier to pick.
    if (gs1BatchNo) {
      const available = fefoSort(batchesForItem(item.id));
      if (available.length === 0) return { type: 'out-of-stock', item };
      const matched = available.find((b) => b.batchNo === gs1BatchNo || (gs1ExpiryDate && b.expiryDate === gs1ExpiryDate));
      if (matched) {
        get().addLineForBatch(item, matched, 1);
        return { type: 'added', item };
      }
      return { type: 'no-batch-matched', itemNameEn: item.nameEn };
    }

    return get().pickItem(item);
  },

  // Resolves a known item straight to a cart line - the shared tail end of a barcode scan once
  // the item itself is identified, also reused when the cashier picks an item by name from the
  // search dropdown instead of scanning (see POSPage's suggestion list).
  pickItem: (item) => {
    const available = fefoSort(useCatalogStore.getState().batchesForItem(item.id));
    if (available.length === 0) return { type: 'out-of-stock', item };
    if (available.length === 1) {
      get().addLineForBatch(item, available[0], 1);
      return { type: 'added', item };
    }
    return { type: 'choose-batch', item, batches: available };
  },

  addLineForBatch: (item, batch, qty) =>
    set((s) => {
      const existing = s.lines.find((l) => l.batchId === batch.id);
      const { offers } = useCatalogStore.getState();
      if (existing) {
        const newQty = Math.min(existing.qty + qty, batch.qtyOnHand);
        return {
          lines: s.lines.map((l) =>
            l.id === existing.id ? priceCartLine(item, batch, newQty, offers, s.customer.tier, l.id, manualDiscountOf(l)) : l
          ),
        };
      }
      const line = priceCartLine(item, batch, Math.min(qty, batch.qtyOnHand), offers, s.customer.tier);
      return { lines: [...s.lines, line] };
    }),

  updateQty: (lineId, qty) => {
    const line = get().lines.find((l) => l.id === lineId);
    if (!line) return { appliedQty: 0, requestedQty: qty };
    const { itemById, offers, batchById } = useCatalogStore.getState();
    const item = itemById(line.itemId);
    const batch = batchById(line.batchId);
    if (!item || !batch) return { appliedQty: line.qty, requestedQty: qty };
    const clamped = Math.max(1, Math.min(qty, batch.qtyOnHand));
    set((s) => ({
      lines: s.lines.map((l) =>
        l.id === lineId ? priceCartLine(item, batch, clamped, offers, s.customer.tier, l.id, manualDiscountOf(l)) : l
      ),
    }));
    return { appliedQty: clamped, requestedQty: qty };
  },

  setLineDiscount: (lineId, discount) =>
    set((s) => {
      const line = s.lines.find((l) => l.id === lineId);
      if (!line) return s;
      const { itemById, batchById, offers } = useCatalogStore.getState();
      const item = itemById(line.itemId);
      const batch = batchById(line.batchId);
      if (!item || !batch) return s;
      return {
        lines: s.lines.map((l) =>
          l.id === lineId ? priceCartLine(item, batch, l.qty, offers, s.customer.tier, l.id, discount ?? undefined) : l
        ),
      };
    }),

  removeLine: (lineId) => set((s) => ({ lines: s.lines.filter((l) => l.id !== lineId) })),

  clear: () => set({ lines: [], customer: walkInCustomer() }),
}));
