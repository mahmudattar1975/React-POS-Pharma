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
import type { Payment, ReturnHeader, SaleHeader, SaleLine, ZatcaSubmissionStatus } from '../types/sales';
import { PACK_LEVEL_UNIT_CODE } from './packUnits';
import { round2 } from './vat';

// The subset of tender types that ZATCA's UNCL4461 payment means codes can express. Loyalty points
// are not a tender ZATCA knows about, so a points-only sale reports as cash (see server
// zatca/submitSaleInvoice.ts for the code mapping).
export type ZatcaPaymentMethod = 'cash' | 'card' | 'insurance' | 'other';

export interface ZatcaSubmitLine {
  id: string;
  itemNameEn: string;
  qty: number;
  // UN/ECE Rec 20/21 selling unit (XCT carton, XBX box, SR strip, U2 tablet). Undefined means the
  // server keeps its PCE default. Declared here so a retry cannot silently drop a pack-level line.
  unitCode?: string;
  unitPrice: number;
  vatRate: number;
  discountAmount: number;
}

export interface ZatcaSubmitRequest {
  invoiceNo: string;
  invoiceType: SaleHeader['invoiceType'];
  // A return is not a second sales invoice: it is a credit note tied to the original document.
  documentType?: 'invoice' | 'credit_note' | 'debit_note';
  billingReference?: { id: string; uuid?: string; issueDate?: string };
  note?: string;
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
  // ZATCA's raw answer, so a rejection shows the real validation error instead of a generic
  // "rejected" with no way to fix the data.
  zatcaResponse?: unknown;
  reason?: string;
  clearedInvoiceXmlBase64?: string;
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

// Checkout must distinguish "we could not reach the signing server, so this is a Phase 1 QR sale"
// from "the server answered but onboarding/ZATCA is not ready, so the document is pending". An HTTP
// response means the server is up; a network/timeout error means it is not. Keeping this decision
// outside the API layer (which owns `import.meta.env`) makes it unit-testable.
export type ZatcaCheckoutFailure = 'server_unavailable' | 'submission_unavailable';

export function classifyZatcaCheckoutFailure(err: unknown): ZatcaCheckoutFailure {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status >= 400) return 'submission_unavailable';
  const name = (err as { name?: unknown } | null)?.name;
  const message = err instanceof Error ? err.message : String(err);
  if (
    name === 'AbortError' || name === 'TimeoutError' ||
    /fetch failed|network|timeout|timed out|aborted|ECONNREFUSED|ENOTFOUND/i.test(message)
  ) {
    return 'server_unavailable';
  }
  return 'submission_unavailable';
}

