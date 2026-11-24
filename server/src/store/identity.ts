// Seller + device identity for ZATCA Phase 2.
//
// WHY THIS EXISTS: before this file, two different identities were in play - the frontend's
// Settings page held the visible store name/VAT/CR (used only for the Phase 1 QR), while the signed
// UBL document and the CSR were built from `.env` (`config.seller` / `config.csr`). Those could
// disagree silently, and the only way to onboard a real device was to hand-edit `.env`.
//
// Now there is ONE stored identity used by all three places that must agree: the CSR subject, the
// UBL `AccountingSupplierParty`, and what the Settings page shows. `.env` values only SEED it the
// first time, so an existing installation keeps working unchanged.
//
// The device part mirrors what the PowerBuilder CSID generator (`w_scrn_zatca_csid_generator`)
// stores per terminal: terminal number, solution name/release, and an EGS serial of the form
// `1-<solution>|2-<release>|3-<uuid>`. Common Name is derived as `<terminal>-<solution>-<release>`
// exactly like that screen builds it, rather than being a free-text field that can drift from the
// serial number.
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import {
  loadState,
  saveState,
  ZERO_INVOICE_HASH,
  type ZatcaState,
} from './secureStore.js';
import type { UblSupplier } from '../ubl/types.js';

// ZATCA's invoice-type flag is 4 digits: standard, simplified, then two reserved zeros.
//   1000 = standard (B2B) only
//   0100 = simplified (B2C) only  <- what a pharmacy POS normally needs
//   1100 = both
export type InvoiceTypeFlag = '0100' | '1000' | '1100';

export interface SellerIdentity {
  nameEn: string;
  nameAr: string;
  vatNumber: string; // 15 digits, starts and ends with 3; blank is allowed while setting up
  crNumber: string;
  street: string;
  city: string;
  postalCode: string;
  district: string;
  country: string; // ISO 3166-1 alpha-2, "SA"
  organizationUnit: string; // CSR OU / branch name
  industry: string; // CSR businessCategory
}

export interface DeviceIdentity {
  terminalNo: number; // >= 1 - this register's identity inside the business
  solutionName: string;
  solutionRelease: string;
  egUuid: string; // stable 3rd component of the EGS serial - never regenerated on save
  invoiceType: InvoiceTypeFlag;
}

export interface ZatcaIdentity {
  seller: SellerIdentity;
  device: DeviceIdentity;
}

export interface DerivedIdentity {
  commonName: string;
  egsSerialNumber: string;
}

export const INVOICE_TYPES: InvoiceTypeFlag[] = ['0100', '1000', '1100'];

const EGS_SERIAL_RE = /^1-([^|]+)\|2-([^|]+)\|3-(.+)$/;

export function isInvoiceType(value: string): value is InvoiceTypeFlag {
  return (INVOICE_TYPES as string[]).includes(value);
}

// Parse the `.env` seed serial (`1-<solution>|2-<release>|3-<uuid>`) so an existing installation
// keeps its EGS identity when the stored identity is first created. Anything unparseable falls back
// to harmless defaults, including a generated UUID that is then persisted (so it stays stable).
export function parseEgsSerial(serial: string): { solutionName: string; solutionRelease: string; egUuid: string } | null {
  const match = EGS_SERIAL_RE.exec(serial.trim());
  if (!match) return null;
  return { solutionName: match[1].trim(), solutionRelease: match[2].trim(), egUuid: match[3].trim() };
}

export function deriveIdentity(device: DeviceIdentity): DerivedIdentity {
  return {
    commonName: `${device.terminalNo}-${device.solutionName}-${device.solutionRelease}`,
    egsSerialNumber: `1-${device.solutionName}|2-${device.solutionRelease}|3-${device.egUuid}`,
  };
}

export function defaultIdentity(): ZatcaIdentity {
  const seeded = parseEgsSerial(config.csr.serialNumber);
  return {
    seller: {
      nameEn: config.seller.nameEn,
      nameAr: config.seller.nameAr,
      vatNumber: config.seller.vatNumber,
      crNumber: config.seller.crNumber,
      street: config.seller.street,
      city: config.seller.city,
      postalCode: config.seller.postalCode,
      district: config.seller.district,
      country: config.seller.country || 'SA',
      organizationUnit: config.csr.organizationUnit || config.seller.city || '',
      industry: 'Pharmacy Retail',
    },
    device: {
      terminalNo: 1,
      solutionName: seeded?.solutionName || 'PharmacyApp',
      solutionRelease: seeded?.solutionRelease || '1.0',
      egUuid: seeded?.egUuid || randomUUID(),
      invoiceType: isInvoiceType(config.csr.invoiceType) ? config.csr.invoiceType : '0100',
    },
  };
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function integer(value: unknown, fallback: number): number {
  if (typeof value === 'number') return Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '') return Math.trunc(Number(value));
  return fallback;
}

