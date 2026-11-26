import { describe, expect, it } from 'vitest';
import { validateItemImportBody } from '../../src/items/import.js';

const row = (overrides: Record<string, unknown> = {}) => ({
  barcode: '6281007320999',
  nameEn: 'Imported Item',
  nameAr: 'صنف مستورد',
  unit: 'Box',
  category: 'Analgesics',
  basePrice: 12.5,
  vatRate: 0.15,
  requiresBatchTracking: true,
  reorderLevel: 0,
  controlledStatus: null,
  isActive: true,
  ...overrides,
});

describe('item import server validation', () => {
  it('accepts a valid normalised row', () => {
    const result = validateItemImportBody({ items: [row()] });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ barcode: '6281007320999', basePrice: 12.5, vatRate: 0.15 });
  });

  it('rejects a malformed barcode before any write', () => {
    expect(() => validateItemImportBody({ items: [row({ barcode: 'bad code' })] })).toThrow(/barcode/i);
  });

  it('accepts legacy supplier codes containing @', () => {
    const result = validateItemImportBody({ items: [row({ barcode: '04694@43983' })] });
    expect(result.items[0].barcode).toBe('04694@43983');
  });

  it('accepts vendor and manufacturer metadata from the ERP sheet', () => {
    const result = validateItemImportBody({
      items: [row({ vendorNo: 'VENDOR-001', manufacturerNo: 'BEESLINE' })],
    });
    expect(result.items[0]).toMatchObject({ vendorNo: 'VENDOR-001', manufacturerNo: 'BEESLINE' });
  });

  it('accepts extra barcodes as aliases of one item', () => {
    const result = validateItemImportBody({
      items: [row({ barcode: '77777770585', barcodes: ['77777770586', '77777770587'] })],
    });
    expect(result.items[0]).toMatchObject({
      barcode: '77777770585',
      barcodes: ['77777770586', '77777770587'],
    });
  });

  it('rejects a malformed or repeated extra barcode', () => {
    expect(() => validateItemImportBody({
      items: [row({ barcodes: ['bad code'] })],
    })).toThrow(/extra barcode/i);
    expect(() => validateItemImportBody({
      items: [row({ barcodes: ['77777770586', '77777770586'] })],
    })).toThrow(/listed twice/i);
    expect(() => validateItemImportBody({
      items: [row({ barcodes: ['6281007320999'] })],
    })).toThrow(/main barcode/i);
  });

  it('rejects duplicate barcodes in one file, including aliases', () => {
    expect(() => validateItemImportBody({ items: [row(), row()] })).toThrow(/more than once/i);
    expect(() => validateItemImportBody({
      items: [row({ barcodes: ['77777770586'] }), row({ barcode: '77777770586' })],
    })).toThrow(/more than once/i);
  });

  it('rejects an out-of-range VAT rate', () => {
    expect(() => validateItemImportBody({ items: [row({ vatRate: 15 })] })).toThrow(/VAT rate/i);
  });

  it('accepts a positive ItemCategories id', () => {
    const result = validateItemImportBody({ items: [row({ categoryId: 8, category: 'Vitamins & Supplements' })] });
    expect(result.items[0].categoryId).toBe(8);
  });

  it('rejects a malformed ItemCategories id before any write', () => {
    expect(() => validateItemImportBody({ items: [row({ categoryId: 'CAT-008' })] })).toThrow(/category id/i);
  });
});
