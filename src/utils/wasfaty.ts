// Pure Wasfaty / NUPCO helpers - no React, no fetch, no store.
//
// Everything here is deterministic and unit-tested. It covers the three things a Phase 0 build
// must get right without a live NUPCO connection:
//
//   1. MAPPING   - a NUPCO code is 13 digits, belongs to exactly one local item, and a covered
//                  line cannot be sold until the item has one. Immediate duplicate checks, same
//                  philosophy as the Item Master barcode guard.
//   2. COVERAGE  - money model Option A: a covered line's patient share is 0.00, its claim amount
//                  is the line's VAT-inclusive total, and the invoice is settled by a `wasfaty`
//                  tender. Non-covered items in the same basket are paid normally.
//   3. CLAIMS    - one stable row per covered sale line, with the patient ID masked, plus an
//                  exception column that makes missing data visible instead of quietly exporting a
//                  zero.
//
// It deliberately contains NO endpoint paths or NUPCO payload shapes: those are not public, and
// inventing them here is exactly the kind of "accurate-looking but wrong" integration this app is
// avoiding. The server adapter isolates that unknown.
import type { Batch, Item } from '../types/catalog';
import type { SaleHeader, SaleLine } from '../types/sales';
import type {
  WasfatyClaimFilter,
  WasfatyClaimRow,
  WasfatyClaimSummary,
  WasfatyDispenseStatus,
  WasfatyProvider,
  WasfatySession,
} from '../types/wasfaty';

// NUPCO's Wasfaty item list uses 13-digit codes (GS1-style GTIN length). This is a shape check,
// not a claim that every 13-digit number is a NUPCO code - the authoritative list still has to
// come from NUPCO.
export const NUPCO_CODE_RE = /^\d{13}$/;

export function normaliseNupcoCode(value: string): string {
  return value.replace(/[\s-]/g, '');
}

export function isValidNupcoCode(value: string): boolean {
  return NUPCO_CODE_RE.test(normaliseNupcoCode(value));
}

// Normalising before comparing means "5120 1599 0030 0" and "5120159900300" cannot be mapped to
// two different items by accident.
export function nupcoCodeOwner(items: Item[], code: string, editingId?: string): Item | undefined {
  const key = normaliseNupcoCode(code);
  if (!key) return undefined;
  return items.find((i) => i.id !== editingId && i.nupcoCode && normaliseNupcoCode(i.nupcoCode) === key);
}

export function nupcoCodeConflictMessage(items: Item[], code: string, editingId?: string): string | undefined {
  const trimmed = normaliseNupcoCode(code);
  if (!trimmed) return undefined;
  if (!isValidNupcoCode(trimmed)) return 'A NUPCO code is 13 digits.';
  const owner = nupcoCodeOwner(items, trimmed, editingId);
  return owner
    ? `Already mapped to ${owner.nameEn} (${owner.itemNo ?? owner.id}). One NUPCO code can only belong to one item.`
    : undefined;
}

// Patient IDs are sensitive personal data under PDPL. Lists, exports and receipts show only the
// last four digits; the full value stays on the dispense screen behind the pharmacist role.
export function maskNationalId(value: string | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length <= 4) return `••••${digits}`;
  return `${'•'.repeat(Math.min(6, digits.length - 4))}${digits.slice(-4)}`;
}

export function nationalIdLast4(value: string | undefined): string {
  return (value ?? '').replace(/\D/g, '').slice(-4);
}

export function isWasfatyCoveredItem(item: Pick<Item, 'nupcoCode' | 'wasfatyEligible'> | undefined): boolean {
  if (!item) return false;
  // An explicit "not on the approved list" wins: a stale code must not silently cover an item the
  // owner has taken off the list.
  if (item.wasfatyEligible === false) return false;
  return !!item.nupcoCode || item.wasfatyEligible === true;
}

// The price Option A invoices for a covered line: the NUPCO-approved price when one is recorded,
// otherwise the normal sale price (which is then treated as the approved price for the claim).
export function wasfatyUnitPrice(item: Pick<Item, 'wasfatyPrice'> | undefined, fallback: number): number {
  return item?.wasfatyPrice !== undefined && Number.isFinite(item.wasfatyPrice)
    ? item.wasfatyPrice
    : fallback;
}

export interface WasfatySessionErrors {
  patientNationalId?: string;
  prescriptionNo?: string;
  prescriberName?: string;
  prescriptionDate?: string;
  authorizationNo?: string;
}

