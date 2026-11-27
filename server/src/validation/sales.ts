// Boundary validation for sale/return SQL mirrors. The local browser record remains authoritative;
// these rules only decide whether a mirror write is safe to apply. Arithmetic is re-derived using
// the same round2 convention as src/utils/vat.ts and src/utils/pricing.ts.

import {
  badRequest,
  date,
  integer,
  money,
  near,
  object,
  oneOf,
  rate,
  round2,
  text,
} from './common.js';

const INVOICE_TYPES = ['simplified', 'standard'] as const;
const ZATCA_STATUSES = [
  'phase2_cleared',
  'phase2_reported',
  'phase1_fallback',
  'pending_submission',
  'submission_failed',
] as const;
const PAYMENT_METHODS = ['cash', 'card', 'insurance', 'points', 'wasfaty', 'other'] as const;
const DISCOUNT_TYPES = ['amount', 'percent'] as const;
const PRESCRIPTION_SOURCES = ['private', 'wasfaty'] as const;

export interface ValidatedSaleLine {
  id: string;
  itemId: string;
  itemNameAr: string;
  itemNameEn: string;
  batchId: string;
  batchNo: string;
  expiryDate: string;
  qty: number;
  unitPrice: number;
  vatRate: number;
  offerLabel?: string;
  manualDiscountType?: string;
  manualDiscountValue?: number;
  discountAmount: number;
  netExclVat: number;
  vatAmount: number;
  totalInclVat: number;
  returnedQty: number;
  controlledStatus?: string;
}

export interface ValidatedSale {
  id: string;
  invoiceNo: string;
  invoiceType: string;
  date: Date;
  customerId?: string;
  customerNameAr?: string;
  customerNameEn?: string;
  lines: ValidatedSaleLine[];
  subtotalExclVat: number;
  totalDiscount: number;
  totalVatAmount: number;
  totalInclVat: number;
  totalIncentive?: number;
  payments: { method: string; amount: number; cardNetwork?: string; insuranceCompany?: string; insuranceApprovalCode?: string }[];
  zatcaQrBase64: string;
  zatcaStatus: string;
  status: string;
  cashierName: string;
  pointsEarned?: number;
  pointsRedeemed?: number;
  pointsEarnedClawedBack?: number;
  pointsRedeemedRefunded?: number;
  prescription?: {
    source: string;
    wasfatyReferenceNo?: string;
    prescriberName: string;
    prescriberId?: string;
    prescriptionId: string;
    prescriptionDate: Date;
    patientNationalId: string;
  };
}

function optionalInt(value: unknown, name: string): number | undefined {
  return value === undefined || value === null || value === ''
    ? undefined
    : integer(value, name, 0, 1_000_000_000);
}

function optionalMoney(value: unknown, name: string): number | undefined {
  return value === undefined || value === null || value === ''
    ? undefined
    : money(value, name);
}

