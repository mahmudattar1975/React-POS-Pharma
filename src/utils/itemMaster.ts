// Item Master rules, split out of the page/store so validation is testable and the same rules are
// enforced no matter which caller creates or edits an item.
//
// The field set follows the legacy PowerBuilder screen `w_scrn_stock_data` in phstock.pbl
// ("بيانات المخزون"): item number, Arabic/English names, barcode, GTIN, registration/customs/
// manufacturer numbers, category, unit, location, VAT, reorder/max limits, carton quantity and an
// active (yes/no) status. Stock quantities are kept on Batch rows, not on the item itself, so the
// Item Master reads them through itemMovementTotals below rather than storing a denormalised
// balance that could drift away from the batches.
import type { Batch, ControlledStatus, Item, ItemCategory, PackConfig, PackLevel } from '../types/catalog';
import { itemCategoryLabel, resolveItemCategory } from './itemCategories';
import { seedItemCategories } from './seedData';
import { tabletsPerBox } from './packUnits';
import { isValidNupcoCode, nupcoCodeConflictMessage, normaliseNupcoCode } from './wasfaty';

// KSA pharmacy reality: SFDA-registered medicines are zero-rated, almost everything else on the
// shelf is standard-rated at 15%. Kept as an explicit list (rather than a free number box) so a
// typo can't silently file a medicine at 5% VAT.
export const ITEM_VAT_RATES = [0, 0.15] as const;

export interface ItemMasterFormValues {
  barcode: string;
  // Every other code the same product carries. The primary `barcode` is always row 0 in the form;
  // this array is rows 1..n (see components/Inventory/ItemMasterFormDialog.tsx).
  barcodes: string[];
  gtin: string; // legacy field - migrated into the barcode list on first edit
  nameAr: string;
  nameEn: string;
  category: string;
  // Dropdown value as a string so an empty Select is represented by ''. On save it becomes the
  // numeric Categories link; the category text is kept in sync with the selected master row.
  categoryId: string;
  // Stable dbo.BrandMaster link, kept as a string so an empty Select is ''. The bilingual label is
  // resolved from the master on display; only the id is persisted on the item.
  brandId: string;
  unit: string;
  basePrice: string;
  costPrice: string; // optional item-level cost, kept as a string for the number input
  vatRate: string; // one of ITEM_VAT_RATES, kept as a string for <Select> value handling
  reorderLevel: string;
  maxLevel: string;
  cartonQty: string;
  // Nested pack ladder, all blank for a plain single-unit item. When filled, quantities are
  // counted in TABLETS and basePrice becomes the BOX price (utils/packUnits.ts).
  packCarton: string; // boxes per carton
  packBox: string; // strips per box
  packStrip: string; // tablets per strip
  // Only meaningful when an EXISTING unpacked item is being converted: the unit its current stock
  // is counted in, so on-hand batches can be converted to tablets on save. Blank = no conversion.
  stockUnit: PackLevel | '';
  location: string;
  registrationNo: string;
  customsNo: string;
  manufacturerNo: string;
  vendorNo: string;
  scientificName: string;
  requiresBatchTracking: boolean;
  // Whether the item has an expiry date at all. Most pharmacy stock does; supplies/equipment do
  // not, and receiving one must not invent a 1900-01-01 date that FEFO would treat as expired.
  hasExpiry: boolean;
  isActive: boolean;
  controlledStatus: ControlledStatus | '';
  // Independent dbo.items booleans. Kept alongside the existing batch/expiry/active switches so
  // the master screen exposes every flag SQL stores rather than inferring any of them.
  requiresPrescription: boolean;
  isControlledDrug: boolean;
  isTaxable: boolean;
  isTemperatureSensitive: boolean;
  requiresSerialNumber: boolean;
  isNarcotic: boolean;
  // Dosage-instruction library links. The item can carry several suitable directions and mark one
  // as the suggested default for the POS; both are optional. Kept as ids, not copied text, so a
  // correction in the library reaches every linked item at once.
  dosageIds: string[];
  defaultDosageId: string;
  // Wasfaty/NUPCO mapping. `nupcoCode` is the 13-digit code from NUPCO's approved item list and it
  // must be unique across the catalogue; `wasfatyPrice` is the NUPCO-approved selling price (blank
  // = the normal sale price is the approved price); `wasfatyEligible` marks an item as being on the
  // approved list even before its code is entered, so the POS can block it with a fix path instead
  // of treating it as a private (patient-paid) item.
  nupcoCode: string;
  wasfatyPrice: string;
  wasfatyEligible: boolean;
}

