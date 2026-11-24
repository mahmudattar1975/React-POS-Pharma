// Vendor-master form rules: required Arabic/English names, 15-digit KSA VAT, 13-digit GLN, and the
// blank-vs-zero distinction for optional numeric settings.
import { describe, expect, it } from 'vitest';

import type { Vendor } from '../types/purchasing';
import {
  EMPTY_VENDOR_FORM,
  formToVendorInput,
  mergeVendorMaster,
  validateVendorForm,
  vendorToForm,
} from './vendors';
import { seedVendors } from './seedData';

const valid = {
  ...EMPTY_VENDOR_FORM,
  nameAr: 'شركة الحياة',
  nameEn: 'Al-Hayat Drug Distribution Co.',
};

describe('vendor form validation', () => {
  it('requires both names', () => {
    const errors = validateVendorForm({ ...EMPTY_VENDOR_FORM });
    expect(errors.nameAr).toMatch(/required/i);
    expect(errors.nameEn).toMatch(/required/i);
  });

  it('accepts a blank VAT number but requires exactly 15 digits when present', () => {
    expect(validateVendorForm(valid).vatNumber).toBeUndefined();
    expect(validateVendorForm({ ...valid, vatNumber: '3105551234000' }).vatNumber).toMatch(/15 digits/);
    expect(validateVendorForm({ ...valid, vatNumber: '310555123400003' }).vatNumber).toBeUndefined();
  });

  it('requires exactly 13 digits for a GLN when present', () => {
    expect(validateVendorForm(valid).glnNo).toBeUndefined();
    expect(validateVendorForm({ ...valid, glnNo: '628100001000' }).glnNo).toMatch(/13 digits/);
    expect(validateVendorForm({ ...valid, glnNo: '6281000010001' }).glnNo).toBeUndefined();
  });

  it('rejects negative or fractional settings', () => {
    const errors = validateVendorForm({
      ...valid,
      creditLimit: '-1',
      settlementDays: '1.5',
      bonusDiscountSetNo: 'abc',
      limitationSetNo: '-2',
    });
    expect(errors.creditLimit).toBeTruthy();
    expect(errors.settlementDays).toBeTruthy();
    expect(errors.bonusDiscountSetNo).toBeTruthy();
    expect(errors.limitationSetNo).toBeTruthy();
  });

  it('accepts zero credit and zero settlement days', () => {
    const errors = validateVendorForm({ ...valid, creditLimit: '0', settlementDays: '0' });
    expect(errors.creditLimit).toBeUndefined();
    expect(errors.settlementDays).toBeUndefined();
  });
});

describe('vendor form mapping', () => {
  it('maps a stored vendor into strings without losing optional fields', () => {
    const vendor: Vendor = {
      id: 'ven-1',
      typeFlag: 1,
      vendorNo: 'VEN-000009',
      nameAr: 'شركة',
      nameEn: 'Company',
      phone: '0114445566',
      vatNumber: '310555123400003',
      category: 'Distributor',
      creditLimit: 50000,
      settlementDays: 30,
      vatType: 1,
      glnNo: '6281000010001',
      bonusDiscountSetNo: 2,
      limitationSetNo: 3,
      notes: 'Priority supplier',
      isActive: false,
    };
    const form = vendorToForm(vendor);
    expect(form.vendorNo).toBe('VEN-000009');
    expect(form.creditLimit).toBe('50000');
    expect(form.bonusDiscountSetNo).toBe('2');
    expect(form.isActive).toBe(false);
    expect(formToVendorInput(form)).toMatchObject({
      nameEn: 'Company',
      creditLimit: 50000,
      vatType: 1,
      glnNo: '6281000010001',
      isActive: false,
    });
  });

  it('turns blank optionals into undefined, not zero', () => {
    const input = formToVendorInput(valid);
    expect(input.creditLimit).toBeUndefined();
    expect(input.bonusDiscountSetNo).toBeUndefined();
    expect(input.limitationSetNo).toBeUndefined();
    expect(input.vatNumber).toBeUndefined();
    expect(input.notes).toBeUndefined();
  });

  it('trims names and notes before saving', () => {
    const input = formToVendorInput({ ...valid, nameAr: '  شركة  ', nameEn: '  Company  ', notes: '  note  ' });
    expect(input.nameAr).toBe('شركة');
    expect(input.nameEn).toBe('Company');
    expect(input.notes).toBe('note');
  });
});

describe('vendor master persist merge', () => {
  it('backfills new vendor-file fields on a persisted seed row and keeps the owner edit', () => {
    const persisted: Vendor[] = [{
      id: 'ven-1',
      typeFlag: 1,
      vendorNo: 'VEN-000001',
      nameAr: 'شركة الحياة',
      nameEn: 'Owner Renamed Vendor',
      phone: '0114445566',
      vatNumber: '310555123400003',
    }];

    const merged = mergeVendorMaster(persisted, seedVendors);
    const vendor = merged.find((v) => v.id === 'ven-1');

    expect(vendor?.nameEn).toBe('Owner Renamed Vendor');
    expect(vendor?.category).toBe('National distributor');
    expect(vendor?.creditLimit).toBe(50000);
    expect(vendor?.glnNo).toBe('6281000010001');
    expect(vendor?.isActive).toBe(true);
    // Older saved rows predate the shared party flag; they are vendors by construction.
    expect(vendor?.typeFlag).toBe(1);
  });

  it('assigns a unique number to a persisted vendor saved before numbering existed', () => {
    const persisted: Vendor[] = [
      { id: 'ven-1', typeFlag: 1, vendorNo: '', nameAr: 'أ', nameEn: 'One', phone: '' },
      { id: 'legacy', typeFlag: 1, vendorNo: '', nameAr: 'ب', nameEn: 'Legacy', phone: '' },
    ];

    const merged = mergeVendorMaster(persisted, seedVendors);
    const legacy = merged.find((v) => v.id === 'legacy');
    expect(legacy?.vendorNo).toMatch(/^VEN-\d{6}$/);
    expect(merged.filter((v) => v.vendorNo === legacy?.vendorNo)).toHaveLength(1);
  });

  it('appends a brand-new seed vendor to an older persisted master', () => {
    const persisted: Vendor[] = [seedVendors[0]];
    const merged = mergeVendorMaster(persisted, seedVendors);
    expect(merged.map((v) => v.id)).toEqual(seedVendors.map((v) => v.id));
  });
});
