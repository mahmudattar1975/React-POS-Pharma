import { create } from 'zustand';
import type { Item, Batch, PackLevel } from '../types/catalog';
import type { CartLine } from '../types/cart';
import type { DosageSnapshot } from '../types/dosage';
import type { Customer, CustomerTier } from '../types/customer';
import type { WasfatySession } from '../types/wasfaty';
import { isWasfatyCoveredItem, wasfatyPricingBatch, wasfatyPricingItem } from '../utils/wasfaty';
import { useCatalogStore } from './catalogStore';
import { useCustomerStore } from './customerStore';
import { seedCustomers } from '../utils/seedData';
import { looksLikeGs1, parseGs1 } from '../utils/gs1';
import { fefoSort } from '../utils/fefo';
import {
  priceCartLine,
  computeCartTotals,
  activeOfferFor,
  allocateBogoFreeUnits,
  type CartTotals,
} from '../utils/pricing';
import { sellableQty, tabletsPerUnit, toBaseQty } from '../utils/packUnits';
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
  // The active Wasfaty (NUPCO e-prescription) dispense. Null for an ordinary retail sale. Starting
  // one re-flags every line already in the basket: items on the approved list are covered (patient
  // share 0.00), everything else stays a normal patient-paid line in the same basket.
  wasfatySession: WasfatySession | null;
  startWasfaty: (session: WasfatySession) => void;
  endWasfaty: () => void;
  setCustomer: (c: Customer) => void;
  totals: () => CartTotals;
  scan: (rawScan: string) => Promise<ScanResult>;
  pickItem: (item: Item) => ScanResult;
  // packLevel defaults to 'box' for a packed item and is ignored for an item without a pack ladder.
  addLineForBatch: (item: Item, batch: Batch, qty: number, packLevel?: PackLevel) => void;
  // Cashier switches a line between box / strip / tablet. Quantities are converted so the same
  // physical amount stays on the line (2 boxes -> 24 tablets), and prices re-derive from the box.
  setLinePackLevel: (lineId: string, packLevel: PackLevel) => void;
  // Optional patient directions for one cart line. Passing undefined removes them. The snapshot
  // (not just the master id) is kept on the line so repricing the cart cannot alter what will print.
  setLineDosage: (lineId: string, dosage: DosageSnapshot | undefined) => void;
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

  const bogoFreeBaseQtyByLine = new Map<string, number>();
  const bogoOfferInEffectByItem = new Set<string>();
  for (const [itemId, itemLines] of linesByItem) {
    const item = itemById(itemId);
    if (!item) continue;
    const allocation = allocateBogoFreeUnits(
      activeOfferFor(item, offers, today),
      itemLines.map((l) => ({
        id: l.id,
        qty: l.qty,
        // Bundles are counted on the BOX, so each line's tablets are what get summed across
        // batches and selling levels (a box + loose tablets can still complete one bundle).
        baseQty: item.pack ? toBaseQty(item.pack, l.packLevel ?? 'box', l.qty) : l.qty,
      })),
      item.pack
    );
    allocation.forEach((freeBaseQty, lineId) => bogoFreeBaseQtyByLine.set(lineId, freeBaseQty));
    if (allocation.size > 0) bogoOfferInEffectByItem.add(itemId);
  }

  return lines.map((l) => {
    const item = itemById(l.itemId);
    const batch = batchById(l.batchId);
    if (!item || !batch) return l;
    const covered = !!l.wasfaty;
    // Money model Option A: a covered line is invoiced at the NUPCO-approved price, with no offer,
    // manual discount or tier discount - the claim must equal the line total, and NUPCO's approved
    // price is not a promotional price. The batch's ERP sale-price override is ignored for the same
    // reason (see wasfatyPricingBatch). Non-covered lines keep their normal pricing untouched.
    const priced = priceCartLine(
      wasfatyPricingItem(item, covered),
      wasfatyPricingBatch(batch, covered, item),
      l.qty,
      covered ? [] : offers,
      covered ? 'normal' : tier,
      l.id,
      covered ? undefined : manualDiscountOf(l),
      l.packLevel ?? 'box',
      covered ? 0 : bogoFreeBaseQtyByLine.get(l.id) ?? 0,
      covered ? false : bogoOfferInEffectByItem.has(l.itemId)
    );
    // priceCartLine rebuilds the whole line from the item/batch, so fields that are NOT pricing
    // inputs have to be carried across explicitly. Directions and the Wasfaty coverage snapshot are
    // two of them: changing qty/level/customer must never drop the patient's directions or turn a
    // covered line back into a private one.
    return {
      ...priced,
      dosage: l.dosage,
      wasfaty: l.wasfaty,
      nupcoCode: l.nupcoCode,
    };
  });
}

function walkInCustomer(): Customer {
  return useCustomerStore.getState().byId('cus-walkin') ?? seedCustomers[0];
}

// Tablets already promised to other lines on the same batch. A packed product can sit in the cart
// twice - once by the box and once as loose tablets - and those two lines must share one shelf
// balance, otherwise each line alone looks affordable and the pair oversells the batch.
function baseUnitsReserved(lines: CartLine[], batchId: string, exceptLineId?: string): number {
  return lines
    .filter((l) => l.batchId === batchId && l.id !== exceptLineId)
    .reduce((sum, l) => sum + (l.baseQty ?? l.qty), 0);
}

// Largest whole number of `level` that still fits on the shelf after `reservedBase` tablets have
// been given to the batch's other lines.
function maxSellableQty(
  item: Item,
  batch: Batch,
  level: PackLevel,
  reservedBase: number
): number {
  const remaining = Math.max(0, batch.qtyOnHand - reservedBase);
  return item.pack ? sellableQty(item.pack, level, remaining) : remaining;
}

