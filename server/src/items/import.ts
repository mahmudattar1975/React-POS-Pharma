// Validation for the Excel item import. The browser plans the import (column detection, previews,
// duplicate detection) and sends the normalised rows here; these rules run again on the server so a
// direct POST cannot write a malformed master into either dotnet_pos.dbo.items or dbo.item.
// '@' is valid in the owner's legacy supplier codes (04694@43983).
const BARCODE_RE = /^[0-9A-Za-z._@-]{4,32}$/;
const CONTROLLED_STATUSES = new Set([
  'prescription',
  'schedule_a',
  'schedule_b',
  'schedule_c',
  'schedule_d',
  'schedule_e',
]);
const MAX_ROWS = 1000;

export interface ItemImportInput {
  preferredId?: string;
  barcode: string;
  // Other printed codes for the same item. Stored in the app's ItemBarcodes child table; the .NET
  // dbo.item master keeps its single Code column unchanged.
  barcodes?: string[];
  nameEn: string;
  nameAr: string;
  unit: string;
  category: string;
  // Optional link to dbo.ItemCategories. Blank Excel cells leave an existing link untouched.
  categoryId?: number;
  basePrice: number;
  vatRate: number;
  requiresBatchTracking: boolean;
  reorderLevel: number;
  controlledStatus?: string | null;
  isActive: boolean;
  // Optional item-master metadata. Blank cells stay undefined so an update keeps the SQL value.
  vendorNo?: string;
  manufacturerNo?: string;
}

function text(value: unknown, label: string, max: number, required = false): string {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${label} is required.`);
    return '';
  }
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new Error(`${label} is required.`);
  if (trimmed.length > max) throw new Error(`${label} is too long (max ${max}).`);
  return trimmed;
}

function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a number.`);
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be true or false.`);
  return value;
}

function extraBarcodes(value: unknown, barcode: string, at: (label: string) => string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error(`${at('extra barcodes')} must be an array of codes.`);
  if (value.length > 10) throw new Error(`${at('extra barcodes')} can contain at most 10 codes.`);

  const seen = new Set<string>([barcode.toLowerCase()]);
  const codes: string[] = [];
  for (const raw of value) {
    const code = text(raw, at('extra barcode'), 32, true);
    if (!BARCODE_RE.test(code)) {
      throw new Error(`${at('extra barcode')} ${code} must be 4-32 letters, digits, dots, dashes, @ or underscores.`);
    }
    const key = code.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`${at('extra barcode')} ${code} is the main barcode or is listed twice.`);
    }
    seen.add(key);
    codes.push(code);
  }
  return codes.length > 0 ? codes : undefined;
}

function validateRow(raw: unknown, index: number): ItemImportInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Row ${index + 2} is not an object.`);
  }
  const row = raw as Record<string, unknown>;
  const at = (label: string) => `Row ${index + 2}: ${label}`;

  const barcode = text(row.barcode, at('barcode'), 32, true);
  if (!BARCODE_RE.test(barcode)) {
    throw new Error(`${at('barcode')} must be 4-32 letters, digits, dots, dashes, @ or underscores.`);
  }
  const barcodes = extraBarcodes(row.barcodes, barcode, at);
  const nameEn = text(row.nameEn, at('English name'), 150, true);
  const nameAr = text(row.nameAr, at('Arabic name'), 150);
  const unit = text(row.unit, at('unit'), 100);
  const category = text(row.category, at('category'), 100);

  const rawCategoryId = row.categoryId;
  let categoryId: number | undefined;
  if (rawCategoryId !== undefined && rawCategoryId !== null && rawCategoryId !== '') {
    if (typeof rawCategoryId !== 'number' || !Number.isInteger(rawCategoryId) || rawCategoryId <= 0) {
      throw new Error(`${at('category id')} must be a positive whole number.`);
    }
    categoryId = rawCategoryId;
  }

  const basePrice = number(row.basePrice, at('sale price'));
  if (basePrice < 0) throw new Error(`${at('sale price')} cannot be negative.`);

  const vatRate = number(row.vatRate, at('VAT rate'));
  if (vatRate < 0 || vatRate > 1) throw new Error(`${at('VAT rate')} must be between 0 and 1.`);

  const reorderLevel = number(row.reorderLevel, at('reorder level'));
  if (!Number.isInteger(reorderLevel) || reorderLevel < 0 || reorderLevel > 2_147_483_647) {
    throw new Error(`${at('reorder level')} must be a whole number of 0 or more.`);
  }

  const controlledRaw = row.controlledStatus;
  if (controlledRaw !== undefined && controlledRaw !== null && controlledRaw !== '') {
    if (typeof controlledRaw !== 'string' || !CONTROLLED_STATUSES.has(controlledRaw)) {
      throw new Error(`${at('controlled status')} is not recognised.`);
    }
  }
  const preferredId = row.preferredId === undefined || row.preferredId === null
    ? undefined
    : text(row.preferredId, at('preferred id'), 80, true);
  if (preferredId && !/^[A-Za-z0-9._:-]+$/.test(preferredId)) {
    throw new Error(`${at('preferred id')} contains unsupported characters.`);
  }
  const vendorNo = text(row.vendorNo, at('vendor'), 50) || undefined;
  const manufacturerNo = text(row.manufacturerNo, at('manufactured'), 50) || undefined;

  return {
    preferredId,
    barcode,
    barcodes,
    nameEn,
    nameAr,
    unit,
    category,
    categoryId,
    basePrice: Math.round((basePrice + Number.EPSILON) * 1000) / 1000,
    vatRate: Math.round((vatRate + Number.EPSILON) * 10000) / 10000,
    requiresBatchTracking: boolean(row.requiresBatchTracking, at('batch tracking')),
    reorderLevel,
    controlledStatus: controlledRaw ? String(controlledRaw) : null,
    isActive: boolean(row.isActive, at('active status')),
    vendorNo,
    manufacturerNo,
  };
}

// Anything the client sends must pass here before a single write happens. Duplicate codes are
// rejected rather than "last row wins": a code must resolve to exactly one item, whether it is a
// main barcode or an alias on another row.
export function validateItemImportBody(body: unknown): { items: ItemImportInput[] } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Expected an object with an items array.');
  }
  const rows = (body as Record<string, unknown>).items;
  if (!Array.isArray(rows)) throw new Error('Expected an items array.');
  if (rows.length === 0) throw new Error('There are no items to import.');
  if (rows.length > MAX_ROWS) throw new Error(`An import can contain at most ${MAX_ROWS} rows.`);

  const items = rows.map(validateRow);
  const seen = new Set<string>();
  for (const item of items) {
    for (const code of [item.barcode, ...(item.barcodes ?? [])]) {
      const key = code.toLowerCase();
      if (seen.has(key)) {
        throw new Error(`Barcode ${code} appears more than once in this import (as a main or extra code).`);
      }
      seen.add(key);
    }
  }
  return { items };
}

export function barcodeKey(barcode: string): string {
  return barcode.trim().toLowerCase();
}
