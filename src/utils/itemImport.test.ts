import { describe, expect, it } from 'vitest';
import type { Item } from '../types/catalog';
import {
  detectItemColumns, planItemImport, type ItemColumnMapping,
} from './itemImport';

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
});
