import { describe, expect, it } from 'vitest';
import type { Item } from '../types/catalog';
import {
  detectItemColumns, normaliseBarcodeCell, planItemImport, type ItemColumnMapping,
} from './itemImport';
import {
  buildItemImportSampleWorkbook, ITEM_IMPORT_SAMPLE_HEADERS, ITEM_IMPORT_SAMPLE_ROW,
} from './itemImportSample';

function item(barcode: string, nameEn: string): Item {
  return {
    id: `itm-${barcode}`,
    barcode,
    nameEn,
    nameAr: '',
    unit: 'Box',
    category: 'Test',
    basePrice: 1,
    vatRate: 0,
    requiresBatchTracking: true,
    reorderLevel: 0,
  };
}

const headers = ['Barcode', 'Item Name', 'Arabic name', 'Sale Price', 'VAT %', 'Category', 'Unit'];
const columns: ItemColumnMapping = detectItemColumns(headers);

describe('itemImport column detection', () => {
  it('maps common English and Arabic headers without manual setup', () => {
    expect(columns.barcode).toBe('Barcode');
    expect(columns.nameEn).toBe('Item Name');
    expect(columns.nameAr).toBe('Arabic name');
    expect(columns.basePrice).toBe('Sale Price');
    expect(columns.vatRate).toBe('VAT %');
    expect(detectItemColumns(['الباركود', 'اسم الصنف', 'سعر البيع', 'ضريبة القيمة المضافة'])).toMatchObject({
      barcode: 'الباركود',
      nameAr: 'اسم الصنف',
      basePrice: 'سعر البيع',
      vatRate: 'ضريبة القيمة المضافة',
    });
  });
});

describe('itemImport planning', () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    Barcode: '6281007320999',
    'Item Name': 'Imported Item',
    'Arabic name': 'صنف مستورد',
    'Sale Price': '12.50',
    'VAT %': '15%',
    Category: 'Analgesics',
    Unit: 'Box',
    ...overrides,
  });

  it('creates a row and parses price, percent VAT and defaults', () => {
    const plan = planItemImport([row()], columns, []);
    expect(plan.errors).toBe(0);
    expect(plan.create).toBe(1);
    expect(plan.apply[0]).toMatchObject({
      barcode: '6281007320999',
      basePrice: 12.5,
      vatRate: 0.15,
      requiresBatchTracking: true,
      isActive: true,
      reorderLevel: 0,
    });
  });

  it('marks a known barcode as an update and carries the local id for the API', () => {
    const existing = item('6281007320999', 'Old Name');
    const plan = planItemImport([row({ 'Item Name': 'New Name' })], columns, [existing]);
    expect(plan.errors).toBe(0);
    expect(plan.update).toBe(1);
    expect(plan.apply[0]).toMatchObject({ preferredId: existing.id, nameEn: 'New Name' });
  });

  it('blocks the entire import when a file repeats one barcode', () => {
    const plan = planItemImport([row(), row({ 'Item Name': 'Second Name' })], columns, []);
    expect(plan.errors).toBe(1);
    expect(plan.rows[1].note).toMatch(/already used on row/i);
    expect(plan.apply).toHaveLength(1);
  });

  it('rejects a bad VAT rate instead of silently importing it', () => {
    const plan = planItemImport([row({ 'VAT %': '150' })], columns, []);
    expect(plan.errors).toBe(1);
    expect(plan.apply).toHaveLength(0);
  });

  it('resolves Item Categories by id, code or bilingual name and syncs the free-text label', () => {
    const categoryColumns = detectItemColumns([...headers, 'CategoryID']);
    const values = ['8', 'CAT-008', 'Vitamins & Supplements', 'الفيتامينات والمكملات الغذائية'];
    const plans = values.map((value) =>
      planItemImport([row({ 'CategoryID': value, Category: 'Ignored text' })], categoryColumns, [])
    );
    for (const plan of plans) {
      expect(plan.errors).toBe(0);
      expect(plan.apply[0]).toMatchObject({ categoryId: 8, category: 'Vitamins & Supplements' });
    }
  });

  it('blocks the file when an Item Categories value is not in the master', () => {
    const categoryColumns = detectItemColumns([...headers, 'CategoryID']);
    const plan = planItemImport([row({ 'CategoryID': 'CAT-999' })], categoryColumns, []);
    expect(plan.errors).toBe(1);
    expect(plan.rows[0].note).toMatch(/not in the category master/i);
    expect(plan.apply).toHaveLength(0);
  });
});

describe('Excel sample template', () => {
  it('uses headers that are detected automatically and an example row that imports cleanly', () => {
    const sampleColumns = detectItemColumns(ITEM_IMPORT_SAMPLE_HEADERS);
    expect(sampleColumns).toMatchObject({
      barcode: 'Barcode',
      nameEn: 'Item Name (English)',
      nameAr: 'Arabic Name',
      basePrice: 'Sale Price',
      vatRate: 'VAT %',
      category: 'Category',
      itemCategories: 'CategoryID',
      unit: 'Unit',
      reorderLevel: 'Reorder Level',
      controlledStatus: 'Controlled Status',
      requiresBatchTracking: 'Requires Batch Tracking',
      isActive: 'Active',
    });
    const plan = planItemImport([ITEM_IMPORT_SAMPLE_ROW], sampleColumns, []);
    expect(plan.errors).toBe(0);
    expect(plan.create).toBe(1);
    expect(plan.apply[0]).toMatchObject({
      barcode: 'SAMPLE-0001',
      categoryId: 1,
      category: 'Medicines',
      basePrice: 12.5,
      vatRate: 0.15,
      requiresBatchTracking: true,
      isActive: true,
    });
  });

  it('builds a workbook whose first sheet is the importable Items sheet', async () => {
    const workbook = await buildItemImportSampleWorkbook();
    expect(workbook.SheetNames).toEqual(['Items', 'How to fill']);
    const XLSX = await import('xlsx');
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Items, { defval: '' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(ITEM_IMPORT_SAMPLE_ROW);
  });
});

describe('Excel barcode normalisation', () => {
  const sheetRow = (barcode: string, nameEn: string) => ({
    Barcode: barcode,
    'Item Name': nameEn,
    'Arabic name': '',
    'Sale Price': '1',
    'VAT %': '0',
    Category: '',
    Unit: '',
  });

  it('expands scientific notation and numeric .0 codes to full barcodes', () => {
    const plan = planItemImport([
      sheetRow('6.9442E+12', 'Scientific barcode'),
      sheetRow('6281007320014.0', 'Float barcode'),
    ], columns, []);
    expect(plan.errors).toBe(0);
    expect(plan.apply.map((item) => item.barcode)).toEqual(['6944200000000', '6281007320014']);
  });

  it('keeps fractional scientific values as an error with spreadsheet guidance', () => {
    expect(normaliseBarcodeCell('1.23E-2')).toBe('0.0123');
    const plan = planItemImport([sheetRow('1.23E-2', 'Fractional barcode')], columns, []);
    expect(plan.errors).toBe(1);
    expect(plan.rows[0].note).toMatch(/scientific notation/i);
    expect(plan.apply).toHaveLength(0);
  });

  it('leaves ordinary alphanumeric barcodes and apostrophe-prefixed text untouched', () => {
    expect(normaliseBarcodeCell('SAMPLE-0001')).toBe('SAMPLE-0001');
    expect(normaliseBarcodeCell("'6944200000000")).toBe('6944200000000');
  });
});
