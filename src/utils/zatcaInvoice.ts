// Pure ZATCA / Fatoora Phase 2 helpers for a SALES invoice - no fetch, no React, no store.
//
// Why this module exists: the Phase 2 lifecycle (build request -> submit -> keep the evidence ->
// reprint or resubmit later) used to live inline in POSPage's checkout handler, which made the
// "what exactly did we send, and what came back" question unanswerable after the fact. Anything
// here is deterministic and unit-tested; the network call itself stays in api/zatcaApi.ts.
//
// Vocabulary: ZATCA documents the two invoice classes as
//   standard   = B2B, cleared BY ZATCA before it may be shared with the buyer
//   simplified = B2C, reported to ZATCA within 24 hours of issue
// and the two submission outcomes are `cleared` and `reported` accordingly. `accepted_with_warnings`
// is a successful submission with advisories, so it is mapped to whichever of those two matches the
// document's own type rather than being treated as a failure.
import type { Payment, SaleHeader, ZatcaSubmissionStatus } from '../types/sales';
import { PACK_LEVEL_UNIT_CODE } from './packUnits';

// The subset of tender types that ZATCA's UNCL4461 payment means codes can express. Loyalty points
// are not a tender ZATCA knows about, so a points-only sale reports as cash (see server
// zatca/submitSaleInvoice.ts for the code mapping).
export type ZatcaPaymentMethod = 'cash' | 'card' | 'insurance' | 'other';

export interface ZatcaSubmitLine {
  id: string;
  itemNameEn: string;
  qty: number;
  unitPrice: number;
  vatRate: number;
  discountAmount: number;
}

export interface ZatcaSubmitRequest {
  invoiceNo: string;
  invoiceType: SaleHeader['invoiceType'];
  date: string;
  customerName: string;
  customerVatNumber?: string;
  lines: ZatcaSubmitLine[];
  paymentMethod: ZatcaPaymentMethod;
}

// The fields of api/zatcaApi.ts's SubmitInvoiceResult that decide what gets stored on the sale.
// Declared structurally here so this module never imports the API layer (and its `import.meta.env`).
export interface ZatcaSubmissionOutcome {
  status: 'cleared' | 'reported' | 'accepted_with_warnings' | 'failed';
  qrBase64?: string;
  invoiceHashBase64?: string;
  uuid?: string;
  icv?: number;
  environment?: 'sandbox' | 'simulation' | 'production';
}

// The tender to report when a sale was split across methods: the largest NON-points payment, since
// the points row is a discount-like settlement, not money handed over. Mirrors what the POS has
// always done, now in one place so a resubmission cannot drift from the original report.
//
// Wasfaty coverage is reported as ZATCA's UNCL4461 "instrument not defined" (other): ZATCA has no
// dedicated government-coverage means, and the invoice is still a normal tax document at the
// NUPCO-approved value. It is deliberately not hidden like points - it is real settlement.
export function primaryPaymentMethod(payments: Payment[]): ZatcaPaymentMethod {
  const reportable = payments
    .filter((p) => p.method !== 'points')
    .map((p) => ({ amount: p.amount, method: (p.method === 'wasfaty' ? 'other' : p.method) as ZatcaPaymentMethod }));
  if (reportable.length === 0) return 'cash';
  return reportable.reduce((largest, p) => (p.amount > largest.amount ? p : largest), reportable[0]).method;
}

// Build the exact request the server signs, from a SAVED sale. Used both at checkout (from the same
// numbers that are about to be written) and later by the resubmission button, which is the point:
// a retry must send the document that was actually issued, not one recomputed from today's prices.
export function buildSubmitRequest(invoice: SaleHeader): ZatcaSubmitRequest {
  return {
    invoiceNo: invoice.invoiceNo,
    invoiceType: invoice.invoiceType,
    date: invoice.date,
    customerName: invoice.customerNameEn || invoice.customerNameAr || 'Walk-in Customer',
    customerVatNumber: invoice.invoiceType === 'standard' ? standardCustomerVat(invoice) : undefined,
    lines: invoice.lines.map((l) => ({
      id: l.id,
      itemNameEn: l.itemNameEn,
      qty: l.qty,
      unitCode: l.packLevel ? PACK_LEVEL_UNIT_CODE[l.packLevel] : undefined,
      unitPrice: l.unitPrice,
      vatRate: l.vatRate,
      discountAmount: l.discountAmount,
    })),
    paymentMethod: primaryPaymentMethod(invoice.payments),
  };
}

// A standard (B2B) invoice is only a valid tax invoice when the buyer's VAT number is on it, so
// the POS stores it on the header. Older invoices predate the field; they are left without one and
// the report flags it rather than inventing a number.
export function standardCustomerVat(invoice: SaleHeader): string | undefined {
  return invoice.customerVatNumber || undefined;
}
// Map the server's answer onto the sale's stored status. `failed` is the only status that says the
// document itself was rejected; every transport/onboarding problem is caught by the caller and
// recorded as 'pending_submission' with a reason instead.
export function statusFromSubmission(
  outcome: Pick<ZatcaSubmissionOutcome, 'status'>,
  invoiceType: SaleHeader['invoiceType'],
): ZatcaSubmissionStatus {
  switch (outcome.status) {
    case 'cleared':
      return 'phase2_cleared';
    case 'reported':
      return 'phase2_reported';
    case 'accepted_with_warnings':
      return invoiceType === 'standard' ? 'phase2_cleared' : 'phase2_reported';
    case 'failed':
    default:
      return 'submission_failed';
  }
}

