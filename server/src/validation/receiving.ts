// Validation for the receiving SQL mirror. A receiving event must be a positive, dated delivery;
// negative quantities silently reversed the stock direction before these checks existed.

import { badRequest, date, integer, money, object, rate, text } from './common.js';

export interface ValidatedReceiving {
  receivingId?: string;
  batchId: string;
  itemId: string;
  itemNameAr: string;
  itemNameEn: string;
  barcode?: string;
  unit?: string;
  category?: string;
  basePrice: number;
  vatRate: number;
  requiresBatchTracking: boolean;
  reorderLevel: number;
  batchNo: string;
  expiryDate: Date | null;
  receivedDate: Date;
  qty: number;
  purchasePrice: number;
  purchaseDiscountPercent: number;
  costPrice: number;
}

function optionalText(value: unknown, name: string, max = 100): string | undefined {
  return value === undefined || value === null || value === '' ? undefined : text(value, name, max);
}

export function validateReceiving(body: unknown): ValidatedReceiving {
  const b = object(body);
  const expiry = b.expiryDate === undefined || b.expiryDate === null || b.expiryDate === ''
    ? null
    : date(b.expiryDate, 'expiryDate');
  return {
    // Older queued payloads have no event id: they are accepted without a dedupe record rather
    // than being dropped (the local browser record is still authoritative).
    receivingId: optionalText(b.receivingId, 'receivingId'),
    batchId: text(b.batchId, 'batchId'),
    itemId: text(b.itemId, 'itemId'),
    itemNameAr: text(b.itemNameAr, 'itemNameAr', 100, false),
    itemNameEn: text(b.itemNameEn, 'itemNameEn', 100, false),
    barcode: optionalText(b.barcode, 'barcode'),
    unit: optionalText(b.unit, 'unit'),
    category: optionalText(b.category, 'category'),
    basePrice: b.basePrice === undefined ? 0 : money(b.basePrice, 'basePrice'),
    vatRate: b.vatRate === undefined ? 0 : rate(b.vatRate, 'vatRate'),
    requiresBatchTracking: b.requiresBatchTracking === undefined ? true : Boolean(b.requiresBatchTracking),
    reorderLevel: b.reorderLevel === undefined ? 0 : integer(b.reorderLevel, 'reorderLevel', 0, 1_000_000),
    batchNo: text(b.batchNo, 'batchNo'),
    expiryDate: expiry,
    receivedDate: date(b.receivedDate, 'receivedDate'),
    qty: integer(b.qty, 'qty', 1, 1_000_000_000),
    purchasePrice: money(b.purchasePrice, 'purchasePrice'),
    purchaseDiscountPercent: rate(b.purchaseDiscountPercent, 'purchaseDiscountPercent'),
    costPrice: money(b.costPrice, 'costPrice'),
  };
}

export interface ValidatedReversal {
  reversalId?: string;
  itemId: string;
  batchNo: string;
  qty: number;
}

export function validateReversal(body: unknown): ValidatedReversal {
  const b = object(body);
  if (b.qty !== undefined && Number(b.qty) < 0) throw badRequest('qty must be positive.');
  return {
    reversalId: optionalText(b.reversalId, 'reversalId'),
    itemId: text(b.itemId, 'itemId'),
    batchNo: text(b.batchNo, 'batchNo'),
    qty: integer(b.qty, 'qty', 1, 1_000_000_000),
  };
}