export function validateWasfatySession(session: Partial<WasfatySession>): WasfatySessionErrors {
  const errors: WasfatySessionErrors = {};
  if (!/^\d{10}$/.test((session.patientNationalId ?? '').trim())) {
    errors.patientNationalId = 'Enter the patient national ID / Iqama (10 digits).';
  }
  if (!(session.prescriptionNo ?? '').trim()) {
    errors.prescriptionNo = 'Enter the prescription number from the patient’s Wasfaty message.';
  }
  if (!(session.prescriberName ?? '').trim()) {
    errors.prescriberName = 'Enter the prescriber name.';
  }
  if (!(session.prescriptionDate ?? '').trim()) {
    errors.prescriptionDate = 'Enter the prescription date.';
  }
  if (session.authorizationNo && session.authorizationNo.trim() && !/^[A-Za-z0-9._/-]{4,40}$/.test(session.authorizationNo.trim())) {
    errors.authorizationNo = 'Use 4-40 letters, digits, dots, dashes, slashes or underscores.';
  }
  return errors;
}

export function hasWasfatySessionErrors(errors: WasfatySessionErrors): boolean {
  return Object.keys(errors).length > 0;
}

// The total the patient actually owes after the Wasfaty coverage tender. Covered lines are exactly
// the lines flagged on the sale; a non-covered line in the same basket is paid normally.
export function wasfatyCoveredTotal(lines: Pick<SaleLine, 'claimAmount' | 'nupcoCode'>[]): number {
  return round2(
    lines
      .filter((l) => l.nupcoCode !== undefined || l.claimAmount !== undefined)
      .reduce((sum, l) => sum + (l.claimAmount ?? 0), 0),
  );
}

export function wasfatyPatientShare(lines: Pick<SaleLine, 'patientShare' | 'nupcoCode'>[]): number {
  return round2(
    lines
      .filter((l) => l.nupcoCode !== undefined || l.patientShare !== undefined)
      .reduce((sum, l) => sum + (l.patientShare ?? 0), 0),
  );
}

