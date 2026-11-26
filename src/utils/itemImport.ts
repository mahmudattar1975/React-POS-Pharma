// Excel → item master: column detection and plan building. No React, no store, no network.
//
// The pharmacy's spreadsheet may use English or Arabic headers, and different branches export the
// same catalogue with slightly different names. The dialog lets the owner override every detected
// column, but these aliases cover the common cases so most files need no adjustment. Nothing here
// writes anything: every row becomes a reviewable `create`, `update` or `error` before Apply.
import type { ControlledStatus, Item, ItemCategory } from '../types/catalog';
import { isValidBarcode, itemCodes } from './itemMaster';
import { isIgnoredItemCategoryValue, itemCategoryLabel, resolveItemCategory } from './itemCategories';
import { seedItemCategories } from './seedData';

export type ItemImportField =
  | 'barcode'
  | 'extraBarcodes'
  | 'nameEn'
  | 'nameAr'
  | 'basePrice'
  | 'vatRate'
  | 'category'
  | 'itemCategories'
  | 'unit'
  | 'reorderLevel'
  | 'controlledStatus'
  | 'requiresBatchTracking'
  | 'isActive'
  | 'vendorNo'
  | 'manufacturerNo';

export const ITEM_IMPORT_FIELDS: readonly ItemImportField[] = [
  'barcode',
  'extraBarcodes',
  'nameEn',
  'nameAr',
  'basePrice',
  'vatRate',
  'category',
  'itemCategories',
  'unit',
  'reorderLevel',
  'controlledStatus',
  'requiresBatchTracking',
  'isActive',
  'vendorNo',
  'manufacturerNo',
];

export const ITEM_IMPORT_REQUIRED: readonly ItemImportField[] = ['barcode', 'nameEn'];

export const ITEM_IMPORT_ALIASES: Record<ItemImportField, string[]> = {
  barcode: [
    'barcode', 'bar code', 'gtin', 'gtin no', 'item code', 'item no', 'item number', 'sku',
    'product code', 'code', 'الباركود', 'رمز الصنف', 'كود الصنف', 'رقم الصنف', 'الرمز',
  ],
  // One row stays one item even when the pack prints several codes. The column may hold one code or
  // several separated by ; , | or the Arabic comma, so legacy sheets with "Barcode 2 / Barcode 3"
  // columns can be merged into one cell without losing a code.
  extraBarcodes: [
    'extra barcodes', 'extra barcode', 'additional barcodes', 'additional barcode',
    'alternate barcode', 'alternative barcode', 'secondary barcode', 'other barcodes',
    'barcode 2', 'barcode2', 'barcode 3', 'barcode3', 'barcodes',
    'الباركود الإضافي', 'باركود إضافي', 'كود إضافي', 'رموز إضافية', 'الباركود 2', 'الباركود 3',
  ],
  nameEn: [
    'name english', 'english name', 'name en', 'nameen', 'item name', 'item name english',
    'product name', 'description', 'name', 'الاسم بالانجليزي', 'الاسم الانجليزي',
    'اسم الصنف بالانجليزي', 'الوصف بالانجليزي',
  ],
  nameAr: [
    'name arabic', 'arabic name', 'name ar', 'namear', 'item name arabic', 'اسم الصنف',
    'الاسم العربي', 'اسم المنتج', 'الوصف', 'الاسم',
  ],
  basePrice: [
    'sale price', 'sales price', 'price', 'unit price', 'retail price', 'base price',
    'sale price sar', 'price sar', 'سعر البيع', 'السعر', 'سعر الوحدة', 'سعر القطعة',
  ],
  vatRate: [
    'vat', 'vat rate', 'vat %', 'vat percent', 'tax rate', 'customer taxes', 'customer tax',
    'ضريبة', 'نسبة الضريبة', 'ضريبة القيمة المضافة',
  ],
  category: [
    'category', 'product category', 'item category', 'group', 'item group', 'تصنيف',
    'مجموعة الصنف', 'المجموعة',
  ],
  itemCategories: [
    'itemcategories', 'item categories', 'item category id', 'itemcategoryid', 'category id',
    'categoryid', 'category code', 'item category code', 'category name', 'category name english',
    'category name arabic', 'فئات الصنف', 'فئة الصنف', 'الفئات', 'كود الفئة', 'رقم الفئة', 'اسم الفئة',
  ],
  unit: [
    'unit', 'uom', 'packing', 'unit of measure', 'وحدة', 'الوحدة', 'وحدة القياس',
  ],
  reorderLevel: [
    'reorder level', 'reorder point', 'min level', 'minimum level', 'minimum',
    'الحد الأدنى', 'مستوى إعادة الطلب', 'نقطة إعادة الطلب',
  ],
  controlledStatus: [
    'controlled', 'controlled status', 'controlled substance', 'prescription status',
    'مخدر', 'مؤثرات عقلية', 'وصف طبي',
  ],
  requiresBatchTracking: [
    'batch tracking', 'track batch', 'requires batch', 'requires batch tracking', 'batch tracked',
    'تتبع الدفعات', 'تتبع الدفعة',
  ],
  isActive: [
    'active', 'is active', 'status', 'item status', 'نشط', 'الحالة', 'حالة الصنف',
  ],
  vendorNo: [
    'vendor', 'vendor no', 'vendor name', 'preferred vendor', 'المورد', 'اسم المورد',
  ],
  manufacturerNo: [
    'manufactured', 'manufacturer', 'manufacturer no', 'manufacturer name', 'company',
    'الشركة المصنعة', 'الشركة',
  ],
};

