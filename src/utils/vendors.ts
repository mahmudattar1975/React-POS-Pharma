// Pure form helpers for the vendor master. The field set follows the legacy FCODCSVN vendor screen
// (cust_no, Arabic/English names, category, credit limit, settlement days, VAT type/file, GLN,
// notes, lock flag), adapted to this app's vendor number key. Kept out of the dialog so the
// validation and the blank/zero distinction are unit-tested directly.
import type { Vendor } from '../types/purchasing';
import { PARTY_TYPE_FLAG } from '../types/party';
import { CUSTOMER_NO_PREFIX, formatVendorNo, maxVendorNumber } from './purchasing';

export interface VendorFormValues {
  // Display only: addVendor assigns the real VEN- number; the form previews the next one.
  vendorNo: string;
  nameAr: string;
  nameEn: string;
  phone: string;
  category: string;
  creditLimit: string;
  settlementDays: string;
  vatNumber: string;
  vatType: string;
  glnNo: string;
  bonusDiscountSetNo: string;
  limitationSetNo: string;
  notes: string;
  isActive: boolean;
}

export const VENDOR_VAT_TYPES = [
  { value: 1, label: 'Standard rate (15%)' },
  { value: 2, label: 'Zero-rated' },
  { value: 3, label: 'Exempt' },
] as const;

export const EMPTY_VENDOR_FORM: VendorFormValues = {
  vendorNo: '',
  nameAr: '',
  nameEn: '',
  phone: '',
  category: '',
  creditLimit: '',
  settlementDays: '0',
  vatNumber: '',
  vatType: '1',
  glnNo: '',
  bonusDiscountSetNo: '',
  limitationSetNo: '',
  notes: '',
  isActive: true,
};

function text(value: string | number | undefined): string {
  return value === undefined || value === null ? '' : String(value);
}

export function vendorToForm(vendor: Vendor): VendorFormValues {
  return {
    vendorNo: vendor.vendorNo,
    nameAr: vendor.nameAr ?? '',
    nameEn: vendor.nameEn ?? '',
    phone: vendor.phone ?? '',
    category: vendor.category ?? '',
    creditLimit: text(vendor.creditLimit),
    settlementDays: text(vendor.settlementDays ?? 0),
    vatNumber: vendor.vatNumber ?? '',
    vatType: text(vendor.vatType ?? 1),
    glnNo: vendor.glnNo ?? '',
    bonusDiscountSetNo: text(vendor.bonusDiscountSetNo),
    limitationSetNo: text(vendor.limitationSetNo),
    notes: vendor.notes ?? '',
    isActive: vendor.isActive !== false,
  };
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function optionalNumber(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  return Number(value);
}

export function validateVendorForm(
  values: VendorFormValues
): Partial<Record<keyof VendorFormValues, string>> {
  const errors: Partial<Record<keyof VendorFormValues, string>> = {};

  if (!values.nameAr.trim()) errors.nameAr = 'Arabic name is required.';
  else if (values.nameAr.trim().length > 60) errors.nameAr = 'Arabic name is too long (max 60).';

  if (!values.nameEn.trim()) errors.nameEn = 'English name is required.';
  else if (values.nameEn.trim().length > 60) errors.nameEn = 'English name is too long (max 60).';

  if (values.phone.trim().length > 30) errors.phone = 'Phone is too long (max 30).';
  if (values.category.trim().length > 60) errors.category = 'Category is too long (max 60).';

  // KSA VAT registration is exactly 15 digits. Blank stays legal: a small local supplier may not
  // be registered. The field sanitises to digits as it is typed, so any remaining problem is length.
  if (values.vatNumber.trim() !== '' && values.vatNumber.trim().length !== 15) {
    errors.vatNumber = 'VAT number must be exactly 15 digits.';
  }
  // GS1 location number, exactly 13 digits when present (legacy gln_no).
  if (values.glnNo.trim() !== '' && values.glnNo.trim().length !== 13) {
    errors.glnNo = 'GLN must be exactly 13 digits.';
  }

  if (values.creditLimit.trim() !== '') {
    const n = Number(values.creditLimit);
    if (!Number.isFinite(n) || n < 0) errors.creditLimit = 'Enter zero or a positive amount.';
  }

  for (const key of ['settlementDays', 'bonusDiscountSetNo', 'limitationSetNo'] as const) {
    if (values[key].trim() === '') continue;
    const n = Number(values[key]);
    if (!Number.isInteger(n) || n < 0) errors[key] = 'Enter a whole number of 0 or more.';
  }

  if (![1, 2, 3].includes(Number(values.vatType))) errors.vatType = 'Choose a VAT type.';
  if (values.notes.length > 2000) errors.notes = 'Notes are too long (max 2000).';

  return errors;
}

// Persist-merge for the vendor master: keep the owner's rows/edits, fill seed rows with any NEW
// vendor-file fields (category, credit terms, GLN, notes) added after the session was saved,
// backfill a number on rows saved before system numbering, and append brand-new seed vendors.
export function mergeVendorMaster(persisted: Vendor[] | undefined, seeds: Vendor[]): Vendor[] {
  const base = persisted ?? seeds;
  const seedById = new Map(seeds.map((v) => [v.id, v]));
  // Start above every number that will exist after the merge (persisted rows AND appended seeds),
  // so a legacy row can never backfill onto a seed vendor's number.
  let seq = maxVendorNumber([...base, ...seeds]) + 1;

  const merged = base.map((vendor) => {
    const seed = seedById.get(vendor.id);
    // `typeFlag` arrived with the shared party table; older saved rows predate it. A saved CUS-
    // number means the row is a customer account, otherwise it is a vendor. Seeds carry their own
    // flag, so a seed row keeps the right side even if its old copy lost the field.
    const typeFlag =
      vendor.typeFlag ??
      (vendor.vendorNo?.startsWith(CUSTOMER_NO_PREFIX)
        ? PARTY_TYPE_FLAG.customer
        : (seed?.typeFlag ?? PARTY_TYPE_FLAG.vendor));
    const row = seed
      ? { ...seed, ...vendor, typeFlag }
      : { ...vendor, typeFlag };
    if (row.vendorNo) return row;
    // A seed row whose old saved copy lost its number keeps the seed's own number; a genuinely
    // unnumbered legacy row gets the next free one.
    return { ...row, vendorNo: seed?.vendorNo ?? formatVendorNo(seq++) };
  });

  const ids = new Set(merged.map((v) => v.id));
  return [...merged, ...seeds.filter((v) => !ids.has(v.id))];
}

// Converts the string form back to the persisted shape: blank optional fields become undefined
// (not 0 or ''), so "no credit limit" stays distinct from "credit limit is zero".
export function formToVendorInput(
  values: VendorFormValues
): Omit<Vendor, 'id' | 'vendorNo' | 'typeFlag'> {
  return {
    nameAr: values.nameAr.trim(),
    nameEn: values.nameEn.trim(),
    phone: values.phone.trim(),
    vatNumber: optionalText(values.vatNumber),
    category: optionalText(values.category),
    creditLimit: optionalNumber(values.creditLimit),
    settlementDays: optionalNumber(values.settlementDays),
    vatType: optionalNumber(values.vatType),
    glnNo: optionalText(values.glnNo),
    bonusDiscountSetNo: optionalNumber(values.bonusDiscountSetNo),
    limitationSetNo: optionalNumber(values.limitationSetNo),
    notes: optionalText(values.notes),
    isActive: values.isActive,
  };
}