// Accepts the untrusted JSON body of PUT /api/zatca/settings. Fields absent from the body keep
// their current value; fields present but blank are kept blank so validation can point at them
// instead of silently restoring a stale value the user just tried to clear.
export function normalizeIdentityInput(body: unknown, fallback: ZatcaIdentity): ZatcaIdentity {
  const input = (body ?? {}) as { seller?: Record<string, unknown>; device?: Record<string, unknown> };
  const seller = input.seller ?? {};
  const device = input.device ?? {};
  const invoiceTypeText = text(device.invoiceType, fallback.device.invoiceType);

  return {
    seller: {
      nameEn: text(seller.nameEn, fallback.seller.nameEn),
      nameAr: text(seller.nameAr, fallback.seller.nameAr),
      vatNumber: text(seller.vatNumber, fallback.seller.vatNumber),
      crNumber: text(seller.crNumber, fallback.seller.crNumber),
      street: text(seller.street, fallback.seller.street),
      city: text(seller.city, fallback.seller.city),
      postalCode: text(seller.postalCode, fallback.seller.postalCode),
      district: text(seller.district, fallback.seller.district),
      country: text(seller.country, fallback.seller.country).toUpperCase(),
      organizationUnit: text(seller.organizationUnit, fallback.seller.organizationUnit),
      industry: text(seller.industry, fallback.seller.industry),
    },
    device: {
      terminalNo: integer(device.terminalNo, fallback.device.terminalNo),
      solutionName: text(device.solutionName, fallback.device.solutionName),
      solutionRelease: text(device.solutionRelease, fallback.device.solutionRelease),
      egUuid: text(device.egUuid, fallback.device.egUuid),
      invoiceType: isInvoiceType(invoiceTypeText) ? invoiceTypeText : fallback.device.invoiceType,
    },
  };
}

// Format errors that must block a save. Blank OPTIONAL seller fields are allowed - a half-filled
// identity can be saved as a draft; `missingConfiguredFields` below decides whether it is complete
// enough to actually onboard.
export function validateIdentity(identity: ZatcaIdentity): string[] {
  const errors: string[] = [];
  const { seller, device } = identity;

  if (seller.vatNumber.length > 15) {
    errors.push('VAT number cannot be longer than 15 digits.');
  } else if (seller.vatNumber !== '' && !/^3\d{13}3$/.test(seller.vatNumber)) {
    errors.push('VAT number must be exactly 15 digits and start and end with 3.');
  }
  // The CR is written into every UBL invoice as the supplier's CompanyID, so a blank or non-numeric
  // CR produces a tax document ZATCA cannot match to the business. Validate it here as well as in
  // the required-fields list so the data-entry screen can point at the exact problem.
  if (seller.crNumber !== '' && !/^\d{8,15}$/.test(seller.crNumber)) {
    errors.push('Commercial Registration (CR) number must contain only 8 to 15 digits.');
  }
  if (seller.country !== '' && !/^[A-Z]{2}$/.test(seller.country)) {
    errors.push('Country must be a 2-letter ISO code (for example SA).');
  }

  if (!Number.isInteger(device.terminalNo) || device.terminalNo < 1) {
    errors.push('Terminal number must be a whole number of 1 or higher.');
  }
  if (!device.solutionName) errors.push('Solution name is required.');
  if (!device.solutionRelease) errors.push('Solution release is required.');
  if (device.solutionName.includes('|') || device.solutionRelease.includes('|')) {
    errors.push('Solution name and release cannot contain "|" - it separates the EGS serial components.');
  }
  if (!device.egUuid) errors.push('Device UUID is required.');
  if (!isInvoiceType(device.invoiceType)) errors.push('Invoice type must be 0100, 1000 or 1100.');

  return errors;
}