export type ItemColumnMapping = Partial<Record<ItemImportField, string>>;

export type ItemImportStatus = 'create' | 'update' | 'error';

// The shape sent to POST /api/items/import. `id`/`itemNo` are deliberately absent: the server owns
// the SQL primary key, and the local store assigns item numbers when it adopts the imported rows.
export interface ItemImportPayloadRow {
  preferredId?: string;
  barcode: string;
  // Other codes printed on the same pack: either from the Extra Barcodes column or from later rows
  // with the same English name. The server mirrors them into ItemBarcodes for every branch.
  barcodes?: string[];
  nameEn: string;
  nameAr: string;
  unit: string;
  category: string;
  // Resolved from the Categories column; the canonical English name is written to `category`.
  categoryId?: number;
  basePrice: number;
  vatRate: number;
  requiresBatchTracking: boolean;
  reorderLevel: number;
  controlledStatus?: ControlledStatus | null;
  isActive: boolean;
  // Optional item-master metadata from the owner's sheet. Blank cells keep an existing value.
  vendorNo?: string;
  manufacturerNo?: string;
}

export interface ItemImportRow extends ItemImportPayloadRow {
  row: number; // 1-based file row, including the header, so the owner can find it in Excel
  status: ItemImportStatus;
  note?: string;
}

export interface ItemImportPlan {
  rows: ItemImportRow[];
  create: number;
  update: number;
  errors: number;
  apply: ItemImportPayloadRow[];
}

const FALSE_VALUES = new Set([
  'no', 'false', '0', 'n', 'off', 'inactive', 'discontinued', 'disabled',
  'لا', 'غير نشط', 'موقف', 'متوقف', 'غير مفعل',
]);
const TRUE_VALUES = new Set(['yes', 'true', '1', 'y', 'on', 'active', 'نعم', 'نشط', 'مفعل']);

export function normaliseItemHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[()%]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function arabicDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

function numberFrom(value: string): number {
  const cleaned = arabicDigits(value)
    .replace(/[٬,\sSARsar%٪]/g, '')
    .replace(/[٫]/g, '.');
  // Spreadsheet apps sometimes store a numeric code as a float ("6281007320014.0").
  const numeric = /^(\d+)\.0+$/.exec(cleaned);
  return Number(numeric ? numeric[1] : cleaned);
}

