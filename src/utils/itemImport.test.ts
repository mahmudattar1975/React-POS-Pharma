import { describe, expect, it } from 'vitest';
import type { Item } from '../types/catalog';
import {
  detectItemColumns, normaliseBarcodeCell, planItemImport, type ItemColumnMapping,
} from './itemImport';
import {
  buildItemImportSampleWorkbook, ITEM_IMPORT_SAMPLE_HEADERS, ITEM_IMPORT_SAMPLE_ROWS,
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

  it('keeps several printed codes on one row and parses ; and , separators', () => {
    const extraColumns = detectItemColumns([...headers, 'Extra Barcodes']);
    expect(extraColumns.extraBarcodes).toBe('Extra Barcodes');
    const plan = planItemImport([
      row({
        Barcode: '77777770585',
        'Extra Barcodes': '77777770586; 77777770587',
        'Item Name': 'AL SHAROUQ LOOFA 418',
      }),
      row({ Barcode: '8850851510607', 'Extra Barcodes': '8850851510584, 8850851510591', 'Item Name': 'ANGEL SILICONE NIPPLE 3 PCS' }),
    ], extraColumns, []);
    expect(plan.errors).toBe(0);
    expect(plan.apply).toHaveLength(2);
    expect(plan.apply[0]).toMatchObject({
      barcode: '77777770585',
      barcodes: ['77777770586', '77777770587'],
    });
    expect(plan.apply[1]).toMatchObject({
      barcode: '8850851510607',
      barcodes: ['8850851510584', '8850851510591'],
    });
  });

  it('merges repeated English names into one item and keeps every row barcode as an alias', () => {
    const plan = planItemImport([
      row({ Barcode: '77777770585', 'Item Name': 'AL SHAROUQ LOOFA 418' }),
      row({ Barcode: '77777770586', 'Item Name': 'AL SHAROUQ LOOFA 418' }),
      row({ Barcode: '8850851510607', 'Item Name': 'ANGEL SILICONE NIPPLE 3 PCS' }),
      row({ Barcode: '8850851510584', 'Item Name': 'Angel Silicone Nipple 3 PCS' }),
    ], columns, []);
    expect(plan.errors).toBe(0);
    expect(plan.create).toBe(2);
    expect(plan.apply).toHaveLength(2);
    expect(plan.apply[0]).toMatchObject({
      barcode: '77777770585',
      barcodes: ['77777770586'],
    });
    expect(plan.apply[1]).toMatchObject({
      barcode: '8850851510607',
      barcodes: ['8850851510584'],
    });
    expect(plan.rows[0].note).toMatch(/Rows 3 .*same English name/i);
    expect(plan.rows.find((row) => row.barcode === '8850851510607')?.note)
      .toMatch(/Rows 5 .*same English name/i);
  });

  it('does not let one row list the same code twice or use its main barcode as an alias', () => {
    const extraColumns = detectItemColumns([...headers, 'Extra Barcodes']);
    const plan = planItemImport([
      row({ Barcode: '6281007320666', 'Extra Barcodes': '77777770586;77777770586' }),
      row({ Barcode: '6281007320777', 'Extra Barcodes': '6281007320777', 'Item Name': 'Second Item' }),
    ], extraColumns, []);
    expect(plan.errors).toBe(2);
    expect(plan.rows[0].note).toMatch(/listed twice/i);
    expect(plan.rows[1].note).toMatch(/main barcode or is listed twice/i);
    expect(plan.apply).toHaveLength(0);
  });

  it('blocks the file when an extra code is also used as another row main barcode', () => {
    const extraColumns = detectItemColumns([...headers, 'Extra Barcodes']);
    const plan = planItemImport([
      row({ 'Extra Barcodes': '6281007320888' }),
      row({ Barcode: '6281007320888', 'Item Name': 'Second Item' }),
    ], extraColumns, []);
    expect(plan.errors).toBe(1);
    expect(plan.rows[1].note).toMatch(/already used as an extra code on row/i);
  });

  it('blocks an extra code that already belongs to a different local item', () => {
    const extraColumns = detectItemColumns([...headers, 'Extra Barcodes']);
    const other = { ...item('77777770586', 'Other Item'), barcodes: [] };
    const plan = planItemImport([
      row({ 'Extra Barcodes': '77777770586' }),
    ], extraColumns, [other]);
    expect(plan.errors).toBe(1);
    expect(plan.rows[0].note).toMatch(/already belongs to Other Item/i);
    expect(plan.apply).toHaveLength(0);
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

  it('blocks the file when a CategoryID value is not in the master', () => {
    const categoryColumns = detectItemColumns([...headers, 'CategoryID']);
    const plan = planItemImport([row({ 'CategoryID': 'CAT-999' })], categoryColumns, []);
    expect(plan.errors).toBe(1);
    expect(plan.rows[0].note).toMatch(/not in the category master/i);
    expect(plan.apply).toHaveLength(0);
  });

  it('resolves legacy category descriptions but still writes the canonical English label', () => {
    const categoryColumns = detectItemColumns([...headers, 'CategoryID']);
    const cases: Array<[string, number, string]> = [
      ['RX - riadh', 1, 'Medicines'],
      ['DIAPPERS', 3, 'Diapers'],
      ['COSMOTICS', 4, 'Cosmetics'],
      ['BODY CARE', 11, 'Personal Hygiene, Body Care'],
      ['MILK', 43, 'Milk'],
      ['MEDICATED COSMOTICS', 44, 'Medicated Cosmetics'],
    ];
    for (const [value, categoryId, category] of cases) {
      const plan = planItemImport([row({ CategoryID: value, Category: 'Ignored text' })], categoryColumns, []);
      expect(plan.errors, value).toBe(0);
      expect(plan.apply[0], value).toMatchObject({ categoryId, category });
    }
  });

  it('treats legacy scope flags as unlinked instead of blocking the whole file', () => {
    const categoryColumns = detectItemColumns([...headers, 'CategoryID']);
    for (const value of ['All', 'Saleable / PoS']) {
      const plan = planItemImport([row({ CategoryID: value, Category: 'Walk-ins' })], categoryColumns, []);
      expect(plan.errors, value).toBe(0);
      expect(plan.apply[0], value).toMatchObject({ category: 'Walk-ins' });
      expect(plan.apply[0].categoryId, value).toBeUndefined();
    }
  });
});

describe('Excel sample template', () => {
  const sampleColumns = detectItemColumns(ITEM_IMPORT_SAMPLE_HEADERS);

  it('detects the owner ERP headers automatically and merges the two example rows', () => {
    expect(sampleColumns).toMatchObject({
      barcode: 'Barcode',
      nameEn: 'Name',
      category: 'Product Category',
      basePrice: 'Sales Price',
      vatRate: 'Customer Taxes',
      vendorNo: 'Vendor',
      manufacturerNo: 'Manufactured',
    });
    const plan = planItemImport(ITEM_IMPORT_SAMPLE_ROWS, sampleColumns, []);
    expect(plan.errors).toBe(0);
    expect(plan.create).toBe(1);
    expect(plan.apply[0]).toMatchObject({
      barcode: '5247619187585',
      barcodes: ['5281018089071'],
      category: 'All / COSMOTICS',
      basePrice: 99,
      vatRate: 0.15,
      manufacturerNo: 'BEESLINE',
      requiresBatchTracking: true,
      isActive: true,
    });
  });

  it('builds a workbook whose first sheet is the importable Items sheet', async () => {
    const workbook = await buildItemImportSampleWorkbook();
    expect(workbook.SheetNames).toEqual(['Items', 'How to fill']);
    const XLSX = await import('xlsx');
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Items, { defval: '' });
    expect(rows).toHaveLength(ITEM_IMPORT_SAMPLE_ROWS.length);
    rows.forEach((row, index) => expect(row).toMatchObject(ITEM_IMPORT_SAMPLE_ROWS[index]));
  });

  it('merges the owner sample into four items and keeps @ and 15 Sales codes valid', () => {
    const erpRow = (
      barcode: string,
      name: string,
      category: string,
      brand: string,
      price: number,
      taxes: string,
    ) => ({
      Barcode: barcode,
      Name: name,
      'Product Category': category,
      Brand: brand,
      Vendor: '',
      Manufactured: brand,
      Cost: 0,
      'Sales Price': price,
      'Customer Taxes': taxes,
    });

    const plan = planItemImport([
      erpRow('5247619187585', 'BEESLINE SUN SCREEN F/ FLUID 50 40ML', 'All / COSMOTICS', 'BEESLINE', 99, '15 Sales'),
      erpRow('5281018089071', 'BEESLINE SUN SCREEN F/ FLUID 50 40ML', 'All / COSMOTICS', 'BEESLINE', 99, '15 Sales'),
      erpRow('04694@43983', 'BODY CARE SLIMMING MASSAGE BELT', 'All / MEDICAL SUPPLIES', '', 250, '0 Sales'),
      erpRow('6947349600925', 'body care slimming massage belt', 'All / MEDICAL SUPPLIES', 'BODY', 0, '0 Sales'),
      ...['6974482590271', '6974482590257', '6974482590240', '6974482590301', '6974482590295']
        .map((code) => erpRow(code, 'Christine Lip Gloss and Plumper', 'All / COSMOTICS', 'CHRISTINE', 0, '0 Sales')),
      ...['746092082240', '746092082226', '746092081618', '746092082233', '746092081601', '746092081625', '746092082257']
        .map((code) => erpRow(code, 'Christine Liquid Concealer', 'All / COSMOTICS', 'CHRISTINE', 0, '0 Sales')),
    ], sampleColumns, []);

    expect(plan.errors).toBe(0);
    expect(plan.create).toBe(4);
    expect(plan.apply).toHaveLength(4);
    expect(plan.apply.map((row) => row.barcode)).toEqual([
      '5247619187585',
      '04694@43983',
      '6974482590271',
      '746092082240',
    ]);
    expect(plan.apply.map((row) => row.barcodes)).toEqual([
      ['5281018089071'],
      ['6947349600925'],
      ['6974482590257', '6974482590240', '6974482590301', '6974482590295'],
      ['746092082226', '746092081618', '746092082233', '746092081601', '746092081625', '746092082257'],
    ]);
    expect(plan.apply[0]).toMatchObject({ basePrice: 99, vatRate: 0.15, category: 'All / COSMOTICS' });
    expect(plan.apply[1]).toMatchObject({ basePrice: 250, vatRate: 0, category: 'All / MEDICAL SUPPLIES' });
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
