// Excel → item master: column detection and plan building. No React, no store, no network.
//
// The pharmacy's spreadsheet may use English or Arabic headers, and different branches export the
// same catalogue with slightly different names. The dialog lets the owner override every detected
// column, but these aliases cover the common cases so most files need no adjustment. Nothing here
// writes anything: every row becomes a reviewable `create`, `update` or `error` before Apply.
import type { ControlledStatus, Item } from '../types/catalog';
import { isValidBarcode, itemCodes } from './itemMaster';

export type ItemImportField =
  | 'barcode'
  | 'nameEn'
  | 'nameAr'
  | 'basePrice'
  | 'vatRate'
  | 'category'
  | 'unit'
  | 'reorderLevel'
  | 'controlledStatus'
  | 'requiresBatchTracking'
  | 'isActive';

export const ITEM_IMPORT_FIELDS: readonly ItemImportField[] = [
  'barcode',
  'nameEn',
  'nameAr',
  'basePrice',
  'vatRate',
  'category',
  'unit',
  'reorderLevel',
  'controlledStatus',
  'requiresBatchTracking',
  'isActive',
];

export const ITEM_IMPORT_REQUIRED: readonly ItemImportField[] = ['barcode', 'nameEn'];

export const ITEM_IMPORT_ALIASES: Record<ItemImportField, string[]> = {
  barcode: [
    'barcode', 'bar code', 'gtin', 'gtin no', 'item code', 'item no', 'item number', 'sku',
    'product code', 'code', 'الباركود', 'رمز الصنف', 'كود الصنف', 'رقم الصنف', 'الرمز',
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
    'sale price', 'price', 'unit price', 'retail price', 'base price', 'sale price sar',
    'price sar', 'سعر البيع', 'السعر', 'سعر الوحدة', 'سعر القطعة',
  ],
  vatRate: [
    'vat', 'vat rate', 'vat %', 'vat percent', 'tax rate', 'ضريبة', 'نسبة الضريبة',
    'ضريبة القيمة المضافة',
  ],
  category: [
    'category', 'item category', 'group', 'item group', 'تصنيف', 'مجموعة الصنف', 'المجموعة',
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
    'batch tracking', 'track batch', 'requires batch', 'batch tracked', 'تتبع الدفعات', 'تتبع الدفعة',
  ],
  isActive: [
    'active', 'is active', 'status', 'item status', 'نشط', 'الحالة', 'حالة الصنف',
  ],
};

export type ItemColumnMapping = Partial<Record<ItemImportField, string>>;

export type ItemImportStatus = 'create' | 'update' | 'error';

// The shape sent to POST /api/items/import. `id`/`itemNo` are deliberately absent: the server owns
// the SQL primary key, and the local store assigns item numbers when it adopts the imported rows.
export interface ItemImportPayloadRow {
  preferredId?: string;
  barcode: string;
  nameEn: string;
  nameAr: string;
  unit: string;
  category: string;
  basePrice: number;
  vatRate: number;
  requiresBatchTracking: boolean;
  reorderLevel: number;
  controlledStatus?: ControlledStatus | null;
  isActive: boolean;
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
  const parsed = numberFrom(text);
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
): ItemImportPlan {
  const byCode = localItemsByCode(items);
  const seen = new Map<string, number>();
  const rows: ItemImportRow[] = [];

  sheetRows.forEach((sheetRow, index) => {
    const row = rowNumbers?.[index] ?? index + rowOffset;
    const rawBarcode = cell(sheetRow, columns.barcode).replace(/\s+/g, '');
    const barcode = rawBarcode;
    const key = barcode.toLowerCase();
    if (!barcode) {
      rows.push(rowError(row, 'Barcode is missing.', barcode));
      return;
    }
    if (!isValidBarcode(barcode)) {
      rows.push(rowError(row, 'Barcode must be 4-32 letters, digits, dots, dashes or underscores.', barcode));
      return;
    }
    const firstRow = seen.get(key);
    if (firstRow !== undefined) {
      rows.push(rowError(row, `Barcode already used on row ${firstRow}.`, barcode));
      return;
    }
    seen.set(key, row);

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

    const existing = byCode.get(key);
    const priceNote = rawPrice ? undefined : 'No price column/value — imported at 0.';
    rows.push({
      row,
      status: existing ? 'update' : 'create',
      preferredId: existing?.id,
      barcode,
      nameEn,
      nameAr,
      unit: cell(sheetRow, columns.unit),
      category: cell(sheetRow, columns.category),
      basePrice: Math.round((basePrice + Number.EPSILON) * 1000) / 1000,
      vatRate: Math.round((vatRate + Number.EPSILON) * 10000) / 10000,
      requiresBatchTracking: parseBoolean(cell(sheetRow, columns.requiresBatchTracking), true),
      reorderLevel,
      controlledStatus: parseControlled(cell(sheetRow, columns.controlledStatus)),
      isActive: parseBoolean(cell(sheetRow, columns.isActive), true),
      note: priceNote,
    });
  });

  const apply = rows
    .filter((row): row is ItemImportRow & { status: 'create' | 'update' } => row.status !== 'error')
    .map(({ preferredId, barcode, nameEn, nameAr, unit, category, basePrice, vatRate, requiresBatchTracking, reorderLevel, controlledStatus, isActive }) => ({
      preferredId,
      barcode,
      nameEn,
      nameAr,
      unit,
      category,
      basePrice,
      vatRate,
      requiresBatchTracking,
      reorderLevel,
      controlledStatus,
      isActive,
    }));

  return {
    rows,
    create: rows.filter((row) => row.status === 'create').length,
    update: rows.filter((row) => row.status === 'update').length,
    errors: rows.filter((row) => row.status === 'error').length,
    apply,
  };
}