// What still has to be filled in before a CSR can be generated and a simplified invoice signed.
// Deliberately explicit (field names, not a boolean) so the Settings page can tell staff exactly
// what is missing instead of just failing onboarding with "not configured".
export function missingConfiguredFields(identity: ZatcaIdentity): string[] {
  const { seller } = identity;
  const missing: string[] = [];
  if (!seller.nameEn) missing.push('Seller name (English)');
  if (!seller.nameAr) missing.push('Seller name (Arabic)');
  if (!/^3\d{13}3$/.test(seller.vatNumber)) missing.push('VAT number (15 digits, starting and ending with 3)');
  if (!/^\d{8,15}$/.test(seller.crNumber)) missing.push('Commercial Registration (CR) number');
  if (!seller.street) missing.push('Street');
  if (!seller.city) missing.push('City');
  if (!seller.postalCode) missing.push('Postal code');
  if (!seller.district) missing.push('District');
  if (!seller.country) missing.push('Country');
  if (!seller.organizationUnit) missing.push('Organization unit / branch');
  if (!seller.industry) missing.push('Industry / business category');
  return missing;
}

export class IdentityValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join(' '));
    this.name = 'IdentityValidationError';
  }
}

export function requireIdentityConfigured(identity: ZatcaIdentity): void {
  const missing = missingConfiguredFields(identity);
  if (missing.length > 0) {
    throw new IdentityValidationError([
      `ZATCA seller/device identity is incomplete - fill in: ${missing.join(', ')} (Settings > ZATCA > Company & Device).`,
    ]);
  }
}

// `source` says whether the identity was already stored or is being reported straight from `.env`
// (first run). The Settings panel uses it to nudge the user to review/save instead of assuming the
// sample values from `.env.example` are their real registration.
export async function loadIdentity(): Promise<{ identity: ZatcaIdentity; source: 'stored' | 'env' }> {
  const state = await loadState();
  if (state.identity) {
    const fallback = defaultIdentity();
    return { identity: normalizeIdentityInput(state.identity, fallback), source: 'stored' };
  }

  const identity = defaultIdentity();
  state.identity = identity;
  await saveState(state);
  return { identity, source: 'env' };
}

// The CSR embeds these values, so changing any of them after a CSID was issued leaves a certificate
// that no longer describes this device/seller. Rather than keep submitting under a stale legal
// identity, clear the CSIDs and reset the invoice chain - the same clean slate an environment switch
// gives - and report that back so the UI can say "onboard again".
const CSR_RELEVANT_SELLER_FIELDS: Array<keyof SellerIdentity> = [
  'nameEn',
  'vatNumber',
  'country',
  'organizationUnit',
  'industry',
  'city',
  'district',
];

function csrIdentityKey(identity: ZatcaIdentity): string {
  const derived = deriveIdentity(identity.device);
  return JSON.stringify({
    commonName: derived.commonName,
    egsSerialNumber: derived.egsSerialNumber,
    invoiceType: identity.device.invoiceType,
    seller: CSR_RELEVANT_SELLER_FIELDS.map((field) => identity.seller[field]),
  });
}

export function csrIdentityChanged(previous: ZatcaIdentity, next: ZatcaIdentity): boolean {
  return csrIdentityKey(previous) !== csrIdentityKey(next);
}

export interface SaveIdentityResult {
  identity: ZatcaIdentity;
  csidsCleared: boolean;
}

export async function saveIdentity(identity: ZatcaIdentity): Promise<SaveIdentityResult> {
  const errors = validateIdentity(identity);
  if (errors.length > 0) throw new IdentityValidationError(errors);

  const state: ZatcaState = await loadState();
  let csidsCleared = false;

  if (
    state.identity &&
    csrIdentityChanged(normalizeIdentityInput(state.identity, defaultIdentity()), identity) &&
    (state.compliance || state.production)
  ) {
    state.compliance = undefined;
    state.production = undefined;
    state.icv = 0;
    state.lastInvoiceHash = ZERO_INVOICE_HASH;
    csidsCleared = true;
  }

  state.identity = identity;
  await saveState(state);
  return { identity, csidsCleared };
}

// The UBL supplier block is built from exactly the same stored seller identity as the CSR, so the
// certificate and the document cannot describe two different businesses.
export function toUblSupplier(seller: SellerIdentity): UblSupplier {
  return {
    nameEn: seller.nameEn,
    vatNumber: seller.vatNumber,
    crNumber: seller.crNumber,
    address: {
      street: seller.street,
      city: seller.city,
      postalCode: seller.postalCode,
      district: seller.district,
      country: seller.country,
    },
  };
}
