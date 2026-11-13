// pure purchase-invoice math, kept out of the store so it's unit-testable the same way utils/
// pricing.ts is for the sales side. Same building blocks: computeCostPrice (round3 - purchase
// pricing keeps sub-halala precision per the XPH net_pur_price finding) and groupVatByRate so the
// input-tax summary groups per rate exactly like the sales receipt does.
//
// The cascading-tier + bonus model below is verified against the live XPH database (server
// Mahmoud-pc/xph, 2026-10-26):
//   - Tier cascade (legacy call_discount(), SCR 10.58 lines 939-977): tier amounts are taken
//     SEQUENTIALLY off the running balance - t1 = gross*d1, t2 = (gross-t1)*d2, t3 = (gross-t1-t2)*d3 -
//     which is algebraically gross * (1-d1)(1-d2)(1-d3). Live row: 216.80 @ d1 .31 -> tier 67.208,
//     net 149.592, VAT@.15 = 22.438, incl. 172.030.
//   - Bonus (free) goods: gross is PAID qty * price only (st_16-1 = em_5 * sle_4 in the source).
//     Bonus value is tracked separately (TOTAL_BONUS_AMOUNT) and never taxed (live pure-gift rows:
//     PUR_QTY 0 + bonus -> all money columns 0). What bonus DOES change is the batch's per-unit
//     cost: FQTYITEM.NET_PUR_PRICE = net / TOTAL_QTY (paid+bonus) - e.g. 890 paid units +890 bonus
//     live row: 8100.081 net / 500 = 16.200162.
import type { Item, PackLevel } from '../types/catalog';
import type { PurchaseLine, Vendor } from '../types/purchasing';
import { PARTY_TYPE_FLAG, type PartyTypeFlag } from '../types/party';
import { computeCostPrice } from './pricing';
import { PACK_LEVEL_LABEL } from './packUnits';
import { groupVatByRate, round2, round3, type VatBucket } from './vat';

// Up to three cascading discount tiers, as fractions (0.2 = 20%). The SCR entry screen exposes
// exactly three (em_11-1..3); the XPH table physically has five slots but the system's own UI
// only ever prices with three, so three is this app's ceiling too.
export const MAX_PURCHASE_DISCOUNT_TIERS = 3;

// Vendor numbers: a system-assigned, gap-free, human-readable code (VEN-000001...) that is the
// vendor master's stable public key - the analogue of the legacy XPH vendor CUST_NO (vendors live
// in the same customer-numbered records as branch CUST_TYPE/CUST_NO rows). Users never type it:
// addVendor derives it from the highest existing number, so a deleted/renamed vendor can never
// leave a hole or collide, and purchase history stays readable even after a vendor is renamed.
export const VENDOR_NO_PREFIX = 'VEN-';

function formatVendorNumber(n: number): string {
  return `${VENDOR_NO_PREFIX}${String(n).padStart(6, '0')}`;
}

// Exported for the persist-merge backfill: vendors saved before vendor numbers existed get the
// next free number without ever colliding with an already-numbered (seed or user) row.
export function formatVendorNo(n: number): string {
  return formatVendorNumber(n);
}