// The patch written back onto a SaleHeader once a submission attempt comes back - kept in one
// function so checkout and the resubmission button cannot store different subsets of the evidence.
//
// Two deliberate rules:
//  - a rejected attempt never overwrites the QR: the QR is only meaningful once ZATCA stamped the
//    document, and clearing it would destroy the only evidence a previously accepted invoice had.
//  - the status is derived from the document's own type, because "cleared" vs "reported" is a
//    property of the invoice, not of how the request happened to be worded.
export function zatcaPatchFromSubmission(
  outcome: ZatcaSubmissionOutcome,
  invoiceType: SaleHeader['invoiceType'],
  submittedAt: string,
): Partial<SaleHeader> {
  const accepted = outcome.status !== 'failed';
  const patch: Partial<SaleHeader> = {
    zatcaStatus: statusFromSubmission(outcome, invoiceType),
    zatcaUuid: outcome.uuid,
    zatcaIcv: outcome.icv,
    zatcaInvoiceHashBase64: outcome.invoiceHashBase64,
    zatcaEnvironment: outcome.environment,
    zatcaFailureReason: accepted ? undefined : 'ZATCA rejected the document',
  };
  if (accepted) {
    patch.zatcaSubmittedAt = submittedAt;
    if (outcome.qrBase64) patch.zatcaQrBase64 = outcome.qrBase64;
  }
  return patch;
}

// Invoices the Sales invoices tab can still fix by pressing one button: never submitted, or attempted
// and not accepted. A `submission_failed` invoice is included on purpose - most failures are
// transient (ICV/CSID/onboarding) and retrying costs nothing, while a permanently wrong document
// keeps failing and stays visible.
export function needsResubmission(invoice: Pick<SaleHeader, 'zatcaStatus'>): boolean {
  return (
    invoice.zatcaStatus === 'phase1_fallback' ||
    invoice.zatcaStatus === 'pending_submission' ||
    invoice.zatcaStatus === 'submission_failed'
  );
}

export interface ZatcaStatusLabel {
  label: string;
  color: 'success' | 'info' | 'warning' | 'error';
  // One sentence for the Sales invoices tab: what this state MEANS for the business, not just a tag.
  help: string;
}

export const ZATCA_STATUS_LABEL: Record<ZatcaSubmissionStatus, ZatcaStatusLabel> = {
  phase2_cleared: {
    label: 'Cleared',
    color: 'success',
    help: 'Standard invoice cleared by ZATCA before issue - safe to hand to the buyer.',
  },
  phase2_reported: {
    label: 'Reported',
    color: 'success',
    help: 'Simplified invoice cryptographically stamped and reported to ZATCA.',
  },
  phase1_fallback: {
    label: 'Phase 1 only',
    color: 'warning',
    help: 'Sold while the ZATCA server was unavailable - carries the 5-field QR and still needs submitting.',
  },
  pending_submission: {
    label: 'Not submitted',
    color: 'warning',
    help: 'A submission was attempted and not accepted (onboarding/infrastructure). Retry once it is fixed.',
  },
  submission_failed: {
    label: 'Rejected',
    color: 'error',
    help: 'ZATCA rejected this document. Check the reason before retrying - a rejection is usually a data problem.',
  },
};

// Single lookup point for every surface: the till receipt, the sales-invoice table and the printed
// A4 document. A future status is described once here, so those three cannot drift apart.
export function zatcaStatusLabel(status: ZatcaSubmissionStatus): ZatcaStatusLabel {
  return ZATCA_STATUS_LABEL[status];
}

// A resubmission can fail because the signing server was unreachable (a retryable infrastructure
// problem) or because it answered but would not accept the document. api/zatcaApi.ts throws plain
// Errors carrying the server's message, so classification is by message and deliberately
// conservative: only an unmistakable transport/offline message is called 'server_unavailable'.
// Everything else stays in the ordinary 'submission_error' bucket with its reason on the row.
export type ZatcaCheckoutFailureKind = 'server_unavailable' | 'submission_error';

const SERVER_UNAVAILABLE_MESSAGE =
  /(?:not|isn't|is not) reachable|unreachable|fetch failed|failed to fetch|network|timeout|timed out|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|server unavailable/i;

export function classifyZatcaCheckoutFailure(err: unknown): ZatcaCheckoutFailureKind {
  const message = err instanceof Error ? err.message : String(err);
  return SERVER_UNAVAILABLE_MESSAGE.test(message) ? 'server_unavailable' : 'submission_error';
}

export interface ZatcaSummary {
  total: number;
  cleared: number;
  reported: number;
  needsSubmission: number;
  failed: number;
}

// Counts for the page header. Deliberately counts DOCUMENTS, not money: an invoice that needs
// resubmitting is a compliance gap whether it was 5 SAR or 500.
export function zatcaSummary(invoices: Array<Pick<SaleHeader, 'zatcaStatus'>>): ZatcaSummary {
  const summary: ZatcaSummary = { total: invoices.length, cleared: 0, reported: 0, needsSubmission: 0, failed: 0 };
  for (const inv of invoices) {
    if (inv.zatcaStatus === 'phase2_cleared') summary.cleared += 1;
    else if (inv.zatcaStatus === 'phase2_reported') summary.reported += 1;
    else if (inv.zatcaStatus === 'submission_failed') summary.failed += 1;
    else summary.needsSubmission += 1;
  }
  return summary;
}

// ZATCA UUIDs are long; the table shows a short, copy-safe prefix (the full value is in the tooltip
// and on the printed invoice). Never truncate to something that could collide in a screenshot.
export function shortUuid(uuid: string | undefined): string {
  if (!uuid) return '—';
  return uuid.length <= 13 ? uuid : `${uuid.slice(0, 8)}…${uuid.slice(-4)}`;
}