export const useCartStore = create<CartState>()((set, get) => ({
  lines: [],
  customer: walkInCustomer(),
  wasfatySession: null,

  startWasfaty: (session) =>
    set((s) => {
      const { itemById } = useCatalogStore.getState();
      // Re-flag everything already on the counter, not only what is scanned afterwards: a cashier
      // often scans first and only then opens the patient's Wasfaty message.
      const lines = s.lines.map((line) => {
        const item = itemById(line.itemId);
        const covered = isWasfatyCoveredItem(item);
        return {
          ...line,
          wasfaty: covered,
          nupcoCode: covered ? item?.nupcoCode : undefined,
        };
      });
      return { wasfatySession: session, lines: priceLines(lines, s.customer.tier) };
    }),

  endWasfaty: () =>
    set((s) => ({
      wasfatySession: null,
      lines: priceLines(
        s.lines.map((line) => ({ ...line, wasfaty: false, nupcoCode: undefined })),
        s.customer.tier,
      ),
    })),

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

    const { batchesForItem, findItemByBarcode } = useCatalogStore.getState();
    // findItemByBarcode covers the primary code plus every extra code listed on the item, so a
    // strip or old-pack barcode still resolves to the same product.
    if (!item) item = findItemByBarcode(lookupCode);
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

  addLineForBatch: (item, batch, qty, packLevel) =>
    set((s) => {
      // A packed product and the same product loose are different lines: they carry different unit
      // prices and different levels, so they're matched by batch AND level, not batch alone.
      const level: PackLevel | undefined = item.pack ? packLevel ?? 'box' : undefined;
      const existing = s.lines.find(
        (l) => l.batchId === batch.id && (l.packLevel ?? undefined) === level
      );
      const { offers } = useCatalogStore.getState();
      const covered = !!s.wasfatySession && isWasfatyCoveredItem(item);
      const reserved = baseUnitsReserved(s.lines, batch.id, existing?.id);
      const maxQty = maxSellableQty(item, batch, level ?? 'box', reserved);
      // Nothing left to sell at this level: don't open an empty line (the POS treats an empty
      // shelf as "out of stock", not as a 0-quantity row the cashier has to delete).
      if (!existing && Math.min(qty, maxQty) <= 0) return {};
      const nextLines = existing
        ? s.lines.map((l) =>
            l.id === existing.id
              ? { ...l, qty: Math.min(existing.qty + qty, Math.max(existing.qty, maxQty)) }
              : l
          )
        : [
            ...s.lines,
            {
              ...priceCartLine(
                wasfatyPricingItem(item, covered),
                wasfatyPricingBatch(batch, covered, item),
                Math.min(qty, maxQty),
                covered ? [] : offers,
                covered ? 'normal' : s.customer.tier,
                undefined,
                undefined,
                level ?? 'box'
              ),
              wasfaty: covered,
              nupcoCode: covered ? item.nupcoCode : undefined,
            },
          ];
      // Reprice the whole cart, not just the touched line: adding this item on a second batch can
      // complete a bundle that spans both lines (see priceLines).
      return { lines: priceLines(nextLines, s.customer.tier) };
    }),

  setLineDosage: (lineId, dosage) =>
    set((s) => ({
      lines: s.lines.map((l) => (l.id === lineId ? { ...l, dosage } : l)),
    })),

  setLinePackLevel: (lineId, packLevel) =>
    set((s) => {
      const { itemById, batchById } = useCatalogStore.getState();
      const line = s.lines.find((l) => l.id === lineId);
      if (!line) return {};
      const item = itemById(line.itemId);
      const batch = batchById(line.batchId);
      if (!item?.pack || !batch) return {};

      // Switching unit keeps the physical amount: 2 boxes -> 24 tablets -> 8 strips. A conversion
      // that leaves less than one whole unit of the new level keeps a single unit (the cashier has
      // explicitly asked for that level) and is then clamped to what the shelf can still cover.
      const perUnit = tabletsPerUnit(item.pack, packLevel);
      const converted = Math.max(1, Math.floor((line.baseQty || line.qty) / perUnit));
      const reserved = baseUnitsReserved(s.lines, line.batchId, lineId);
      const maxQty = Math.max(1, maxSellableQty(item, batch, packLevel, reserved));
      const qty = Math.min(converted, maxQty);
      return {
        lines: priceLines(
          s.lines.map((l) => (l.id === lineId ? { ...l, qty, packLevel } : l)),
          s.customer.tier
        ),
      };
    }),

  updateQty: (lineId, qty) => {
    const line = get().lines.find((l) => l.id === lineId);
    if (!line) return { appliedQty: 0, requestedQty: qty };
    const { batchById, itemById } = useCatalogStore.getState();
    const batch = batchById(line.batchId);
    const item = itemById(line.itemId);
    if (!batch || !item) return { appliedQty: line.qty, requestedQty: qty };
    // The batch's other lines (a sibling box line, for instance) have first claim on the tablets,
    // so this line is capped at what is actually left rather than at the batch's full balance.
    const reserved = baseUnitsReserved(get().lines, line.batchId, lineId);
    const available = maxSellableQty(item, batch, line.packLevel ?? 'box', reserved);
    const clamped = Math.max(1, Math.min(qty, Math.max(1, available)));
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

  clear: () => set({ lines: [], customer: walkInCustomer(), wasfatySession: null }),
}));