export function validateSaleInput(body: unknown, authenticatedCashier: string): ValidatedSale {
  const b = object(body);
  const id = text(b.id, 'id');
  const invoiceNo = text(b.invoiceNo, 'invoiceNo');
  const invoiceType = oneOf(b.invoiceType, 'invoiceType', INVOICE_TYPES);
  const createdAt = date(b.date, 'date');
  if (!authenticatedCashier) throw badRequest('An authenticated cashier is required.');

  const rawLines = b.lines;
  if (!Array.isArray(rawLines) || rawLines.length === 0 || rawLines.length > 500) {
    throw badRequest('lines must contain between 1 and 500 entries.');
  }
  const lines = rawLines.map((raw, index): ValidatedSaleLine => {
    const l = object(raw);
    const prefix = `lines[${index}]`;
    const qty = integer(l.qty, `${prefix}.qty`, 1, 1_000_000);
    const unitPrice = money(l.unitPrice, `${prefix}.unitPrice`);
    const vatRate = rate(l.vatRate, `${prefix}.vatRate`);
    const discountAmount = money(l.discountAmount, `${prefix}.discountAmount`);
    const gross = round2(qty * unitPrice);
    if (discountAmount > gross + 0.01) throw badRequest(`${prefix}.discountAmount exceeds the line total.`);

    const netExclVat = money(l.netExclVat, `${prefix}.netExclVat`);
    const vatAmount = money(l.vatAmount, `${prefix}.vatAmount`);
    const totalInclVat = money(l.totalInclVat, `${prefix}.totalInclVat`);
    if (!near(netExclVat, round2(gross - discountAmount))) {
      throw badRequest(`${prefix}.netExclVat does not match qty × price − discount.`);
    }
    if (!near(vatAmount, round2(netExclVat * vatRate))) {
      throw badRequest(`${prefix}.vatAmount does not match net × VAT rate.`);
    }
    if (!near(totalInclVat, round2(netExclVat + vatAmount))) {
      throw badRequest(`${prefix}.totalInclVat does not match net + VAT.`);
    }

    const manualDiscountType = l.manualDiscountType
      ? oneOf(l.manualDiscountType, `${prefix}.manualDiscountType`, DISCOUNT_TYPES)
      : undefined;

    return {
      id: text(l.id, `${prefix}.id`),
      itemId: text(l.itemId, `${prefix}.itemId`),
      itemNameAr: text(l.itemNameAr, `${prefix}.itemNameAr`, 100, false),
      itemNameEn: text(l.itemNameEn, `${prefix}.itemNameEn`, 100, false),
      batchId: text(l.batchId, `${prefix}.batchId`, 100, false),
      batchNo: text(l.batchNo, `${prefix}.batchNo`, 100, false),
      expiryDate: text(l.expiryDate, `${prefix}.expiryDate`, 100, false),
      qty,
      unitPrice,
      vatRate,
      offerLabel: l.offerLabel ? text(l.offerLabel, `${prefix}.offerLabel`) : undefined,
      manualDiscountType,
      manualDiscountValue: optionalMoney(l.manualDiscountValue, `${prefix}.manualDiscountValue`),
      discountAmount,
      netExclVat,
      vatAmount,
      totalInclVat,
      returnedQty: integer(l.returnedQty ?? 0, `${prefix}.returnedQty`, 0, 1_000_000),
      controlledStatus: l.controlledStatus ? text(l.controlledStatus, `${prefix}.controlledStatus`) : undefined,
    };
  });

  const subtotalExclVat = money(b.subtotalExclVat, 'subtotalExclVat');
  const totalDiscount = money(b.totalDiscount, 'totalDiscount');
  const totalVatAmount = money(b.totalVatAmount, 'totalVatAmount');
  const totalInclVat = money(b.totalInclVat, 'totalInclVat');
  if (!near(subtotalExclVat, round2(lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0)))) {
    throw badRequest('subtotalExclVat does not match the lines.');
  }
  if (!near(totalDiscount, round2(lines.reduce((sum, l) => sum + l.discountAmount, 0)))) {
    throw badRequest('totalDiscount does not match the lines.');
  }
  if (!near(totalVatAmount, round2(lines.reduce((sum, l) => sum + l.vatAmount, 0)))) {
    throw badRequest('totalVatAmount does not match the lines.');
  }
  if (!near(totalInclVat, round2(lines.reduce((sum, l) => sum + l.totalInclVat, 0)))) {
    throw badRequest('totalInclVat does not match the lines.');
  }

  const rawPayments = b.payments ?? [];
  if (!Array.isArray(rawPayments) || rawPayments.length > 100) {
    throw badRequest('payments must be an array.');
  }
  const payments = rawPayments.map((raw, index) => {
    const p = object(raw);
    const prefix = `payments[${index}]`;
    return {
      method: oneOf(p.method, `${prefix}.method`, PAYMENT_METHODS),
      amount: money(p.amount, `${prefix}.amount`),
      cardNetwork: p.cardNetwork ? text(p.cardNetwork, `${prefix}.cardNetwork`) : undefined,
      insuranceCompany: p.insuranceCompany ? text(p.insuranceCompany, `${prefix}.insuranceCompany`) : undefined,
      insuranceApprovalCode: p.insuranceApprovalCode
        ? text(p.insuranceApprovalCode, `${prefix}.insuranceApprovalCode`)
        : undefined,
    };
  });
  if (!near(payments.reduce((sum, p) => sum + p.amount, 0), totalInclVat, 0.05)) {
    throw badRequest('payments do not add up to the invoice total.');
  }

  const qr = b.zatcaQrBase64;
  if (typeof qr !== 'string' || qr.length > 200_000) throw badRequest('zatcaQrBase64 must be a string.');

  let prescription: ValidatedSale['prescription'];
  if (b.prescription) {
    const p = object(b.prescription);
    prescription = {
      source: oneOf(p.source, 'prescription.source', PRESCRIPTION_SOURCES),
      wasfatyReferenceNo: p.wasfatyReferenceNo ? text(p.wasfatyReferenceNo, 'prescription.wasfatyReferenceNo') : undefined,
      prescriberName: text(p.prescriberName, 'prescription.prescriberName', 100, false),
      prescriberId: p.prescriberId ? text(p.prescriberId, 'prescription.prescriberId') : undefined,
      prescriptionId: text(p.prescriptionId, 'prescription.prescriptionId', 100, false),
      prescriptionDate: date(p.prescriptionDate, 'prescription.prescriptionDate'),
      patientNationalId: text(p.patientNationalId, 'prescription.patientNationalId', 100, false),
    };
  }

  return {
    id,
    invoiceNo,
    invoiceType,
    date: createdAt,
    customerId: b.customerId ? text(b.customerId, 'customerId') : undefined,
    customerNameAr: b.customerNameAr ? text(b.customerNameAr, 'customerNameAr', 100, false) : undefined,
    customerNameEn: b.customerNameEn ? text(b.customerNameEn, 'customerNameEn', 100, false) : undefined,
    lines,
    subtotalExclVat,
    totalDiscount,
    totalVatAmount,
    totalInclVat,
    totalIncentive: optionalMoney(b.totalIncentive, 'totalIncentive'),
    payments,
    zatcaQrBase64: qr,
    zatcaStatus: oneOf(b.zatcaStatus, 'zatcaStatus', ZATCA_STATUSES),
    // A backup creates a completed sale. Return states are only reachable through /returns.
    status: 'completed',
    // SEC-04: identity comes from the verified JWT, never from the request body.
    cashierName: authenticatedCashier,
    pointsEarned: optionalInt(b.pointsEarned, 'pointsEarned'),
    pointsRedeemed: optionalInt(b.pointsRedeemed, 'pointsRedeemed'),
    pointsEarnedClawedBack: optionalInt(b.pointsEarnedClawedBack, 'pointsEarnedClawedBack'),
    pointsRedeemedRefunded: optionalInt(b.pointsRedeemedRefunded, 'pointsRedeemedRefunded'),
    prescription,
  };
}

