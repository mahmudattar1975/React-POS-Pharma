// Pure helpers behind Settings > ZATCA > Company & Device. The formats pinned here must stay in
// lockstep with server/src/store/identity.ts - a drift would put a different Common Name/EGS serial
// in the server's CSR than the one the form showed before saving.
import { describe, expect, it } from 'vitest';

import type { ZatcaDeviceIdentity, ZatcaSellerIdentity } from '../api/zatcaApi';
import {
  CSID_STATUS_LABEL,
  INVOICE_TYPE_CHOICES,
  csidExpiryText,
  deriveCommonName,
  deriveEgsSerial,
  identityDraftErrors,
  vatNumberError,
} from './zatcaIdentity';

const device: ZatcaDeviceIdentity = {
  terminalNo: 2,
  solutionName: 'PharmacyApp',
  solutionRelease: '1.4',
  egUuid: '8f14e45f-ea4e-4f0e-9b1c-2f4c1b7d1234',
  invoiceType: '0100',
};

const seller: ZatcaSellerIdentity = {
  nameEn: 'Al-Shifa Pharmacy',
  nameAr: 'صيدلية الشفاء',
  vatNumber: '300012345600003',
  crNumber: '1010123456',
  street: 'King Fahd Road',
  city: 'Riyadh',
  postalCode: '12345',
  district: 'Al Olaya',
  country: 'SA',
  organizationUnit: 'Riyadh Branch',
  industry: 'Pharmacy Retail',
};

describe('deriveCommonName', () => {
  it('is <terminal>-<solution>-<release>, the format the PB CSID screen builds', () => {
    expect(deriveCommonName(device)).toBe('2-PharmacyApp-1.4');
  });

  it('changes with the terminal number, so two registers cannot share a certificate', () => {
    expect(deriveCommonName({ ...device, terminalNo: 3 })).toBe('3-PharmacyApp-1.4');
  });
});

describe('deriveEgsSerial', () => {
  it('is 1-<solution>|2-<release>|3-<uuid>', () => {
    expect(deriveEgsSerial(device)).toBe(
      '1-PharmacyApp|2-1.4|3-8f14e45f-ea4e-4f0e-9b1c-2f4c1b7d1234',
    );
  });

  it('does not include the terminal number (that lives in the Common Name)', () => {
    const otherTerminal: ZatcaDeviceIdentity = { ...device, terminalNo: 9 };
    const { solutionName, solutionRelease, egUuid } = otherTerminal;
    expect(deriveEgsSerial({ solutionName, solutionRelease, egUuid })).toBe(deriveEgsSerial(device));
  });
});

describe('vatNumberError', () => {
  it('allows blank - a store may not be VAT-registered while it is being set up', () => {
    expect(vatNumberError('')).toBeNull();
    expect(vatNumberError('   ')).toBeNull();
  });

  it('accepts the ZATCA 15-digit 3...3 form', () => {
    expect(vatNumberError('300012345600003')).toBeNull();
  });

  it('rejects a number that is too short or too long', () => {
    expect(vatNumberError('30001234560000')).toContain('needs 15 digits');
    expect(vatNumberError('3000123456000039')).toContain('longer than 15 digits');
  });

  it('rejects non-digits and wrong first/last digits', () => {
    expect(vatNumberError('30001234560000A')).toContain('digits only');
    expect(vatNumberError('200012345600002')).toContain('start and end with 3');
  });
});

describe('identityDraftErrors', () => {
  it('accepts a complete identity', () => {
    expect(identityDraftErrors(seller, device)).toEqual([]);
  });

  it('accepts blank optional seller fields (draft identity)', () => {
    expect(identityDraftErrors({ ...seller, nameEn: '', vatNumber: '' }, device)).toEqual([]);
  });

  it('rejects a terminal number below 1', () => {
    expect(identityDraftErrors(seller, { ...device, terminalNo: 0 })).toEqual([
      'Terminal number must be a whole number of 1 or higher.',
    ]);
  });

  it('rejects blank solution name/release - they are half of the certificate identity', () => {
    const errors = identityDraftErrors(seller, { ...device, solutionName: '', solutionRelease: '' });
    expect(errors).toContain('Solution name is required.');
    expect(errors).toContain('Solution release is required.');
  });

  it('rejects "|" in the solution parts because it delimits the EGS serial', () => {
    expect(identityDraftErrors(seller, { ...device, solutionName: 'A|B' })).toContain(
      'Solution name and release cannot contain "|".',
    );
  });

  it('surfaces the VAT format problem', () => {
    expect(identityDraftErrors({ ...seller, vatNumber: '123' }, device)).toEqual([
      'VAT number needs 15 digits - 3 entered.',
    ]);
  });
});

describe('invoice type choices', () => {
  it('offers exactly the three ZATCA flags, with simplified first for a POS', () => {
    expect(INVOICE_TYPE_CHOICES.map((c) => c.value)).toEqual(['0100', '1000', '1100']);
  });
});

describe('CSID presentation', () => {
  it('labels every lifecycle state', () => {
    expect(Object.keys(CSID_STATUS_LABEL).sort()).toEqual(['active', 'expired', 'expiring', 'unknown']);
    expect(CSID_STATUS_LABEL.expired.color).toBe('error');
    expect(CSID_STATUS_LABEL.unknown.color).toBe('default');
  });

  it('turns days-until-expiry into readable text', () => {
    expect(csidExpiryText(null)).toBe('expiry date unavailable');
    expect(csidExpiryText(-2)).toBe('expired 2 days ago');
    expect(csidExpiryText(0)).toBe('expires today');
    expect(csidExpiryText(1)).toBe('1 day left');
    expect(csidExpiryText(45)).toBe('45 days left');
  });
});
