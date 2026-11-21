// Pre-send validation and normalisation.
//
// SFDA rejects the whole request for small format mistakes (GTIN not 14 digits, serial outside
// 2-20 characters, an invalid xs:date), so these checks run before any SOAP call and throw a
// 400 with the exact field instead of spending an SFDA round-trip on it.
import { badRequest } from './errors.js';
import { getRsdConfig } from './config.js';
import type { RsdCancelInput, RsdSaleInput, RsdUnit } from './types.js';

export interface NormalizedSale extends RsdUnit {
  toGln: string;
  prescriptionId: string;
  prescriptionDate: string;
  doctorId?: string;
  patientNationalId?: string;
  invoiceId?: string;
  invoiceNo?: string;
  saleLineId?: string;
}

export interface NormalizedCancel extends RsdUnit {
  invoiceId?: string;
  invoiceNo?: string;
  saleLineId?: string;
  reason?: string;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw badRequest(`${field} is required.`);
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

// GTIN-13 (the code most Saudi cartons carry as a plain barcode) is the same number as GTIN-14
// with one leading zero, so padding is normalisation, not a change of identity.
export function normalizeGtin(value: unknown): string {
  const raw = text(value, 'GTIN');
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 14) {
    throw badRequest('GTIN must be 8 to 14 digits.', 'invalid_gtin');
  }
  return digits.padStart(14, '0');
}

export function normalizeSerialNo(value: unknown): string {
  const serial = text(value, 'Serial number');
  // SFDA's own limit is 2-20 characters (RC 10602 outside it).
  if (serial.length < 2 || serial.length > 20) {
    throw badRequest('Serial number must be 2 to 20 characters.', 'invalid_serial');
  }
  return serial;
}

export function normalizeBatchNo(value: unknown): string {
  const batch = text(value, 'Batch number');
  if (batch.length > 20) {
    throw badRequest('Batch number must be 20 characters or fewer.', 'invalid_batch');
  }
  return batch;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// GS1 allows day 00 to mean "the last day of the month" (manufacturers print only month/year).
// Passing "2028-11-00" to xs:date is rejected by SFDA with RC 11035, so it is resolved here.
export function normalizeExpiry(value: unknown): string {
  const raw = text(value, 'Expiry date');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) throw badRequest('Expiry date must be formatted YYYY-MM-DD.', 'invalid_expiry');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) throw badRequest('Expiry date has an invalid month.', 'invalid_expiry');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const resolvedDay = day === 0 ? lastDay : day;
  if (resolvedDay < 1 || resolvedDay > lastDay) {
    throw badRequest('Expiry date is not a real calendar date.', 'invalid_expiry');
  }
  return `${year}-${pad2(month)}-${pad2(resolvedDay)}`;
}

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

export function normalizePrescriptionDate(value: unknown): string {
  const raw = optionalText(value);
  if (!raw) return todayIso(); // direct/OTC sales still need a valid PRESCRIPTIONDATE
  return normalizeExpiry(raw);
}

export function normalizeToGln(value: unknown): string {
  const raw = optionalText(value);
  if (!raw || raw.toLowerCase() === 'direct') return getRsdConfig().directToGln;
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 13) {
    throw badRequest('To-GLN must be 13 digits, or "direct" for a patient sale.', 'invalid_to_gln');
  }
  return digits;
}

export function normalizeUnit(input: Partial<RsdUnit> | undefined): RsdUnit {
  if (!input || typeof input !== 'object') throw badRequest('A product is required.');
  return {
    gtin: normalizeGtin(input.gtin),
    serialNo: normalizeSerialNo(input.serialNo),
    batchNo: normalizeBatchNo(input.batchNo),
    expiryDate: normalizeExpiry(input.expiryDate),
  };
}

export function normalizeSaleInput(input: RsdSaleInput | undefined): NormalizedSale {
  if (!input || typeof input !== 'object') throw badRequest('A sale payload is required.');
  const unit = normalizeUnit(input);
  const prescriptionId =
    optionalText(input.prescriptionId) ?? getRsdConfig().directPrescriptionId;
  if (prescriptionId.length > 50) {
    throw badRequest('Prescription id must be 50 characters or fewer.', 'invalid_prescription');
  }
  return {
    ...unit,
    toGln: normalizeToGln(input.toGln),
    prescriptionId,
    prescriptionDate: normalizePrescriptionDate(input.prescriptionDate),
    doctorId: optionalText(input.doctorId),
    patientNationalId: optionalText(input.patientNationalId),
    invoiceId: optionalText(input.invoiceId),
    invoiceNo: optionalText(input.invoiceNo),
    saleLineId: optionalText(input.saleLineId),
  };
}

export function normalizeCancelInput(input: RsdCancelInput | undefined): NormalizedCancel {
  if (!input || typeof input !== 'object') throw badRequest('A cancel payload is required.');
  return {
    ...normalizeUnit(input),
    invoiceId: optionalText(input.invoiceId),
    invoiceNo: optionalText(input.invoiceNo),
    saleLineId: optionalText(input.saleLineId),
    reason: optionalText(input.reason),
  };
}
