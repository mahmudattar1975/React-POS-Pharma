import { create } from 'zustand';
import type { Item, Batch } from '../types/catalog';
import type { CartLine } from '../types/cart';
import type { Customer, CustomerTier } from '../types/customer';
import { useCatalogStore } from './catalogStore';
import { useCustomerStore } from './customerStore';
import { seedCustomers } from '../utils/seedData';
import { looksLikeGs1, parseGs1 } from '../utils/gs1';
import { fefoSort } from '../utils/fefo';
import { priceCartLine, computeCartTotals, activeOfferFor, allocateBogoFreeUnits, type CartTotals } from '../utils/pricing';
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

// Prices every line together rather than one at a time: a BOGO offer's bundle count has to span
// all of an item's batch lines (see allocateBogoFreeUnits), otherwise splitting one item over two
// batches makes each line look like it's under the buy quantity and the offer is lost.
function priceLines(lines: CartLine[], tier: CustomerTier): CartLine[] {
  const { itemById, batchById, offers } = useCatalogStore.getState();
  const today = new Date().toISOString().slice(0, 10);

  const linesByItem = new Map<string, CartLine[]>();
  for (const line of lines) {
    const group = linesByItem.get(line.itemId);
    if (group) group.push(line);
    else linesByItem.set(line.itemId, [line]);
  }

  const bogoFreeUnitsByLine = new Map<string, number>();
  const bogoOfferInEffectByItem = new Set<string>();
  for (const [itemId, itemLines] of linesByItem) {
    const item = itemById(itemId);
    if (!item) continue;
    const allocation = allocateBogoFreeUnits(activeOfferFor(item, offers, today), itemLines);
    allocation.forEach((freeUnits, lineId) => bogoFreeUnitsByLine.set(lineId, freeUnits));
    if (allocation.size > 0) bogoOfferInEffectByItem.add(itemId);
  }

  return lines.map((l) => {
    const item = itemById(l.itemId);
    const batch = batchById(l.batchId);
    if (!item || !batch) return l;
    return priceCartLine(
      item,
      batch,
      l.qty,
      offers,
      tier,
      l.id,
      manualDiscountOf(l),
      bogoFreeUnitsByLine.get(l.id) ?? 0,
      bogoOfferInEffectByItem.has(l.itemId)
    );
  });
}

function walkInCustomer(): Customer {
  return useCustomerStore.getState().byId('cus-walkin') ?? seedCustomers[0];
}

export const useCartStore = create<CartState>()((set, get) => ({
  lines: [],
  customer: walkInCustomer(),

  setCustomer: (c) => set((s) => ({ customer: c, lines: priceLines(s.lines, c.tier) })),

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
      const nextLines = existing
        ? s.lines.map((l) =>
            l.id === existing.id ? { ...l, qty: Math.min(existing.qty + qty, batch.qtyOnHand) } : l
          )
        : [
            ...s.lines,
            priceCartLine(
              item,
              batch,
              Math.min(qty, batch.qtyOnHand),
              useCatalogStore.getState().offers,
              s.customer.tier
            ),
          ];
      // Reprice the whole cart, not just the touched line: adding this item on a second batch can
      // complete a bundle that spans both lines (see priceLines).
      return { lines: priceLines(nextLines, s.customer.tier) };
    }),

  updateQty: (lineId, qty) => {
    const line = get().lines.find((l) => l.id === lineId);
    if (!line) return { appliedQty: 0, requestedQty: qty };
    const batch = useCatalogStore.getState().batchById(line.batchId);
    if (!batch) return { appliedQty: line.qty, requestedQty: qty };
    const clamped = Math.max(1, Math.min(qty, batch.qtyOnHand));
    set((s) => ({
      lines: priceLines(
        s.lines.map((l) => (l.id === lineId ? { ...l, qty: clamped } : l)),
        s.customer.tier
      ),
    }));
    return { appliedQty: clamped, requestedQty: qty };
  },

  setLineDiscount: (lineId, discount) =>
    set((s) => ({
      lines: priceLines(
        s.lines.map((l) =>
          l.id === lineId
            ? { ...l, manualDiscountType: discount?.type, manualDiscountValue: discount?.value }
            : l
        ),
        s.customer.tier
      ),
    })),

  // Removing a line can change what's left of another line's bundle (e.g. dropping the line that
  // held the free unit), so the remainder has to be repriced too - not just filtered.
  removeLine: (lineId) =>
    set((s) => ({
      lines: priceLines(
        s.lines.filter((l) => l.id !== lineId),
        s.customer.tier
      ),
    })),

  clear: () => set({ lines: [], customer: walkInCustomer() }),
}));
