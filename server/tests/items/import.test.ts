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

  it('rejects duplicate barcodes in one file', () => {
    expect(() => validateItemImportBody({ items: [row(), row()] })).toThrow(/more than once/i);
  });

  it('rejects an out-of-range VAT rate', () => {
    expect(() => validateItemImportBody({ items: [row({ vatRate: 15 })] })).toThrow(/VAT rate/i);
  });
});