export function claimMonthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function claimMonths(invoices: SaleHeader[]): string[] {
  return Array.from(
    new Set(
      invoices
        .filter((inv) => inv.channel === 'wasfaty' || !!inv.wasfaty)
        .map((inv) => claimMonthOf(inv.date))
        .filter((month) => /^\d{4}-\d{2}$/.test(month)),
    ),
  ).sort((a, b) => b.localeCompare(a));
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isCoveredSaleLine(line: SaleLine): boolean {
  return line.nupcoCode !== undefined || line.claimAmount !== undefined || line.patientShare !== undefined;
}

// Build the stable claim-export rows (Appendix B of Wasfaty.md). The sale is the source: an item
// master edit after the sale must never change a row, and a missing value is exported as an
// exception rather than silently replaced with today's price or a blank code.
export function buildWasfatyClaimRows(
  invoices: SaleHeader[],
  filter: WasfatyClaimFilter = {},
): WasfatyClaimRow[] {
  const rows: WasfatyClaimRow[] = [];
  for (const invoice of invoices) {
    if (invoice.channel !== 'wasfaty' && !invoice.wasfaty) continue;
    if (filter.month && claimMonthOf(invoice.date) !== filter.month) continue;
    if (filter.branchId && invoice.costCenterId !== filter.branchId) continue;

    const covered = invoice.lines.filter(isCoveredSaleLine);
    for (const line of covered) {
      const exceptions: string[] = [];
      if (!line.nupcoCode) exceptions.push('Unmapped item');
      if (!(invoice.wasfaty?.authorizationNo ?? '').trim()) exceptions.push('Missing authorization');
      if (line.nupcoUnitPrice !== undefined && Math.abs(line.nupcoUnitPrice - line.unitPrice) > 0.005) {
        exceptions.push('Price variance');
      }
      if (line.qty <= 0) exceptions.push('Zero quantity');
      if ((line.claimAmount ?? 0) <= 0) exceptions.push('Zero claim');

      rows.push({
        invoiceNo: invoice.invoiceNo,
        invoiceDate: invoice.date,
        branchId: invoice.costCenterId,
        branchName:
          (invoice.costCenterId ? filter.branchNames?.[invoice.costCenterId] : undefined) ??
          invoice.costCenterId ??
          'Unassigned',
        channel: 'wasfaty',
        prescriptionNo: invoice.wasfaty?.prescriptionNo ?? invoice.prescription?.prescriptionId ?? '',
        authorizationNo: invoice.wasfaty?.authorizationNo ?? '',
        dispenseId: invoice.wasfaty?.dispenseId ?? '',
        patientIdMasked: maskNationalId(
          invoice.wasfaty?.patientNationalId ?? invoice.prescription?.patientNationalId,
        ),
        nupcoCode: line.nupcoCode ?? '',
        itemNameEn: line.itemNameEn,
        itemNameAr: line.itemNameAr,
        batchNo: line.batchNo,
        expiryDate: line.expiryDate,
        qty: line.qty,
        unit: line.unit ?? '',
        nupcoUnitPrice: line.nupcoUnitPrice ?? 0,
        lineTotal: line.totalInclVat,
        patientShare: line.patientShare ?? 0,
        claimAmount: line.claimAmount ?? 0,
        pharmacist: invoice.wasfaty?.pharmacistId ?? invoice.cashierName,
        status: invoice.wasfaty?.status ?? 'manual_recorded',
        exception: exceptions.join('; '),
      });
    }
  }
  return rows;
}

export function summariseWasfatyClaims(rows: WasfatyClaimRow[]): WasfatyClaimSummary {
  const byException: Record<string, number> = {};
  for (const row of rows) {
    if (!row.exception) continue;
    for (const reason of row.exception.split('; ').filter(Boolean)) {
      byException[reason] = (byException[reason] ?? 0) + 1;
    }
  }
  return {
    rows: rows.length,
    invoices: new Set(rows.map((row) => row.invoiceNo)).size,
    claimAmount: round2(rows.reduce((sum, row) => sum + row.claimAmount, 0)),
    patientShare: round2(rows.reduce((sum, row) => sum + row.patientShare, 0)),
    lineTotal: round2(rows.reduce((sum, row) => sum + row.lineTotal, 0)),
    exceptions: rows.filter((row) => row.exception).length,
    byException,
  };
}

export const WASFATY_CLAIM_COLUMNS = [
  'Invoice No',
  'Invoice Date',
  'Branch',
  'Channel',
  'Prescription No',
  'Authorization No',
  'NUPCO Dispense ID',
  'Patient ID (masked)',
  'NUPCO Code',
  'Item Name EN',
  'Item Name AR',
  'Batch',
  'Expiry',
  'Qty',
  'Unit',
  'NUPCO Unit Price',
  'Line Total',
  'Patient Share',
  'Claim Amount',
  'Pharmacist',
  'Status',
  'Exception',
] as const;

export interface WasfatyClaimItemSummary {
  nupcoCode: string;
  itemNameEn: string;
  itemNameAr: string;
  lines: number;
  qty: number;
  lineTotal: number;
  patientShare: number;
  claimAmount: number;
}

// Totals by item for the Excel report and the printed summary. Sorted by claim value so the
// biggest lines are visible first; the key falls back to the item name when a code is missing so
// an unmapped item is still one row rather than one per line.
export function summariseWasfatyClaimsByItem(rows: WasfatyClaimRow[]): WasfatyClaimItemSummary[] {
  const byItem = new Map<string, WasfatyClaimItemSummary>();
  for (const row of rows) {
    const key = row.nupcoCode || `name:${row.itemNameEn}`;
    const entry = byItem.get(key);
    if (entry) {
      entry.lines += 1;
      entry.qty += row.qty;
      entry.lineTotal = round2(entry.lineTotal + row.lineTotal);
      entry.patientShare = round2(entry.patientShare + row.patientShare);
      entry.claimAmount = round2(entry.claimAmount + row.claimAmount);
    } else {
      byItem.set(key, {
        nupcoCode: row.nupcoCode,
        itemNameEn: row.itemNameEn,
        itemNameAr: row.itemNameAr,
        lines: 1,
        qty: row.qty,
        lineTotal: row.lineTotal,
        patientShare: row.patientShare,
        claimAmount: row.claimAmount,
      });
    }
  }
  return [...byItem.values()].sort(
    (a, b) => b.claimAmount - a.claimAmount || a.itemNameEn.localeCompare(b.itemNameEn),
  );
}

// The same rows as claimsToCsv, but with real numbers instead of fixed-decimal strings. This is
// what the Excel export uses, so totals and money columns stay numeric and sortable in the sheet.
export function claimsToAoa(rows: WasfatyClaimRow[]): (string | number)[][] {
  return [
    [...WASFATY_CLAIM_COLUMNS],
    ...rows.map((row) => [
      row.invoiceNo,
      row.invoiceDate,
      row.branchName,
      'Wasfaty',
      row.prescriptionNo,
      row.authorizationNo,
      row.dispenseId,
      row.patientIdMasked,
      row.nupcoCode,
      row.itemNameEn,
      row.itemNameAr,
      row.batchNo,
      row.expiryDate,
      row.qty,
      row.unit,
      row.nupcoUnitPrice,
      row.lineTotal,
      row.patientShare,
      row.claimAmount,
      row.pharmacist,
      row.status,
      row.exception,
    ]),
  ];
}

function csvCell(value: string | number | undefined): string {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function claimRowValues(row: WasfatyClaimRow): (string | number)[] {
  return [
    row.invoiceNo,
    row.invoiceDate,
    row.branchName,
    'Wasfaty',
    row.prescriptionNo,
    row.authorizationNo,
    row.dispenseId,
    row.patientIdMasked,
    row.nupcoCode,
    row.itemNameEn,
    row.itemNameAr,
    row.batchNo,
    row.expiryDate,
    row.qty,
    row.unit,
    row.nupcoUnitPrice.toFixed(2),
    row.lineTotal.toFixed(2),
    row.patientShare.toFixed(2),
    row.claimAmount.toFixed(2),
    row.pharmacist,
    row.status,
    row.exception,
  ];
}

export function claimsToCsv(rows: WasfatyClaimRow[]): string {
  const lines = [
    WASFATY_CLAIM_COLUMNS.map(csvCell).join(','),
    ...rows.map((row) => claimRowValues(row).map(csvCell).join(',')),
  ];
  return lines.join('\r\n');
}

export const WASFATY_PROVIDER_LABEL: Record<WasfatyProvider, { en: string; ar: string }> = {
  manual: { en: 'Manual record', ar: 'تسجيل يدوي' },
  mock: { en: 'NUPCO simulator', ar: 'محاكي نوبكو' },
  direct: { en: 'NUPCO direct', ar: 'نوبكو مباشر' },
  hub: { en: 'Approved hub', ar: 'وسيط معتمد' },
};

export const WASFATY_STATUS_LABEL: Record<WasfatyDispenseStatus, { en: string; ar: string }> = {
  manual_recorded: { en: 'Manual record', ar: 'تسجيل يدوي' },
  authorization_pending: { en: 'Authorization pending', ar: 'بانتظار التفويض' },
  authorized: { en: 'Authorized', ar: 'مفوّض' },
  partially_authorized: { en: 'Partially authorized', ar: 'مفوّض جزئياً' },
  rejected: { en: 'Rejected', ar: 'مرفوض' },
  dispensed: { en: 'Dispensed', ar: 'مصروف' },
  cancelled: { en: 'Cancelled', ar: 'ملغى' },
  claim_pending: { en: 'Claim pending', ar: 'مطالبة معلقة' },
  claimed: { en: 'Claimed', ar: 'تمت المطالبة' },
  reconciled: { en: 'Reconciled', ar: 'تمت المطابقة' },
};

// A small, explicit coverage check used by the POS guard. A line flagged Wasfaty with no code is
// an error the cashier must fix (Inventory -> Wasfaty mapping), not a line to quietly charge the
// patient for.
export function unmappedWasfatyLines(
  lines: { wasfaty?: boolean; nupcoCode?: string; itemNameEn: string }[],
): string[] {
  return lines
    .filter((line) => line.wasfaty && !line.nupcoCode)
    .map((line) => line.itemNameEn);
}

// Handy for the mapping screen: what share of the active catalogue can currently be dispensed.
export function wasfatyCoverage(items: Pick<Item, 'isActive' | 'nupcoCode' | 'wasfatyEligible'>[]): {
  total: number;
  mapped: number;
  eligible: number;
  unmappedEligible: number;
  percent: number;
} {
  const active = items.filter((item) => item.isActive !== false);
  const mapped = active.filter((item) => !!item.nupcoCode);
  const eligible = active.filter((item) => isWasfatyCoveredItem(item));
  const unmappedEligible = eligible.filter((item) => !item.nupcoCode);
  return {
    total: active.length,
    mapped: mapped.length,
    eligible: eligible.length,
    unmappedEligible: unmappedEligible.length,
    percent: active.length === 0 ? 0 : Math.round((mapped.length / active.length) * 100),
  };
}

// Used by the POS to price a covered line at the NUPCO-approved price. The batch's ERP sale-price
// override is intentionally ignored for this path: Option A invoices the approved Wasfaty price,
// and a stale ERP override is exactly what would make the claim disagree with the invoice.
export function wasfatyPricingItem(item: Item, covered: boolean): Item {
  if (!covered || item.wasfatyPrice === undefined) return item;
  return { ...item, basePrice: item.wasfatyPrice };
}

export function wasfatyPricingBatch(batch: Batch, covered: boolean, item: Item): Batch {
  if (!covered || item.wasfatyPrice === undefined) return batch;
  return { ...batch, salePriceOverride: undefined };
}