export interface ValidatedReturnLine {
  saleLineId: string;
  itemNameEn: string;
  qty: number;
  refundAmount: number;
}

export interface ValidatedReturn {
  id: string;
  returnNo: string;
  date: Date;
  originalInvoiceId: string;
  originalInvoiceNo: string;
  lines: ValidatedReturnLine[];
  totalRefund: number;
  reason: string;
  updatedInvoicePointsEarnedClawedBack?: number;
  updatedInvoiceTotalIncentiveClawedBack?: number;
  updatedInvoicePointsRedeemedRefunded?: number;
}

export function validateReturnInput(body: unknown): ValidatedReturn {
  const b = object(body);
  const rawLines = b.lines;
  if (!Array.isArray(rawLines) || rawLines.length === 0 || rawLines.length > 500) {
    throw badRequest('lines must contain between 1 and 500 entries.');
  }
  const lines = rawLines.map((raw, index) => {
    const l = object(raw);
    const prefix = `lines[${index}]`;
    return {
      saleLineId: text(l.saleLineId, `${prefix}.saleLineId`),
      itemNameEn: text(l.itemNameEn, `${prefix}.itemNameEn`, 100, false),
      qty: integer(l.qty, `${prefix}.qty`, 1, 1_000_000),
      refundAmount: money(l.refundAmount, `${prefix}.refundAmount`),
    };
  });
  const totalRefund = money(b.totalRefund, 'totalRefund');
  if (!near(totalRefund, round2(lines.reduce((sum, l) => sum + l.refundAmount, 0)))) {
    throw badRequest('totalRefund does not match the return lines.');
  }
  return {
    id: text(b.id, 'id'),
    returnNo: text(b.returnNo, 'returnNo'),
    date: date(b.date, 'date'),
    originalInvoiceId: text(b.originalInvoiceId, 'originalInvoiceId'),
    originalInvoiceNo: text(b.originalInvoiceNo, 'originalInvoiceNo'),
    lines,
    totalRefund,
    reason: text(b.reason, 'reason', 100, false),
    updatedInvoicePointsEarnedClawedBack: optionalInt(b.updatedInvoicePointsEarnedClawedBack, 'updatedInvoicePointsEarnedClawedBack'),
    updatedInvoiceTotalIncentiveClawedBack: optionalMoney(b.updatedInvoiceTotalIncentiveClawedBack, 'updatedInvoiceTotalIncentiveClawedBack'),
    updatedInvoicePointsRedeemedRefunded: optionalInt(b.updatedInvoicePointsRedeemedRefunded, 'updatedInvoicePointsRedeemedRefunded'),
  };
}
