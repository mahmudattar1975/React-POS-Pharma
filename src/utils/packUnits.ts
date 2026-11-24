// Pack ladder: how one carton, box, strip and tablet relate for a single item.
//
// Why this exists: a pharmacy receives a product in cartons, shelves it in boxes, and often sells a
// single strip or a few loose tablets. Stock is therefore always counted in the SMALLEST unit
// (tablets) and every other level is just a multiplier. Keeping one base unit is what stops the
// classic "1 box on hand" vs "12 tablets on hand" drift.
//
// Pricing follows the business rule confirmed with the owner: the BOX price is typed in, and the
// strip/tablet prices are derived from how many fit in a box. The division is kept exact (no
// per-level rounding) so buying all 12 tablets of a 10.00 box adds up to exactly 10.00; only line
// totals are rounded, like every other money value in the app.
//
// Units (UN/ECE Recommendation 20): carton XCT, box XBX, strip SR, tablet U2. Kept for reference
// when ZATCA line unit codes are wired through per pack level.
import type { PackConfig, PackLevel } from '../types/catalog';

export const PACK_LEVELS: PackLevel[] = ['carton', 'box', 'strip', 'tablet'];

// The levels a cashier may actually sell, in the order they appear in the POS selector.
export const SELLABLE_PACK_LEVELS: PackLevel[] = ['box', 'strip', 'tablet'];

// Levels a delivery can be received/priced in. Cartons are a purchasing-only unit, and only when
// the product actually has a carton size (see purchasePackLevels).
export const PURCHASE_PACK_LEVELS: PackLevel[] = ['carton', 'box', 'strip'];

// The purchase/receiving levels that apply to one item: no carton row for ladders that stop at the
// box, so a receiver is never asked to describe 12 boxes as "1 carton".
export function purchasePackLevels(pack: PackConfig): PackLevel[] {
  return hasCarton(pack) ? PURCHASE_PACK_LEVELS : PURCHASE_PACK_LEVELS.filter((level) => level !== 'carton');
}

export const PACK_LEVEL_LABEL: Record<PackLevel, string> = {
  carton: 'Carton',
  box: 'Box',
  strip: 'Strip',
  tablet: 'Tablet',
};

export const PACK_LEVEL_LABEL_PLURAL: Record<PackLevel, string> = {
  carton: 'Cartons',
  box: 'Boxes',
  strip: 'Strips',
  tablet: 'Tablets',
};

// A ladder may stop at the box: some products are never bought or counted in cartons, so the
// carton multiplier is stored as 1. Every carton-aware view hides that level instead of pretending
// "1 carton = 1 box".
export function hasCarton(pack: PackConfig): boolean {
  return positiveInt(pack.cartonSize) > 1;
}

// UN/ECE Recommendation 20/21 codes, used when a sale line needs to name the unit to ZATCA.
export const PACK_LEVEL_UNIT_CODE: Record<PackLevel, string> = {
  carton: 'XCT',
  box: 'XBX',
  strip: 'SR',
  tablet: 'U2',
};

function positiveInt(value: number | undefined): number {
  return Number.isFinite(value) && (value as number) >= 1 ? Math.floor(value as number) : 1;
}

export function hasPack(item: { pack?: PackConfig }): boolean {
  return !!item.pack;
}

// How many tablets one unit of `level` contains. A malformed/partial config degrades to 1 instead
// of producing NaN, so a bad persisted row can never zero out stock.
export function tabletsPerUnit(pack: PackConfig, level: PackLevel): number {
  const boxSize = positiveInt(pack.boxSize);
  const stripSize = positiveInt(pack.stripSize);
  const cartonSize = positiveInt(pack.cartonSize);
  const perBox = boxSize * stripSize;
  switch (level) {
    case 'carton':
      return cartonSize * perBox;
    case 'box':
      return perBox;
    case 'strip':
      return stripSize;
    case 'tablet':
      return 1;
  }
}

export function tabletsPerBox(pack: PackConfig): number {
  return tabletsPerUnit(pack, 'box');
}

