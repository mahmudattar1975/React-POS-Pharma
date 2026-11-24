// Pure helpers for Settings > ZATCA > Company & Device - no fetch, no React, no store.
//
// The server owns the stored identity and derives Common Name / EGS serial itself. These helpers
// exist so the form can (a) SHOW the derivation live while the user types and (b) reject obvious
// mistakes before a round-trip. They must match server/src/store/identity.ts exactly; the unit tests
// pin the format.
import type {
  ZatcaCsidLifecycle,
  ZatcaDeviceIdentity,
  ZatcaInvoiceTypeFlag,
  ZatcaSellerIdentity,
} from '../api/zatcaApi';

export const INVOICE_TYPE_CHOICES: ReadonlyArray<{
  value: ZatcaInvoiceTypeFlag;
  label: string;
  help: string;
}> = [
  {
    value: '0100',
    label: 'Simplified only (0100)',
    help: 'B2C receipts. Reported to ZATCA within 24 hours. This is what a pharmacy POS normally needs.',
  },
  {
    value: '1000',
    label: 'Standard only (1000)',
    help: 'B2B tax invoices. Cleared by ZATCA before they may be given to the buyer.',
  },
  {
    value: '1100',
    label: 'Both (1100)',
    help: 'This device issues both standard and simplified invoices.',
  },
];

export function deriveCommonName(
  device: Pick<ZatcaDeviceIdentity, 'terminalNo' | 'solutionName' | 'solutionRelease'>,
): string {
  return `${device.terminalNo}-${device.solutionName}-${device.solutionRelease}`;
}

export function deriveEgsSerial(
  device: Pick<ZatcaDeviceIdentity, 'solutionName' | 'solutionRelease' | 'egUuid'>,
): string {
  return `1-${device.solutionName}|2-${device.solutionRelease}|3-${device.egUuid}`;
}

// Blank is allowed (an installation may not be VAT-registered yet); once something is typed it must
// be a real ZATCA seller VAT number. The field itself is hard-limited to 15 characters in the UI via
// cleanVatNumberInput, so "longer than 15" is a belt-and-braces check here.
export function vatNumberError(vat: string): string | null {
  const value = vat.trim();
  if (value === '') return null;
  if (!/^\d+$/.test(value)) return 'VAT number must contain digits only.';
  if (value.length > 15) return 'VAT number cannot be longer than 15 digits.';
  if (value.length < 15) return `VAT number needs 15 digits - ${value.length} entered.`;
  if (!/^3\d{13}3$/.test(value)) return 'ZATCA VAT numbers start and end with 3.';
  return null;
}

// Format errors that make a save pointless. Incomplete BUT well-formed values are allowed - the
// server marks them as "not configured yet" and lists what is missing for onboarding.
export function identityDraftErrors(
  seller: ZatcaSellerIdentity,
  device: ZatcaDeviceIdentity,
): string[] {
  const errors: string[] = [];

  const vatError = vatNumberError(seller.vatNumber);
  if (vatError) errors.push(vatError);

  // Same rule as server/src/store/identity.ts: the CR is embedded in every signed invoice as the
  // supplier CompanyID, so a typo here would put a wrong legal identifier on a tax document.
  if (seller.crNumber.trim() !== '' && !/^\d{8,15}$/.test(seller.crNumber.trim())) {
    errors.push('Commercial Registration (CR) number must contain only 8 to 15 digits.');
  }

  if (seller.country.trim() !== '' && !/^[A-Za-z]{2}$/.test(seller.country.trim())) {
    errors.push('Country must be a 2-letter ISO code (for example SA).');
  }

  if (!Number.isInteger(device.terminalNo) || device.terminalNo < 1) {
    errors.push('Terminal number must be a whole number of 1 or higher.');
  }
  if (!device.solutionName.trim()) errors.push('Solution name is required.');
  if (!device.solutionRelease.trim()) errors.push('Solution release is required.');
  if (device.solutionName.includes('|') || device.solutionRelease.includes('|')) {
    errors.push('Solution name and release cannot contain "|".');
  }
  if (!device.egUuid.trim()) errors.push('Device UUID is required.');
  if (!INVOICE_TYPE_CHOICES.some((choice) => choice.value === device.invoiceType)) {
    errors.push('Invoice type must be 0100, 1000 or 1100.');
  }

  return errors;
}

// Presentation for the CSID card. `unknown` is deliberately not green: if the stored certificate
// cannot be parsed, the safe assumption is "don't trust it", not "it's fine".
export const CSID_STATUS_LABEL: Record<
  ZatcaCsidLifecycle,
  { label: string; color: 'success' | 'warning' | 'error' | 'default' }
> = {
  active: { label: 'Active', color: 'success' },
  expiring: { label: 'Expiring soon', color: 'warning' },
  expired: { label: 'Expired', color: 'error' },
  unknown: { label: 'Unknown', color: 'default' },
};

export function csidExpiryText(daysUntilExpiry: number | null): string {
  if (daysUntilExpiry === null) return 'expiry date unavailable';
  if (daysUntilExpiry < 0) return `expired ${Math.abs(daysUntilExpiry)} day${Math.abs(daysUntilExpiry) === 1 ? '' : 's'} ago`;
  if (daysUntilExpiry === 0) return 'expires today';
  return `${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'} left`;
}