export type ItemFormErrors = Partial<Record<keyof ItemMasterFormValues, string>>;

export const EMPTY_ITEM_FORM: ItemMasterFormValues = {
  barcode: '',
  barcodes: [],
  gtin: '',
  nameAr: '',
  nameEn: '',
  category: '',
  categoryId: '',
  brandId: '',
  unit: '',
  basePrice: '',
  costPrice: '',
  vatRate: '0',
  reorderLevel: '0',
  maxLevel: '',
  cartonQty: '',
  packCarton: '',
  packBox: '',
  packStrip: '',
  stockUnit: '',
  location: '',
  registrationNo: '',
  customsNo: '',
  manufacturerNo: '',
  vendorNo: '',
  scientificName: '',
  requiresBatchTracking: true,
  hasExpiry: true,
  isActive: true,
  controlledStatus: '',
  requiresPrescription: false,
  isControlledDrug: false,
  isTaxable: true,
  isTemperatureSensitive: false,
  requiresSerialNumber: false,
  isNarcotic: false,
  dosageIds: [],
  defaultDosageId: '',
  nupcoCode: '',
  wasfatyPrice: '',
  wasfatyEligible: false,
};

function numberOrBlank(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

// Legacy items describe their selling unit as free text ("Strip", "Box", "Bottle"...). When such an
// item is given a pack ladder, its on-hand stock is still counted in that unit, so the form offers
// it as the conversion source. Unrecognised units stay blank and the owner picks the level by hand.
const UNIT_TO_PACK_LEVEL: Record<string, PackLevel> = {
  carton: 'carton',
  cartons: 'carton',
  box: 'box',
  boxes: 'box',
  strip: 'strip',
  strips: 'strip',
  tablet: 'tablet',
  tablets: 'tablet',
  tab: 'tablet',
  tabs: 'tablet',
  piece: 'tablet',
  pieces: 'tablet',
  pc: 'tablet',
  pcs: 'tablet',
};

export function packLevelFromUnit(unit: string): PackLevel | undefined {
  return UNIT_TO_PACK_LEVEL[unit.trim().toLowerCase()];
}

export function itemToForm(item: Item, categories: ItemCategory[] = seedItemCategories): ItemMasterFormValues {
  const linkedCategory = resolveItemCategory(item.categoryId ?? item.category, categories);
  return {
    barcode: item.barcode,
    // A legacy GTIN is just another printed code, so it joins the list on first edit instead of
    // staying a separate field that could contradict the barcode list.
    barcodes: [item.gtin ?? '', ...(item.barcodes ?? [])]
      .map((code) => code.trim())
      .filter((code, index, all) => code !== '' && code !== item.barcode.trim() && all.indexOf(code) === index),
    gtin: '',
    nameAr: item.nameAr,
    nameEn: item.nameEn,
    category: linkedCategory ? itemCategoryLabel(linkedCategory) : item.category,
    categoryId: linkedCategory ? String(linkedCategory.categoryId) : '',
    brandId: item.brandId ? String(item.brandId) : '',
    unit: item.unit,
    basePrice: String(item.basePrice),
    costPrice: numberOrBlank(item.costPrice),
    vatRate: String(item.vatRate),
    reorderLevel: String(item.reorderLevel),
    maxLevel: numberOrBlank(item.maxLevel),
    cartonQty: numberOrBlank(item.cartonQty),
    packCarton: item.pack && item.pack.cartonSize > 1 ? String(item.pack.cartonSize) : '',
    packBox: item.pack ? String(item.pack.boxSize) : '',
    packStrip: item.pack ? String(item.pack.stripSize) : '',
    // A packed item already counts its shelf in tablets, so there is nothing to convert. An
    // unpacked one may have stock counted in whatever its Unit field says.
    stockUnit: item.pack ? '' : (packLevelFromUnit(item.unit) ?? ''),
    location: item.location ?? '',
    registrationNo: item.registrationNo ?? '',
    customsNo: item.customsNo ?? '',
    manufacturerNo: item.manufacturerNo ?? '',
    vendorNo: item.vendorNo ?? '',
    scientificName: item.scientificName ?? '',
    requiresBatchTracking: item.requiresBatchTracking,
    hasExpiry: item.hasExpiry !== false,
    isActive: item.isActive !== false,
    controlledStatus: item.controlledStatus ?? '',
    // Undefined means the SQL default (false for restrictions, true for taxable).
    requiresPrescription: item.requiresPrescription === true,
    isControlledDrug: item.isControlledDrug === true,
    isTaxable: item.isTaxable !== false,
    isTemperatureSensitive: item.isTemperatureSensitive === true,
    requiresSerialNumber: item.requiresSerialNumber === true,
    isNarcotic: item.isNarcotic === true,
    dosageIds: item.dosageIds ?? [],
    defaultDosageId: item.defaultDosageId ?? '',
    nupcoCode: item.nupcoCode ?? '',
    wasfatyPrice: numberOrBlank(item.wasfatyPrice),
    // A stored code means the item is on the list even if an older row never stored the flag.
    wasfatyEligible: item.wasfatyEligible === true || !!item.nupcoCode,
  };
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

// Every caller that decides whether to ask for an expiry date goes through this: undefined means
// yes, so an item saved before the flag existed keeps the old behaviour.
export function itemTracksExpiry(item: Pick<Item, 'hasExpiry'>): boolean {
  return item.hasExpiry !== false;
}

// The Barcode field is an internal identifier (the legacy screen's "القارئ الضوئي"), not
// necessarily a strict GTIN - keep it alphanumeric but forbid spaces and symbols that would make it
// impossible to scan/type back. GTIN is stricter (digits only) because it is a real GS1 key.
// '@' appears in the owner's legacy supplier codes (e.g. 04694@43983), so it is a valid printed
// code character alongside the usual GS1 digits and internal SKU punctuation.
const BARCODE_RE = /^[0-9A-Za-z._@-]{4,32}$/;

// All scannable codes an item answers to: the primary one, any legacy GTIN, and the extra codes
// typed into the Item Master list. Used for duplicate checks and for the POS scan lookup, so a
// strip barcode or an old pack code always finds the same product.
export function itemCodes(item: Pick<Item, 'barcode' | 'gtin' | 'barcodes'>): string[] {
  return [item.barcode, item.gtin ?? '', ...(item.barcodes ?? [])]
    .map((code) => code.trim())
    .filter((code, index, all) => code !== '' && all.indexOf(code) === index);
}

// The item (other than the one being edited) that already owns `code`, if any.
export function duplicateCodeOwner(items: Item[], code: string, editingId?: string): Item | undefined {
  const key = code.trim().toLowerCase();
  if (!key) return undefined;
  return items.find((i) => i.id !== editingId && itemCodes(i).some((c) => c.toLowerCase() === key));
}

// As-you-type guard for the barcode list: returns the message the Item Master shows under a code
// that is already printed on a different item. Surfacing it immediately means the owner never has
// to press Save to discover the clash - and sees WHY the save would be refused.
export function codeConflictMessage(items: Item[], code: string, editingId?: string): string | undefined {
  const trimmed = code.trim();
  if (!trimmed) return undefined;
  const owner = duplicateCodeOwner(items, trimmed, editingId);
  if (!owner) return undefined;
  return `Already used by ${owner.nameEn} (${itemNumberOf(owner) ?? owner.id}).`;
}

export function isValidBarcode(code: string): boolean {
  return BARCODE_RE.test(code.trim());
}

export function duplicateIdentityErrors(
  items: Item[],
  barcode: string,
  gtin: string,
  editingId?: string,
  extraCodes: string[] = []
): { barcode?: string; gtin?: string } {
  const errors: { barcode?: string; gtin?: string } = {};
  const clashOf = (code: string) => duplicateCodeOwner(items, code, editingId);
  const clash = clashOf(barcode);
  if (clash) errors.barcode = `Barcode already used by ${clash.nameEn} (${itemNumberOf(clash) ?? clash.id}).`;
  if (gtin.trim()) {
    const gtinClash = clashOf(gtin);
    if (gtinClash) errors.gtin = `Barcode already used by ${gtinClash.nameEn} (${itemNumberOf(gtinClash) ?? gtinClash.id}).`;
  }
  // Extras are validated field-by-field in validateItemForm; here we only need the store-side
  // guarantee that none of them collides with another product.
  for (const code of extraCodes) {
    const extraClash = clashOf(code);
    if (extraClash) {
      errors.barcode = errors.barcode ?? `Barcode already used by ${extraClash.nameEn} (${itemNumberOf(extraClash) ?? extraClash.id}).`;
      break;
    }
  }
  return errors;
}

// Store-side guard: the dialog validates field-by-field first, but a direct call from elsewhere
// (tests, a future import) must never be able to create two items sharing a code.
export function assertItemIdentityUnique(
  items: Item[],
  barcode: string,
  gtin: string,
  editingId?: string,
  extraCodes: string[] = []
): void {
  const errors = duplicateIdentityErrors(items, barcode, gtin, editingId, extraCodes);
  const first = errors.barcode ?? errors.gtin;
  if (first) throw new Error(first);
}

// Pack ladder read from the three optional rows. Blank everywhere = no ladder (ordinary item).
// Strips-per-box and tablets-per-strip are required together; boxes-per-carton is optional and a
// blank carton means the ladder stops at the box (stored as cartonSize 1). Returns undefined for
// partial/invalid input so a rejected form can never persist a half-configured ladder.
export function formPack(
  values: Pick<ItemMasterFormValues, 'packCarton' | 'packBox' | 'packStrip'>
): PackConfig | undefined {
  const cartonRow = values.packCarton.trim();
  const boxRow = values.packBox.trim();
  const stripRow = values.packStrip.trim();
  if (cartonRow === '' && boxRow === '' && stripRow === '') return undefined;
  const boxSize = Number(boxRow);
  const stripSize = Number(stripRow);
  if (![boxSize, stripSize].every((n) => Number.isInteger(n) && n >= 1)) return undefined;
  if (cartonRow === '') return { cartonSize: 1, boxSize, stripSize };
  const cartonSize = Number(cartonRow);
  if (!Number.isInteger(cartonSize) || cartonSize < 1) return undefined;
  return { cartonSize, boxSize, stripSize };
}

export function validateItemForm(
  values: ItemMasterFormValues,
  items: Item[],
  editingId?: string
): ItemFormErrors {
  const errors: ItemFormErrors = {};

  if (!values.nameEn.trim()) errors.nameEn = 'English name is required.';

  const barcode = values.barcode.trim();
  if (!barcode) errors.barcode = 'Barcode is required.';
  else if (!isValidBarcode(barcode)) errors.barcode = 'Use 4-32 letters, digits, dots, dashes, @ or underscores (no spaces).';

  // Extra codes: trimmed, blank rows ignored, duplicates inside the list rejected, and every code
  // checked against the rest of the catalog so two products can never answer to the same scan.
  const extras = values.barcodes
    .map((code) => code.trim())
    .filter((code) => code !== '' && code !== barcode);
  const seen = new Set<string>([barcode.toLowerCase()]);
  for (const code of extras) {
    if (!isValidBarcode(code)) {
      errors.barcodes = `"${code}" is not a valid barcode — use 4-32 letters, digits, dots, dashes, @ or underscores.`;
      break;
    }
    const key = code.toLowerCase();
    if (seen.has(key)) {
      errors.barcodes = `"${code}" is listed twice.`;
      break;
    }
    seen.add(key);
    const owner = duplicateCodeOwner(items, code, editingId);
    if (owner) {
      errors.barcodes = `Barcode ${code} already used by ${owner.nameEn} (${itemNumberOf(owner) ?? owner.id}).`;
      break;
    }
  }

  if (!errors.barcode) {
    const duplicates = duplicateIdentityErrors(items, barcode, '', editingId);
    if (duplicates.barcode) errors.barcode = duplicates.barcode;
  }

  const price = Number(values.basePrice);
  if (values.basePrice.trim() === '' || !Number.isFinite(price) || price < 0) {
    errors.basePrice = 'Enter a sale price of 0 or more.';
  }

  // Cost is optional, but a typed value must be a real non-negative number so a stray character
  // cannot silently become NaN in the shared catalogue.
  if (values.costPrice.trim() !== '') {
    const cost = Number(values.costPrice);
    if (!Number.isFinite(cost) || cost < 0) errors.costPrice = 'Enter a cost price of 0 or more, or leave it blank.';
  }

  const reorder = Number(values.reorderLevel);
  if (values.reorderLevel.trim() === '' || !Number.isInteger(reorder) || reorder < 0) {
    errors.reorderLevel = 'Enter a whole number of 0 or more.';
  }

  let maxLevel: number | undefined;
  if (values.maxLevel.trim() !== '') {
    maxLevel = Number(values.maxLevel);
    if (!Number.isInteger(maxLevel) || maxLevel < 0) {
      errors.maxLevel = 'Enter a whole number of 0 or more.';
    } else if (!errors.reorderLevel && maxLevel < reorder) {
      errors.maxLevel = 'Max limit must be at least the reorder level.';
    }
  }

  if (values.cartonQty.trim() !== '') {
    const carton = Number(values.cartonQty);
    if (!Number.isInteger(carton) || carton < 1) errors.cartonQty = 'Carton quantity must be a whole number of 1 or more.';
  }

  // Pack ladder: strips-per-box and tablets-per-strip go together; boxes-per-carton is optional
  // (blank = no carton level) so a product bought only in boxes still gets strip/tablet pricing.
  // A lone carton row would leave the rest of the ladder ambiguous and is rejected.
  const boxRow = values.packBox.trim();
  const stripRow = values.packStrip.trim();
  const cartonRow = values.packCarton.trim();
  if (boxRow === '' && stripRow === '') {
    if (cartonRow !== '') {
      errors.packBox = 'Fill strips per box and tablets per strip too (carton alone is not a ladder).';
    }
  } else if (boxRow === '' || stripRow === '') {
    errors[boxRow === '' ? 'packBox' : 'packStrip'] = 'Fill both strips per box and tablets per strip.';
  } else {
    const stripSize = Number(stripRow);
    if (!Number.isInteger(stripSize) || stripSize < 1) {
      errors.packStrip = 'Tablets per strip must be a whole number of 1 or more.';
    }
    const boxSize = Number(boxRow);
    if (!Number.isInteger(boxSize) || boxSize < 1) {
      errors.packBox = 'Strips per box must be a whole number of 1 or more.';
    }
    if (cartonRow !== '') {
      const cartonSize = Number(cartonRow);
      if (!Number.isInteger(cartonSize) || cartonSize < 1) {
        errors.packCarton = 'Boxes per carton must be a whole number of 1 or more.';
      }
    }
  }

  if ((values.registrationNo.trim().length > 40)) errors.registrationNo = 'Registration number is too long (max 40).';
  if ((values.customsNo.trim().length > 40)) errors.customsNo = 'Customs number is too long (max 40).';
  if ((values.manufacturerNo.trim().length > 40)) errors.manufacturerNo = 'Manufacturer number is too long (max 40).';
  if ((values.scientificName.trim().length > 120)) errors.scientificName = 'Scientific name is too long (max 120).';

  // Wasfaty mapping. A code must be exactly 13 digits and can belong to only one item; the check
  // runs as you type (same philosophy as the barcode guard) so the owner sees the clash before
  // saving. A price, when present, must be a non-negative number.
  const nupcoCode = values.nupcoCode.trim();
  if (nupcoCode !== '') {
    if (!isValidNupcoCode(nupcoCode)) {
      errors.nupcoCode = 'A NUPCO item code is 13 digits.';
    } else {
      const conflict = nupcoCodeConflictMessage(items, nupcoCode, editingId);
      if (conflict) errors.nupcoCode = conflict;
    }
    if (!values.wasfatyEligible) {
      errors.wasfatyEligible = 'Turn on Wasfaty eligibility or clear the NUPCO code.';
    }
  }
  if (values.wasfatyPrice.trim() !== '') {
    const price = Number(values.wasfatyPrice);
    if (!Number.isFinite(price) || price < 0) {
      errors.wasfatyPrice = 'Enter the NUPCO-approved price as 0 or more, or leave it blank.';
    }
  }

  return errors;
}

// Converts the form's strings into the persisted Item shape. Empty optional fields become
// undefined (not '') so "not recorded" stays distinguishable from "recorded as empty", matching
// how the rest of the catalog treats optional metadata.
export function formToItemInput(
  values: ItemMasterFormValues,
  categories: ItemCategory[] = seedItemCategories,
): Omit<Item, 'id' | 'itemNo'> {
  const barcode = values.barcode.trim();
  // The list keeps only codes that actually differ from the primary one; `gtin` is retired here
  // (itemToForm folds it into the list), so newly saved items carry one canonical code set.
  const barcodes = values.barcodes
    .map((code) => code.trim())
    .filter((code, index, all) => code !== '' && code !== barcode && all.indexOf(code) === index);
  // A default can only point at a direction the item actually links; clearing the links therefore
  // clears the default too instead of persisting a dead reference.
  const dosageIds = [...new Set(values.dosageIds.filter((id) => id !== ''))];
  const defaultDosageId =
    values.defaultDosageId && dosageIds.includes(values.defaultDosageId)
      ? values.defaultDosageId
      : undefined;
  const nupcoCode = normaliseNupcoCode(values.nupcoCode.trim());
  const selectedCategory = categories.find((category) => String(category.categoryId) === values.categoryId);
  const brandId = Number(values.brandId);
  return {
    barcode,
    barcodes: barcodes.length > 0 ? barcodes : undefined,
    nameAr: values.nameAr.trim(),
    nameEn: values.nameEn.trim(),
    unit: values.unit.trim(),
    // The selected master row owns the canonical label; free text remains only for unlinked rows.
    category: selectedCategory ? itemCategoryLabel(selectedCategory) : values.category.trim(),
    categoryId: selectedCategory?.categoryId,
    brandId: Number.isInteger(brandId) && brandId > 0 ? brandId : undefined,
    basePrice: Number(values.basePrice),
    // Blank = no master cost recorded; keep it undefined so SQL stays NULL.
    costPrice: values.costPrice.trim() === '' ? undefined : Number(values.costPrice),
    vatRate: Number(values.vatRate),
    requiresBatchTracking: values.requiresBatchTracking,
    // undefined means "has an expiry" (every pre-existing item), so only the opt-out is stored.
    hasExpiry: values.hasExpiry ? undefined : false,
    reorderLevel: Number(values.reorderLevel),
    controlledStatus: values.controlledStatus === '' ? undefined : values.controlledStatus,
    // Every toggle is written explicitly so clearing one on an existing row cannot be mistaken for
    // "field absent" and keep the old SQL default on the next shared-catalogue sync.
    requiresPrescription: values.requiresPrescription,
    isControlledDrug: values.isControlledDrug,
    isTaxable: values.isTaxable,
    isTemperatureSensitive: values.isTemperatureSensitive,
    requiresSerialNumber: values.requiresSerialNumber,
    isNarcotic: values.isNarcotic,
    gtin: undefined,
    registrationNo: optionalText(values.registrationNo),
    customsNo: optionalText(values.customsNo),
    scientificName: optionalText(values.scientificName),
    manufacturerNo: optionalText(values.manufacturerNo),
    vendorNo: optionalText(values.vendorNo),
    location: optionalText(values.location),
    cartonQty: values.cartonQty.trim() === '' ? undefined : Number(values.cartonQty),
    pack: formPack(values),
    maxLevel: values.maxLevel.trim() === '' ? undefined : Number(values.maxLevel),
    isActive: values.isActive,
    dosageIds: dosageIds.length > 0 ? dosageIds : undefined,
    defaultDosageId,
    nupcoCode: nupcoCode === '' ? undefined : nupcoCode,
    wasfatyPrice: values.wasfatyPrice.trim() === '' ? undefined : Number(values.wasfatyPrice),
    wasfatyEligible: values.wasfatyEligible ? true : undefined,
  };
}

// Stable display/business number. Prefers the stored itemNo; falls back to the id patterns this
// app already uses (seed items `itm-1` -> 1001, ERP-scanned items `erp-101682` -> 101682) so a
// catalog saved before itemNo existed still shows the same numbers it always implicitly had.
export function itemNumberOf(item: Item): number | undefined {
  if (item.itemNo !== undefined) return item.itemNo;
  const erp = /^erp-(\d+)$/.exec(item.id);
  if (erp) return Number(erp[1]);
  const local = /^itm-(\d+)$/.exec(item.id);
  if (local) return 1000 + Number(local[1]);
  return undefined;
}

// Local item numbers live in the 1001+ range. ERP item numbers are real XPH keys (e.g. 101682)
// and must not push the local sequence into that range, so they are deliberately excluded.
export function nextItemNumber(items: Item[]): number {
  const highestLocal = items
    .filter((i) => !i.id.startsWith('erp-'))
    .reduce((max, i) => Math.max(max, itemNumberOf(i) ?? 0), 1000);
  return highestLocal + 1;
}

export interface ItemMovementTotals {
  onHandQty: number;
  purchasedQty: number; // units received through any source (vendor / head office)
  bonusReceivedQty: number; // free units included in purchasedQty
  soldQty: number;
  salesReturnQty: number; // units returned by customers (already back in onHandQty)
  stockCostValue: number; // on-hand quantity x batch cost
  stockRetailValue: number; // on-hand quantity x current sale price
}

interface ReceivingLogRow {
  itemId: string;
  qty: number;
  bonusQty?: number;
}

interface SaleLineRow {
  itemId: string;
  qty: number;
  returnedQty: number;
  // Packed items: tablets deducted per line. Without it the row's qty is already the stock unit.
  baseQty?: number;
}

// "الرصيد / الكمية الحالية / إجمالي الكمية" on the legacy screen were stored columns on the item;
// here every one of them is derived from the batches and the movement logs, so the master page can
// never disagree with the shelf. Purchased/sold/returned are lifetime totals, not on-hand values.
export function itemMovementTotals(
  item: Item,
  batches: Batch[],
  receivingLog: ReceivingLogRow[],
  saleLines: SaleLineRow[]
): ItemMovementTotals {
  const itemBatches = batches.filter((b) => b.itemId === item.id);
  const onHandQty = itemBatches.reduce((sum, b) => sum + b.qtyOnHand, 0);
  const received = receivingLog.filter((r) => r.itemId === item.id);
  const purchasedQty = received.reduce((sum, r) => sum + r.qty, 0);
  const bonusReceivedQty = received.reduce((sum, r) => sum + (r.bonusQty ?? 0), 0);
  const sold = saleLines.filter((l) => l.itemId === item.id);
  // Movement totals are kept in tablets, like stock, so a packed item's sold/returned figures
  // stay comparable with its on-hand balance instead of mixing boxes with tablets.
  const soldQty = sold.reduce((sum, l) => sum + (l.baseQty ?? l.qty), 0);
  const salesReturnQty = sold.reduce((sum, l) => {
    const perUnit = l.baseQty && l.qty > 0 ? l.baseQty / l.qty : 1;
    return sum + Math.round(l.returnedQty * perUnit);
  }, 0);
  const stockCostValue = itemBatches.reduce((sum, b) => sum + b.qtyOnHand * (b.costPrice ?? 0), 0);
  // Packed items keep every quantity in tablets, so retail value is tablets ÷ tablets-per-box ×
  // box price - multiplying the tablet count by the box price would overstate it twelve-fold.
  const stockRetailValue = itemBatches.reduce((sum, b) => {
    const price = b.salePriceOverride ?? item.basePrice;
    return sum + (item.pack ? (b.qtyOnHand / tabletsPerBox(item.pack)) * price : b.qtyOnHand * price);
  }, 0);

  return { onHandQty, purchasedQty, bonusReceivedQty, soldQty, salesReturnQty, stockCostValue, stockRetailValue };
}