function cell(row: Record<string, unknown>, column?: string): string {
  if (!column) return '';
  const value = row[column];
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

// Excel turns long numeric-looking barcodes into strings like "6.9442E+12" when the column is
// General. Expand that back to the full integer using string arithmetic (not Number.toString, which
// can round long codes). Fractional exponents stay invalid so the preview can tell the owner to
// format the column as Text instead of silently importing a truncated barcode.
export function normaliseBarcodeCell(value: string): string {
  const cleaned = arabicDigits(value).replace(/^\u0027/, '').replace(/\s+/g, '');
  const scientific = /^(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(cleaned);
  if (!scientific) {
    // Spreadsheet apps also write numeric codes as "6281007320014.0".
    return /^(\d+)\.0+$/.exec(cleaned)?.[1] ?? cleaned;
  }

  const [, whole, fraction = '', exponentText] = scientific;
  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 32) return cleaned;

  const digits = whole + fraction;
  const decimalPoint = whole.length + exponent;
  let expanded: string;
  if (decimalPoint <= 0) expanded = `0.${'0'.repeat(-decimalPoint)}${digits}`;
  else if (decimalPoint >= digits.length) expanded = digits + '0'.repeat(decimalPoint - digits.length);
  else expanded = `${digits.slice(0, decimalPoint)}.${digits.slice(decimalPoint)}`;
  return /^(\d+)\.0+$/.exec(expanded)?.[1] ?? expanded;
}

// One cell can carry several alternate codes; the separators cover both Excel habits and the
// Arabic comma. Whitespace is removed inside normaliseBarcodeCell, so "77777770585; 77777770586"
// and "77777770585;77777770586" behave the same.
const EXTRA_BARCODE_SEPARATORS = /[;|،,]+/;

function extraBarcodesFromCell(value: string): string[] {
  if (!value.trim()) return [];
  return value
    .split(EXTRA_BARCODE_SEPARATORS)
    .map((code) => normaliseBarcodeCell(code))
    .filter((code) => code !== '');
}

// The owner's sheets repeat one product on several lines, each line with its own printed barcode.
// English name is the merge key (confirmed with the owner); case and repeated spaces are ignored so
// "AL SHAROUQ  LOOFA" and "al sharouq loofa" stay one item.
function itemNameKey(nameEn: string): string {
  return nameEn.trim().replace(/\s+/g, ' ').toLowerCase();
}

function appendNote(existing: string | undefined, addition: string): string {
  return existing ? `${existing} ${addition}` : addition;
}

export function detectItemColumns(headers: string[]): ItemColumnMapping {
  const byNormalised = new Map(headers.map((header) => [normaliseItemHeader(header), header]));
  const mapping: ItemColumnMapping = {};
  for (const field of ITEM_IMPORT_FIELDS) {
    mapping[field] = ITEM_IMPORT_ALIASES[field]
      .map(normaliseItemHeader)
      .map((alias) => byNormalised.get(alias))
      .find((header): header is string => header !== undefined);
  }
  return mapping;
}

function parseBoolean(value: string, fallback: boolean): boolean {
  const text = value.trim().toLowerCase();
  if (!text) return fallback;
  if (FALSE_VALUES.has(text)) return false;
  if (TRUE_VALUES.has(text)) return true;
  return fallback;
}

function parseRate(value: string): number {
  const text = arabicDigits(value).trim();
  const isPercent = /[%٪]/.test(text);
  // The owner's ERP exports values like "15 Sales": take the numeric part and ignore the trailing
  // tax-type label instead of treating the whole cell as malformed.
  const match = text.replace(/[٫]/g, '.').match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return Number.NaN;
  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) return Number.NaN;
  // Excel stores 15% either as 0.15 or as the displayed number 15. Both mean the same rate.
  return isPercent || parsed > 1 ? parsed / 100 : parsed;
}

function parseControlled(value: string): ControlledStatus | undefined {
  const text = arabicDigits(value).trim().toLowerCase();
  if (!text || FALSE_VALUES.has(text)) return undefined;
  if (/schedule[\s_-]*a|مخدر/.test(text)) return 'schedule_a';
  if (/schedule[\s_-]*b/.test(text)) return 'schedule_b';
  if (/schedule[\s_-]*c/.test(text)) return 'schedule_c';
  if (/schedule[\s_-]*d/.test(text)) return 'schedule_d';
  if (/schedule[\s_-]*e/.test(text)) return 'schedule_e';
  if (/prescription|وصف طبي|مؤثرات عقلية/.test(text)) return 'prescription';
  return undefined;
}

function localItemsByCode(items: Item[]): Map<string, Item> {
  const map = new Map<string, Item>();
  for (const item of items) {
    for (const code of itemCodes(item)) map.set(code.trim().toLowerCase(), item);
  }
  return map;
}

function rowError(row: number, note: string, barcode: string): ItemImportRow {
  return {
    row,
    status: 'error',
    note,
    barcode,
    nameEn: '',
    nameAr: '',
    unit: '',
    category: '',
    basePrice: 0,
    vatRate: 0,
    requiresBatchTracking: true,
    reorderLevel: 0,
    isActive: true,
  };
}