// Box price / how many tablets are in a box, scaled up to the requested level. Exact on purpose:
// 10.00 box -> 3.3333... strip -> 0.8333... tablet, so 12 tablets re-add to exactly 10.00.
export function priceForLevel(boxPrice: number, pack: PackConfig, level: PackLevel): number {
  if (level === 'box') return boxPrice;
  return (boxPrice * tabletsPerUnit(pack, level)) / tabletsPerBox(pack);
}

// Largest whole number of `level` sellable from a tablet stock count (e.g. 11 tablets = 2 strips).
export function sellableQty(pack: PackConfig, level: PackLevel, stockTablets: number): number {
  if (stockTablets <= 0) return 0;
  return Math.floor(stockTablets / tabletsPerUnit(pack, level));
}

// Tablet quantity represented by `qty` of `level`.
export function toBaseQty(pack: PackConfig, level: PackLevel, qty: number): number {
  return qty * tabletsPerUnit(pack, level);
}

export interface PackBreakdown {
  carton: number;
  box: number;
  strip: number;
  tablet: number;
}

// Splits a tablet count into whole cartons, boxes, strips and leftover tablets. A ladder with no
// carton (cartonSize 1) starts at boxes and reports carton 0.
export function breakdown(pack: PackConfig, stockTablets: number): PackBreakdown {
  let rest = Math.max(0, Math.floor(stockTablets));
  const carton = hasCarton(pack) ? Math.floor(rest / tabletsPerUnit(pack, 'carton')) : 0;
  if (carton > 0) rest -= carton * tabletsPerUnit(pack, 'carton');
  const box = Math.floor(rest / tabletsPerUnit(pack, 'box'));
  rest -= box * tabletsPerUnit(pack, 'box');
  const strip = Math.floor(rest / tabletsPerUnit(pack, 'strip'));
  rest -= strip * tabletsPerUnit(pack, 'strip');
  return { carton, box, strip, tablet: rest };
}

// "1 carton + 2 boxes + 3 strips + 4 tablets" (zero parts omitted). Falls back to "0 tablets"
// so the caller never has to special-case an empty shelf.
export function formatPackBreakdown(pack: PackConfig, stockTablets: number): string {
  const parts = breakdown(pack, stockTablets);
  const chunks = PACK_LEVELS.filter((level) => parts[level] > 0).map(
    (level) => `${parts[level]} ${parts[level] === 1 ? PACK_LEVEL_LABEL[level].toLowerCase() : PACK_LEVEL_LABEL_PLURAL[level].toLowerCase()}`
  );
  return chunks.length > 0 ? chunks.join(' + ') : '0 tablets';
}

// Compact form for table cells: "2 ct + 3 bx + 1 st + 2 tab".
export function formatPackShort(pack: PackConfig, stockTablets: number): string {
  const parts = breakdown(pack, stockTablets);
  const chunks = PACK_LEVELS.filter((level) => parts[level] > 0).map((level) => {
    const short = level === 'carton' ? 'ct' : level === 'box' ? 'bx' : level === 'strip' ? 'st' : 'tab';
    return `${parts[level]} ${short}`;
  });
  return chunks.length > 0 ? chunks.join(' + ') : '0 tab';
}

// Human wording of the ladder itself, shown under the Item Master fields. The carton clause is
// omitted for ladders that stop at the box.
export function describePack(pack: PackConfig): string {
  const box = `1 box = ${pack.boxSize} strips · 1 strip = ${pack.stripSize} tablets · 1 box = ${tabletsPerBox(pack)} tablets`;
  return hasCarton(pack) ? `1 carton = ${pack.cartonSize} boxes · ${box}` : box;
}

// Per-unit prices can legitimately sit below a halala (0.225 SAR per tablet), so a plain 2-decimal
// money format would show 0.23 and break the "box price / pack size" arithmetic on screen. Show up
// to 3 decimals, trimming to at least 2: 4.50, 2.25, 0.225.
export function formatUnitPrice(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return rounded
    .toFixed(3)
    .replace(/(\.\d\d)0$/, '$1')
    .replace(/(\.\d)00$/, '$1')
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