// Highest numeric suffix currently in use (0 when none valid) - the merge backfill and
// nextVendorNumber share this so persisted-vendor backfill can never duplicate a number.
export function maxVendorNumber(vendors: Pick<Vendor, 'vendorNo'>[]): number {
  let max = 0;
  for (const v of vendors) {
    const match = /^VEN-(\d+)$/.exec(v.vendorNo ?? '');
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

// The number the NEXT saved vendor gets (previewed read-only on the form; addVendor is the one
// that actually assigns it, exactly like nextPurchaseNo vs receivePurchaseInvoice).
export function nextVendorNumber(vendors: Pick<Vendor, 'vendorNo'>[]): string {
  return formatVendorNumber(maxVendorNumber(vendors) + 1);
}

// Customer accounts (FCODCSVN type_flag = 2) share the same table and the same gap-free numbering
// rule, but a CUS- prefix keeps the two sides readable at a glance.
export const CUSTOMER_NO_PREFIX = 'CUS-';

export function formatCustomerNo(n: number): string {
  return `${CUSTOMER_NO_PREFIX}${String(n).padStart(6, '0')}`;
}

export function maxCustomerNumber(parties: Pick<Vendor, 'vendorNo'>[]): number {
  let max = 0;
  for (const p of parties) {
    const match = /^CUS-(\d+)$/.exec(p.vendorNo ?? '');
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

export function nextCustomerNumber(parties: Pick<Vendor, 'vendorNo'>[]): string {
  return formatCustomerNo(maxCustomerNumber(parties) + 1);
}

// Generic helper for the shared party table: the next number on the requested side.
export function nextPartyNumber(parties: Pick<Vendor, 'vendorNo'>[], typeFlag: PartyTypeFlag): string {
  return typeFlag === PARTY_TYPE_FLAG.customer
    ? nextCustomerNumber(parties)
    : nextVendorNumber(parties);
}

export interface PricePurchaseLineInput {
  item: Item;
  qty: number; // PAID units (bonus excluded)
  bonusQty?: number; // free units on this delivery line, default 0
  // Packed items: the unit the vendor invoice is written in (default box). Quantity, price and
  // bonus are all in this unit.
  packLevel?: PackLevel;
  batchNo: string;
  expiryDate: string;
  unitPurchasePrice: number;
  // tier-1 shorthand - keeps the single-discount callers (tests, old snippets) working exactly
  // as before. Ignored when discountTiers is provided.
  purchaseDiscountPercent?: number;
  // full cascade, fractions - wins over purchaseDiscountPercent when present
  discountTiers?: number[];
  existingId?: string; // preserved when re-pricing an edited line
}

// The tiers compose multiplicatively, NOT additively: 10% + 20% + 30% is 1-(0.9*0.8*0.7) = 49.6%,
// not 60% - because tier N's base is what the previous tiers already left (verified: live row
// 68.65*5 @ d1 .32 -> tier amount exactly 109.84 off the 343.25 gross).
export function effectiveTierDiscount(percents: number[]): number {
  return 1 - percents.slice(0, MAX_PURCHASE_DISCOUNT_TIERS).reduce((acc, d) => acc * (1 - Math.max(0, Math.min(d, 1))), 1);
}

// Folds the free-goods dilution into one fraction for batch costing: net / (paid+bonus) units,
// i.e. 1 - netExclVat / (totalQty * unitPrice). With no bonus this comes out equal to the pure
// tier-effective discount (net = gross * tiers), so single-bonus-less callers get identical
// Batch.costPrice values as before. A pure-gift delivery (net 0) fully dilutes to discount 1 ->
// round3 cost 0, matching live XPH gift rows.
export function batchReceiveDiscount(netExclVat: number, totalQty: number, unitPurchasePrice: number): number {
  if (totalQty <= 0 || unitPurchasePrice <= 0) return 1;
  const diluted = 1 - netExclVat / (totalQty * unitPurchasePrice);
  return Math.max(0, Math.min(diluted, 1));
}

interface TierCascade {
  tierPercents: [number, number, number];
  tierAmounts: [number, number, number];
  netExclVat: number;
}

// The tier cascade shared by pricePurchaseLine and dilutedUnitCost, so the line and the previewed
// batch cost can never drift apart. Legacy screens round each tier step at 3 decimals (###.###
// masks on st_11-n/st_12-n) - not rounding here would let a phantom 0.001 halala bleed along.
function runTierCascade(gross: number, tiers: number[]): TierCascade {
  const tierPercents: [number, number, number] = [0, 0, 0];
  const tierAmounts: [number, number, number] = [0, 0, 0];
  const capped = tiers.slice(0, MAX_PURCHASE_DISCOUNT_TIERS);
  let balance = gross;
  for (let i = 0; i < capped.length; i++) {
    const d = Math.max(0, Math.min(capped[i] ?? 0, 1));
    tierPercents[i] = d;
    const amount = round3(balance * d);
    tierAmounts[i] = amount;
    balance = round3(balance - amount);
  }
  return { tierPercents, tierAmounts, netExclVat: balance };
}

export interface DilutedUnitCostInput {
  qty: number; // PAID units
  bonusQty?: number; // free units, default 0
  unitPurchasePrice: number;
  purchaseDiscountPercent?: number; // tier-1 shorthand, ignored when discountTiers is given
  discountTiers?: number[]; // the full cascade, fractions
}

// The per-unit cost the BATCH will actually be stocked at: the vendor's net (after the cascade)
// spread over every unit received, paid + bonus. qty 100 + bonus 10 @ 20 with no discounts ->
// round3(2000 / 110) = 18.182, and the same with disc1 10% -> round3(1800 / 110) = 16.364. This
// is the legacy FQTYITEM.NET_PUR_PRICE convention (see batchReceiveDiscount) and the number the
// purchase-invoice screen shows as "Unit cost". A pure-gift delivery (qty 0) costs 0.
export function dilutedUnitCost(input: DilutedUnitCostInput): number {
  const qty = Math.max(0, input.qty);
  const totalQty = qty + Math.max(0, input.bonusQty ?? 0);
  if (totalQty <= 0 || input.unitPurchasePrice <= 0) return 0;
  const tiers = input.discountTiers ?? [input.purchaseDiscountPercent ?? 0];
  const { netExclVat } = runTierCascade(round2(qty * input.unitPurchasePrice), tiers);
  return round3(netExclVat / totalQty);
}

// Prices one line off a vendor invoice, using the item master only for identity/VAT - the batch
// fields (batchNo/expiry) are per-line vendor data, not derived.
export function pricePurchaseLine(input: PricePurchaseLineInput): PurchaseLine {
  const { item, qty, batchNo, expiryDate, unitPurchasePrice, existingId } = input;
  const bonusQty = Math.max(0, input.bonusQty ?? 0);
  const gross = round2(qty * unitPurchasePrice); // PAID gross only - bonus is charged at 0
  const tiers = input.discountTiers ?? [input.purchaseDiscountPercent ?? 0];
  const { tierPercents, tierAmounts, netExclVat } = runTierCascade(gross, tiers);
  const discountTotal = round3(gross - netExclVat);
  const effective = effectiveTierDiscount(tierPercents);
  // Per PAID unit - the undiluted vendor price after his own tiers. Kept alongside the diluted
  // batch cost so the line documents both: what the vendor charged per paid unit, and what each
  // shelf unit (paid + bonus) actually costs once the free goods are spread across the delivery.
  const unitCostPrice = computeCostPrice(unitPurchasePrice, effective);
  const totalQty = qty + bonusQty;
  const dilutedUnitCostPrice = totalQty > 0 ? round3(netExclVat / totalQty) : 0;
  const vatAmount = round2(netExclVat * item.vatRate); // on the paid net only - bonus never taxed
  const packLevel: PackLevel | undefined = item.pack ? input.packLevel ?? 'box' : undefined;

  return {
    id: existingId ?? `pl-${item.id}-${batchNo}-${Date.now()}`,
    itemId: item.id,
    itemNameAr: item.nameAr,
    itemNameEn: item.nameEn,
    unit: packLevel ? PACK_LEVEL_LABEL[packLevel] : item.unit,
    packLevel,
    vatRate: item.vatRate,
    batchNo,
    expiryDate,
    qty,
    bonusQty,
    totalQty,
    bonusValue: round2(bonusQty * unitPurchasePrice),
    unitPurchasePrice,
    discount1Percent: tierPercents[0],
    discount2Percent: tierPercents[1],
    discount3Percent: tierPercents[2],
    discount1Amount: tierAmounts[0],
    discount2Amount: tierAmounts[1],
    discount3Amount: tierAmounts[2],
    discountTotal,
    purchaseDiscountPercent: effective,
    unitCostPrice,
    dilutedUnitCostPrice,
    netExclVat,
    vatAmount,
    totalInclVat: round2(netExclVat + vatAmount),
  };
}

export interface PurchaseTotals {
  subtotalExclVat: number; // gross, before the vendor discounts listed per line
  totalDiscount: number;
  totalBonusValue: number; // what the free goods were worth at line prices
  netExclVat: number; // subtotal - discounts = the taxable base across lines
  totalVatAmount: number; // recoverable input tax across all lines
  totalInclVat: number; // the vendor paper invoice's actual bottom line - verify against it
  vatByRate: VatBucket[];
}

export function computePurchaseTotals(lines: PurchaseLine[]): PurchaseTotals {
  const subtotalExclVat = round2(lines.reduce((s, l) => s + round2(l.qty * l.unitPurchasePrice), 0));
  const totalDiscount = round2(lines.reduce((s, l) => s + l.discountTotal, 0));
  const totalBonusValue = round2(lines.reduce((s, l) => s + l.bonusValue, 0));
  const totalVatAmount = round2(lines.reduce((s, l) => s + l.vatAmount, 0));
  const vatByRate = groupVatByRate(lines);
  const totalInclVat = round2(lines.reduce((s, l) => s + l.totalInclVat, 0));
  const netExclVat = round2(lines.reduce((s, l) => s + l.netExclVat, 0));

  return { subtotalExclVat, totalDiscount, totalBonusValue, netExclVat, totalVatAmount, totalInclVat, vatByRate };
}

// The single convention for every discount field and readout in the app: the user types the
// percentage with the legacy ##.## mask (16.67), the app stores the fraction (0.1667), and every
// readout prints it back as 16.67%.
export const DISCOUNT_FRACTION_HINT = 'e.g. 0.1667 = 16.67%';

// Up to two digits before and two after the decimal - the same 00.00 mask the legacy screens used.
export const DISCOUNT_INPUT_PATTERN = /^\d{0,2}(\.\d{0,2})?$/;

// The discount fields use a fixed ##.## mask, so the user never has to type the point: digits only
// insert it automatically after the second digit (1214 -> 12.14, 1667 -> 16.67). An explicitly
// typed point still works and is validated by the same mask. Returns null for anything that must
// be ignored - letters, a third decimal place - so the field keeps its last good value.
export function applyDiscountMask(raw: string): string | null {
  if (!/^[\d.]*$/.test(raw)) return null;
  if (raw.includes('.')) return DISCOUNT_INPUT_PATTERN.test(raw) ? raw : null;
  if (raw.length <= 2) return raw;
  return `${raw.slice(0, 2)}.${raw.slice(2, 4)}`;
}

// Seed an edit field from the stored fraction: 0.1667 -> "16.67", 0.05 -> "5.00".
export function formatDiscountInput(fraction: number): string {
  return (fraction * 100).toFixed(2);
}

// Convert the typed ##.## percentage back to the fraction the pricing/store layer expects.
export function discountInputToFraction(value: string): number {
  return (Number(value) || 0) / 100;
}

export function formatDiscountPercent(percent: number): string {
  return `${(percent * 100).toFixed(2)}%`;
}