// Builds the full review plan from sheet_to_json rows. The caller may pass a row offset when it
// filtered blank rows before planning; +2 is the normal "header is row 1" case.
export function planItemImport(
  sheetRows: Record<string, unknown>[],
  columns: ItemColumnMapping,
  items: Item[],
  rowOffset = 2,
  rowNumbers?: number[],
  categories: ItemCategory[] = seedItemCategories,
): ItemImportPlan {
  const byCode = localItemsByCode(items);
  const seen = new Map<string, number>();
  // Alternate codes claim a barcode too: a file must never make two items answer to the same code,
  // whether it is printed as a main barcode or in the extra-barcode column.
  const seenExtras = new Map<string, number>();
  // Repeated English names are the same product. The first line supplies the master fields; every
  // later line only contributes its barcode(s), so the file creates one dbo.items row per name.
  const byName = new Map<string, ItemImportRow>();
  const mergedRows = new Map<ItemImportRow, number[]>();
  const rows: ItemImportRow[] = [];

  sheetRows.forEach((sheetRow, index) => {
    const row = rowNumbers?.[index] ?? index + rowOffset;
    const rawBarcode = cell(sheetRow, columns.barcode).replace(/\s+/g, '');
    const barcode = normaliseBarcodeCell(rawBarcode);
    const key = barcode.toLowerCase();
    const scientific = /^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(rawBarcode);
    if (!barcode) {
      rows.push(rowError(row, 'Barcode is missing.', barcode));
      return;
    }
    // A fractional scientific value (e.g. 1.23E-2 -> 0.0123) is not a barcode; the dots allowed by
    // the general barcode validator are for codes, not decimal points.
    if (scientific && !/^\d+$/.test(barcode)) {
      rows.push(rowError(
        row,
        'Barcode was shown in scientific notation with decimals. Format the Excel column as Text and re-enter the full digits.',
        barcode,
      ));
      return;
    }
    if (!isValidBarcode(barcode)) {
      rows.push(rowError(row, 'Barcode must be 4-32 letters, digits, dots, dashes, @ or underscores.', barcode));
      return;
    }
    const firstRow = seen.get(key);
    if (firstRow !== undefined) {
      rows.push(rowError(row, `Barcode already used on row ${firstRow}.`, barcode));
      return;
    }
    const extraRow = seenExtras.get(key);
    if (extraRow !== undefined) {
      rows.push(rowError(row, `Barcode already used as an extra code on row ${extraRow}.`, barcode));
      return;
    }
    seen.set(key, row);

    const existing = byCode.get(key);
    const barcodes = extraBarcodesFromCell(cell(sheetRow, columns.extraBarcodes));
    const claimed = new Set<string>([key]);
    for (const extra of barcodes) {
      const extraKey = extra.toLowerCase();
      if (!isValidBarcode(extra)) {
        rows.push(rowError(
          row,
          `Extra barcode "${extra}" must be 4-32 letters, digits, dots, dashes, @ or underscores.`,
          barcode,
        ));
        return;
      }
      if (claimed.has(extraKey)) {
        rows.push(rowError(
          row,
          `Extra barcode "${extra}" is the main barcode or is listed twice on this row.`,
          barcode,
        ));
        return;
      }
      const ownerRow = seen.get(extraKey) ?? seenExtras.get(extraKey);
      if (ownerRow !== undefined) {
        rows.push(rowError(row, `Barcode "${extra}" is already used on row ${ownerRow}.`, barcode));
        return;
      }
      const owner = byCode.get(extraKey);
      if (owner && owner.id !== existing?.id) {
        rows.push(rowError(row, `Extra barcode "${extra}" already belongs to ${owner.nameEn}.`, barcode));
        return;
      }
      claimed.add(extraKey);
      seenExtras.set(extraKey, row);
    }

    const nameEn = cell(sheetRow, columns.nameEn);
    const nameAr = cell(sheetRow, columns.nameAr);
    if (!nameEn) {
      rows.push(rowError(row, 'English name is missing (map the Name column).', barcode));
      return;
    }
    if (nameEn.length > 150 || nameAr.length > 150) {
      rows.push(rowError(row, 'A name is longer than 150 characters.', barcode));
      return;
    }

    const vendorNo = cell(sheetRow, columns.vendorNo);
    const manufacturerNo = cell(sheetRow, columns.manufacturerNo);
    if (vendorNo.length > 50 || manufacturerNo.length > 50) {
      rows.push(rowError(row, 'Vendor or Manufactured is longer than 50 characters.', barcode));
      return;
    }

    const rawPrice = cell(sheetRow, columns.basePrice);
    const basePrice = rawPrice ? numberFrom(rawPrice) : 0;
    if (!Number.isFinite(basePrice) || basePrice < 0) {
      rows.push(rowError(row, 'Sale price must be 0 or more.', barcode));
      return;
    }

    const rawVat = cell(sheetRow, columns.vatRate);
    const vatRate = rawVat ? parseRate(rawVat) : 0;
    if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 1) {
      rows.push(rowError(row, 'VAT must be between 0% and 100%.', barcode));
      return;
    }

    const rawReorder = cell(sheetRow, columns.reorderLevel);
    const reorderLevel = rawReorder ? numberFrom(rawReorder) : 0;
    if (!Number.isInteger(reorderLevel) || reorderLevel < 0) {
      rows.push(rowError(row, 'Reorder level must be a whole number of 0 or more.', barcode));
      return;
    }

    // CategoryID is an explicit lookup column: a value must resolve to one seeded/SQL row, or the
    // whole file is blocked. Known scope flags ("All", "Saleable / PoS") are treated as unlinked.
    // Free-text Category remains usable on its own for legacy sheets.
    const itemCategoriesCell = cell(sheetRow, columns.itemCategories);
    const matchedCategory = resolveItemCategory(itemCategoriesCell, categories);
    if (itemCategoriesCell && !matchedCategory && !isIgnoredItemCategoryValue(itemCategoriesCell)) {
      rows.push(rowError(
        row,
        `CategoryID value "${itemCategoriesCell}" is not in the category master.`,
        barcode,
      ));
      return;
    }
    const category = matchedCategory
      ? itemCategoryLabel(matchedCategory)
      : cell(sheetRow, columns.category);
    if (category.length > 100) {
      rows.push(rowError(row, 'Category is longer than 100 characters.', barcode));
      return;
    }

    const priceNote = rawPrice ? undefined : 'No price column/value — imported at 0.';
    const target = byName.get(itemNameKey(nameEn));
    if (target) {
      // A repeated name is not a second item. Its data fields are ignored; only its codes are
      // attached to the first row, which keeps one item master and one stock ledger per product.
      if (existing && (!target.preferredId || existing.id !== target.preferredId)) {
        rows.push(rowError(row, `Barcode ${barcode} already belongs to ${existing.nameEn}.`, barcode));
        return;
      }
      const claimed = new Set<string>([
        target.barcode.toLowerCase(),
        ...(target.barcodes ?? []).map((code) => code.toLowerCase()),
      ]);
      for (const code of [barcode, ...barcodes]) {
        const codeKey = code.toLowerCase();
        if (claimed.has(codeKey)) {
          rows.push(rowError(row, `Barcode ${code} is already listed on row ${target.row}.`, barcode));
          return;
        }
        const owner = byCode.get(codeKey);
        if (owner && (!target.preferredId || owner.id !== target.preferredId)) {
          rows.push(rowError(row, `Barcode ${code} already belongs to ${owner.nameEn}.`, barcode));
          return;
        }
        claimed.add(codeKey);
        target.barcodes = [...(target.barcodes ?? []), code];
        if (codeKey !== key) seenExtras.set(codeKey, row);
      }
      const sources = [...(mergedRows.get(target) ?? []), row];
      mergedRows.set(target, sources);
      target.note = appendNote(
        target.note,
        `Rows ${sources.join(', ')} have the same English name; their barcodes are aliases on this item.`,
      );
      return;
    }

    const newRow: ItemImportRow = {
      row,
      status: existing ? 'update' : 'create',
      preferredId: existing?.id,
      barcode,
      barcodes: barcodes.length > 0 ? barcodes : undefined,
      nameEn,
      nameAr,
      unit: cell(sheetRow, columns.unit),
      category,
      categoryId: matchedCategory?.categoryId,
      basePrice: Math.round((basePrice + Number.EPSILON) * 1000) / 1000,
      vatRate: Math.round((vatRate + Number.EPSILON) * 10000) / 10000,
      requiresBatchTracking: parseBoolean(cell(sheetRow, columns.requiresBatchTracking), true),
      reorderLevel,
      controlledStatus: parseControlled(cell(sheetRow, columns.controlledStatus)),
      isActive: parseBoolean(cell(sheetRow, columns.isActive), true),
      vendorNo: vendorNo || undefined,
      manufacturerNo: manufacturerNo || undefined,
      note: priceNote,
    };
    rows.push(newRow);
    byName.set(itemNameKey(nameEn), newRow);
  });

  const apply = rows
    .filter((row): row is ItemImportRow & { status: 'create' | 'update' } => row.status !== 'error')
    .map(({ preferredId, barcode, barcodes, nameEn, nameAr, unit, category, categoryId, basePrice, vatRate, requiresBatchTracking, reorderLevel, controlledStatus, isActive, vendorNo, manufacturerNo }) => ({
      preferredId,
      barcode,
      barcodes,
      nameEn,
      nameAr,
      unit,
      category,
      categoryId,
      basePrice,
      vatRate,
      requiresBatchTracking,
      reorderLevel,
      controlledStatus,
      isActive,
      vendorNo,
      manufacturerNo,
    }));

  return {
    rows,
    create: rows.filter((row) => row.status === 'create').length,
    update: rows.filter((row) => row.status === 'update').length,
    errors: rows.filter((row) => row.status === 'error').length,
    apply,
  };
}
