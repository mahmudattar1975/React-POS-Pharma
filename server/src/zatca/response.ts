// Turns the gateway's loosely-typed answer into the small closed set of statuses the POS stores.
//
// The previous implementation accepted anything that did not contain the word "reject". That means a
// response with no status, `ERROR`, or an `errors` array was silently recorded as cleared/reported -
// the worst possible failure mode for a tax document: a sale looks compliant when it is not. Fail
// closed instead: only an explicit accepted status with no errors counts as accepted.
import type { SubmitResult } from './client.js';

export type SubmissionOutcomeStatus = 'cleared' | 'reported' | 'accepted_with_warnings' | 'failed';

export interface InterpretedSubmission {
  status: SubmissionOutcomeStatus;
  accepted: boolean;
  reason?: string;
  // For clearance (B2B) submissions ZATCA returns the stamped document. It is the legal copy the
  // buyer receives, so it must be retained alongside the document we sent.
  clearedInvoiceXmlBase64?: string;
}

const ACCEPTED_STATUSES = new Set([
  'CLEARED',
  'REPORTED',
  'ACCEPTED',
  'ACCEPTED_WITH_WARNINGS',
  'SUCCESS',
  'WARNING',
  'PASS',
]);
const REJECTED_STATUSES = ['REJECT', 'REJECTED', 'ERROR', 'FAILED', 'FAILURE', 'INVALID', 'CANCELLED'];

function firstString(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value.trim() || undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['errorMessage', 'errorCategory', 'message', 'error', 'validationResults', 'details']) {
      const found = firstString(record[key], depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

export function interpretSubmitResult(result: SubmitResult, clearance: boolean): InterpretedSubmission {
  const rawStatus = String(result.status ?? '').trim().toUpperCase();
  const errors = result.errors ?? [];
  const warnings = result.warnings ?? [];
  const errorReason = firstString(errors) ?? firstString(result);

  const rejected = REJECTED_STATUSES.some((token) => rawStatus.includes(token));
  if (rejected || errors.length > 0 || !ACCEPTED_STATUSES.has(rawStatus)) {
    return { status: 'failed', accepted: false, reason: errorReason ?? `Unexpected ZATCA status: ${rawStatus || '(missing)'}` };
  }

  const withWarnings = rawStatus.includes('WARNING') || warnings.length > 0;
  if (withWarnings) {
    return { status: 'accepted_with_warnings', accepted: true, reason: firstString(warnings), clearedInvoiceXmlBase64: result.clearedInvoice };
  }
  return {
    status: clearance ? 'cleared' : 'reported',
    accepted: true,
    clearedInvoiceXmlBase64: result.clearedInvoice,
  };
}