// ZATCA's gateways return structured bodies (`errorCategory`, `errorMessage`, `validationResults`,
// `errors`, ...). Show the first useful string from that body in the ledger instead of throwing it
// away and writing "ZATCA rejected the document", which tells the operator nothing they can fix.
function firstUsefulString(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value.trim() || undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstUsefulString(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['reason', 'errorMessage', 'errorCategory', 'message', 'error', 'errors', 'validationResults', 'details']) {
      const found = firstUsefulString(record[key], depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

export function zatcaFailureReason(response: unknown, fallback = 'ZATCA rejected the document'): string {
  return firstUsefulString(response)?.slice(0, 500) ?? fallback;
}

// The subset of a sale that goes into the signed document. Defined structurally (rather than taking
// SaleHeader outright) so checkout can build the request from the numbers it is about to persist,
// and a later retry can build the identical request from the saved sale - one builder, no drift.
export interface ZatcaSubmitSource {
  invoiceNo: string;
  invoiceType: SaleHeader['invoiceType'];
  date: string;
  customerNameAr?: string;
  customerNameEn?: string;
  customerVatNumber?: string;
  lines: Array<Pick<SaleLine, 'id' | 'itemNameEn' | 'qty' | 'packLevel' | 'unitPrice' | 'vatRate' | 'discountAmount' | 'netExclVat'>>;
  payments: Payment[];
}

export function buildSubmitRequest(invoice: ZatcaSubmitSource): ZatcaSubmitRequest {
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

// A refund is a ZATCA credit note: the SAME buyer and line economics as the original sale, but with
// document type 381 and a BillingReference pointing at the original invoice. Re-deriving the line
// amounts from the saved refund (rather than reusing the sale's lines wholesale) keeps partial
// returns accurate: only the returned quantity is documented, with the original VAT rate and the
// same pack-level unit code.
export function buildCreditNoteSubmitRequest(invoice: ZatcaSubmitSource & { zatcaUuid?: string; zatcaStatus?: ZatcaSubmissionStatus }, ret: ReturnHeader): ZatcaSubmitRequest {
  const byId = new Map(invoice.lines.map((l) => [l.id, l]));
  const lines = ret.lines.map((rl) => {
    const original = byId.get(rl.saleLineId);
    if (!original) throw new Error(`Return line ${rl.saleLineId} is not on invoice ${invoice.invoiceNo}.`);
    // The stored refund is VAT-inclusive; the UBL builder needs VAT-exclusive amounts. Taking the
    // original line's share of the return gives exactly the same net + VAT as the refund that was
    // handed to the customer, including when the original line carried a discount.
    const net = round2((rl.qty / original.qty) * original.netExclVat);
    const gross = round2(rl.qty * original.unitPrice);
    return {
      id: rl.saleLineId,
      itemNameEn: rl.itemNameEn || original.itemNameEn,
      qty: rl.qty,
      unitCode: original.packLevel ? PACK_LEVEL_UNIT_CODE[original.packLevel] : undefined,
      unitPrice: original.unitPrice,
      vatRate: original.vatRate,
      discountAmount: round2(Math.max(0, gross - net)),
    };
  });

  // Only reference a UUID that ZATCA actually accepted. A failed Phase 2 attempt also produced a
  // UUID locally, but it is not a document the gateway knows about.
  const accepted = invoice.zatcaStatus === 'phase2_cleared' || invoice.zatcaStatus === 'phase2_reported';
  return {
    invoiceNo: ret.returnNo,
    invoiceType: invoice.invoiceType,
    documentType: 'credit_note',
    billingReference: {
      id: invoice.invoiceNo,
      ...(accepted && invoice.zatcaUuid ? { uuid: invoice.zatcaUuid } : {}),
      issueDate: invoice.date,
    },
    note: ret.reason || `Return against invoice ${invoice.invoiceNo}`,
    date: ret.date,
    customerName: invoice.customerNameEn || invoice.customerNameAr || 'Walk-in Customer',
    customerVatNumber: invoice.invoiceType === 'standard' ? standardCustomerVat(invoice) : undefined,
    lines,
    paymentMethod: primaryPaymentMethod(invoice.payments),
  };
}

// A standard (B2B) invoice is only a valid tax invoice when the buyer's VAT number is on it, so
// the POS stores it on the header. Older invoices predate the field; they are left without one and
// the report flags it rather than inventing a number.
export function standardCustomerVat(invoice: ZatcaSubmitSource): string | undefined {
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

// The subset of ZATCA fields shared by a sale and the credit note that reverses it. Declared once
// so checkout, invoice retry and return retry cannot store different subsets of the same evidence.
export interface ZatcaEvidenceFields {
  zatcaStatus: ZatcaSubmissionStatus;
  zatcaQrBase64?: string;
  zatcaUuid?: string;
  zatcaIcv?: number;
  zatcaInvoiceHashBase64?: string;
  zatcaSubmittedAt?: string;
  zatcaEnvironment?: 'sandbox' | 'simulation' | 'production';
  zatcaFailureReason?: string;
}

// The patch written back onto a SaleHeader/ReturnHeader once a submission attempt comes back - kept
// in one function so checkout and every resubmission button cannot store different subsets.
//
// Two deliberate rules:
//  - a rejected attempt never overwrites the QR: the QR is only meaningful once ZATCA stamped the
//    document, and clearing it would destroy the only evidence a previously accepted document had.
//  - the status is derived from the document's own type, because "cleared" vs "reported" is a
//    property of the invoice, not of how the request happened to be worded.
export function zatcaPatchFromSubmission(
  outcome: ZatcaSubmissionOutcome,
  invoiceType: SaleHeader['invoiceType'],
  submittedAt: string,
): ZatcaEvidenceFields {
  const accepted = outcome.status !== 'failed';
  const patch: ZatcaEvidenceFields = {
    zatcaStatus: statusFromSubmission(outcome, invoiceType),
  };
  if (accepted) {
    // Evidence only moves on acceptance. A failed retry must not clear the UUID/ICV/hash of a
    // document that was already accepted, even if the rejection response omits those fields.
    patch.zatcaUuid = outcome.uuid;
    patch.zatcaIcv = outcome.icv;
    patch.zatcaInvoiceHashBase64 = outcome.invoiceHashBase64;
    patch.zatcaEnvironment = outcome.environment;
    patch.zatcaSubmittedAt = submittedAt;
    patch.zatcaFailureReason = undefined;
    if (outcome.qrBase64) patch.zatcaQrBase64 = outcome.qrBase64;
  } else {
    patch.zatcaFailureReason = zatcaFailureReason(outcome.reason ?? outcome.zatcaResponse);
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

// Persisted sales written before Phase 2 have no `zatcaStatus` at all. The store migration
// back-fills them, but a bad/unknown value can still arrive from an older backup; the ledger and
// the printed documents must degrade to an honest label instead of crashing on `undefined.label`.
const UNKNOWN_STATUS_LABEL: ZatcaStatusLabel = {
  label: 'Status unknown',
  color: 'warning',
  help: 'This older sale has no ZATCA status on record. Check the ZATCA invoices list before relying on it.',
};

export function zatcaStatusLabel(status: ZatcaSubmissionStatus | undefined): ZatcaStatusLabel {
  return (status && ZATCA_STATUS_LABEL[status]) || UNKNOWN_STATUS_LABEL;
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
