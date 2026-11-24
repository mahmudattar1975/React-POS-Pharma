// Validation runs before any SOAP call: SFDA rejects the whole request for small format mistakes,
// and a rejected unit costs a real round-trip plus a terminal ledger row.
import { describe, expect, it } from 'vitest';
import { RsdApiError } from '../../src/rsd/errors';
import {
  normalizeCancelInput,
  normalizeExpiry,
  normalizeGtin,
  normalizePrescriptionDate,
  normalizeSaleInput,
  normalizeSerialNo,
  normalizeToGln,
  normalizeUnit,
  todayIso,
} from '../../src/rsd/normalize';

function fails(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(RsdApiError);
    expect((err as RsdApiError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}, but nothing was thrown`);
}

const unit = {
  gtin: '06281007320021',
  serialNo: 'SN123456',
  batchNo: 'AX24C09',
  expiryDate: '2027-05-31',
};

describe('normalizeGtin', () => {
  it('pads a GTIN-13 to the 14 digits printed under AI (01)', () => {
    expect(normalizeGtin('6281007320021')).toBe('06281007320021');
  });

  it('keeps an already 14-digit GTIN', () => {
    expect(normalizeGtin(' 06281007320021 ')).toBe('06281007320021');
  });

  it('rejects too-short and too-long codes', () => {
    fails(() => normalizeGtin('1234567'), 'invalid_gtin');
    fails(() => normalizeGtin('123456789012345'), 'invalid_gtin');
    fails(() => normalizeGtin(''), 'invalid_request');
  });
});

describe('normalizeSerialNo / normalizeBatchNo', () => {
  it('accepts the 2-20 character serial range', () => {
    expect(normalizeSerialNo('AB')).toBe('AB');
    expect(normalizeSerialNo('A'.repeat(20))).toBe('A'.repeat(20));
  });

  it('rejects serials outside the SFDA range', () => {
    fails(() => normalizeSerialNo('A'), 'invalid_serial');
    fails(() => normalizeSerialNo('A'.repeat(21)), 'invalid_serial');
  });

  it('rejects a batch longer than 20 characters', () => {
    expect(normalizeUnit({ ...unit, batchNo: 'B'.repeat(20) }).batchNo).toHaveLength(20);
    fails(() => normalizeUnit({ ...unit, batchNo: 'B'.repeat(21) }), 'invalid_batch');
  });
});

describe('expiry dates', () => {
  it('resolves GS1 day 00 to the last day of the month', () => {
    expect(normalizeExpiry('2028-02-00')).toBe('2028-02-29');
    expect(normalizeExpiry('2027-11-00')).toBe('2027-11-30');
    expect(normalizeExpiry('2027-01-00')).toBe('2027-01-31');
  });

  it('keeps a real date unchanged', () => {
    expect(normalizeExpiry('2027-05-31')).toBe('2027-05-31');
  });

  it('rejects impossible dates and wrong formats', () => {
    fails(() => normalizeExpiry('2026-02-30'), 'invalid_expiry');
    fails(() => normalizeExpiry('2027-13-01'), 'invalid_expiry');
    fails(() => normalizeExpiry('31/05/2027'), 'invalid_expiry');
  });
});

describe('sale and cancel normalisation', () => {
  it('defaults a direct sale to the configured to-GLN and prescription placeholder', () => {
    const sale = normalizeSaleInput(unit);
    expect(sale.toGln).toBe('0000000000000');
    expect(sale.prescriptionId).toBe('DIRECT-SALE');
    expect(sale.prescriptionDate).toBe(todayIso());
    expect(sale.expiryDate).toBe('2027-05-31');
  });

  it('treats "direct" and a missing to-GLN the same way', () => {
    expect(normalizeSaleInput({ ...unit, toGln: 'direct' }).toGln).toBe(normalizeToGln(undefined));
  });

  it('accepts a 13-digit payer GLN and rejects anything else', () => {
    expect(normalizeSaleInput({ ...unit, toGln: '6286479000015' }).toGln).toBe('6286479000015');
    fails(() => normalizeToGln('62864790000150000'), 'invalid_to_gln');
  });

  it('keeps a real prescription id and date, and local references', () => {
    const sale = normalizeSaleInput({
      ...unit,
      prescriptionId: 'RX-99',
      prescriptionDate: '2026-11-01',
      invoiceId: 'inv-1',
      invoiceNo: 'INV-0001',
      saleLineId: 'line-1',
    });
    expect(sale).toMatchObject({
      prescriptionId: 'RX-99',
      prescriptionDate: '2026-11-01',
      invoiceId: 'inv-1',
      invoiceNo: 'INV-0001',
      saleLineId: 'line-1',
    });
  });

  it('requires a unit on both payloads', () => {
    fails(() => normalizeSaleInput(undefined), 'invalid_request');
    fails(() => normalizeCancelInput(undefined), 'invalid_request');
    fails(() => normalizeUnit(undefined), 'invalid_request');
  });

  it('normalises the prescription date the same way as an expiry', () => {
    expect(normalizePrescriptionDate('2026-11-00')).toBe('2026-11-30');
  });
});
