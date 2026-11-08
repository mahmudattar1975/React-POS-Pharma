// Wasfaty domain service: validation, idempotency and the claim ledger.
//
// The rules here are the server-side half of the money model Option A:
//   * a covered line's patient share is 0.00 and its claim amount is the VAT-inclusive line total;
//   * the claim total must equal the sum of the line claim amounts (the server refuses an
//     inconsistent client rather than filing a wrong claim);
//   * the claim can never exceed the tax invoice it settles;
//   * replaying the same sale id returns the SAME dispense/claim (retry-safe), never a duplicate.
//
// No price or claim is ever recomputed from a catalogue: the invoice is the source of truth, so a
// later NUPCO price change cannot rewrite a filed claim.
import {
  claimForDispense,
  findClaim,
  findDispense,
  findDispenseBySale,
  mutateState,
  nextClaimId,
  nextDispenseId,
  readOnlyState,
} from './store.js';
import { describeProvider, resolveProvider } from './providers.js';
import { badRequest, notFound, unavailable } from './errors.js';
import type {
  WasfatyAuthorizationResult,
  WasfatyClaim,
  WasfatyClaimStatus,
  WasfatyDispenseRecord,
  WasfatyHealth,
  WasfatyManualDispenseInput,
  WasfatyPrescription,
  WasfatySession,
} from './types.js';

const NUPCO_CODE = /^\d{13}$/;

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function finiteNonNegative(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw badRequest(`${field} must be a number of 0 or more.`);
  }
  return parsed;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw badRequest(`${field} is required.`);
  return value.trim();
}

export function validateSession(session: WasfatySession | undefined): WasfatySession {
  if (!session || typeof session !== 'object') throw badRequest('A Wasfaty session is required.');
  const patientNationalId = requireText(session.patientNationalId, 'Patient national ID').replace(/\D/g, '');
  if (!/^\d{10}$/.test(patientNationalId)) {
    throw badRequest('Patient national ID / Iqama must be exactly 10 digits.');
  }
  const prescriptionNo = requireText(session.prescriptionNo, 'Prescription number');
  if (!/^[A-Za-z0-9._/-]{4,40}$/.test(prescriptionNo)) {
    throw badRequest('Prescription number must be 4-40 letters, digits, dots, dashes, slashes or underscores.');
  }
  if (session.authorizationNo && !/^[A-Za-z0-9._/-]{4,40}$/.test(session.authorizationNo.trim())) {
    throw badRequest('Authorization number must be 4-40 letters, digits, dots, dashes, slashes or underscores.');
  }
  return {
    ...session,
    patientNationalId,
    prescriptionNo,
    prescriberName: requireText(session.prescriberName, 'Prescriber name'),
    prescriptionDate: requireText(session.prescriptionDate, 'Prescription date'),
    wasfatyReferenceNo: session.wasfatyReferenceNo?.trim() || undefined,
    authorizationNo: session.authorizationNo?.trim() || undefined,
    prescriberId: session.prescriberId?.trim() || undefined,
    pharmacistId: session.pharmacistId?.trim() || undefined,
  };
}

function validateDispenseInput(input: WasfatyManualDispenseInput) {
  if (!input || typeof input !== 'object') throw badRequest('A dispense payload is required.');
  const saleId = requireText(input.saleId, 'Sale id');
  const invoiceNo = requireText(input.invoiceNo, 'Invoice number');
  const currency = requireText(input.currency, 'Currency');
  const session = validateSession(input.session);
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw badRequest('A Wasfaty dispense needs at least one covered line.');
  }

  const lines = input.lines.map((line, index) => {
    const label = `Line ${index + 1}`;
    const nupcoCode = requireText(line.nupcoCode, `${label} NUPCO code`).replace(/[\s-]/g, '');
    if (!NUPCO_CODE.test(nupcoCode)) throw badRequest(`${label} NUPCO code must be 13 digits.`);
    const qty = finiteNonNegative(line.qty, `${label} quantity`);
    if (qty <= 0) throw badRequest(`${label} quantity must be greater than zero.`);
    return {
      ...line,
      lineId: requireText(line.lineId, `${label} line id`),
      itemId: requireText(line.itemId, `${label} item id`),
      itemNameEn: requireText(line.itemNameEn, `${label} item name`),
      nupcoCode,
      qty,
      nupcoUnitPrice: finiteNonNegative(line.nupcoUnitPrice, `${label} NUPCO unit price`),
      patientShare: finiteNonNegative(line.patientShare, `${label} patient share`),
      claimAmount: finiteNonNegative(line.claimAmount, `${label} claim amount`),
    };
  });

  const lineTotal = round2(lines.reduce((sum, line) => sum + line.claimAmount, 0));
  const claimTotal = finiteNonNegative(input.claimTotal, 'Claim total');
  if (Math.abs(lineTotal - claimTotal) > 0.01) {
    throw badRequest(
      `Claim total ${claimTotal.toFixed(2)} does not equal the sum of line claim amounts ${lineTotal.toFixed(2)}.`,
    );
  }
  if (claimTotal <= 0) throw badRequest('A Wasfaty dispense must claim a positive amount.');
  const invoiceTotal = finiteNonNegative(input.invoiceTotalInclVat, 'Invoice total');
  if (claimTotal - invoiceTotal > 0.01) {
    throw badRequest('The Wasfaty claim cannot exceed the tax invoice it settles.');
  }

  return { saleId, invoiceNo, currency, session, lines, claimTotal, invoiceTotal };
}

export async function createDispense(
  raw: WasfatyManualDispenseInput,
): Promise<{ dispense: WasfatyDispenseRecord; claim: WasfatyClaim }> {
  const input = validateDispenseInput(raw);
  const { provider } = await resolveProvider();

  return mutateState(async (state) => {
    // Retry-safe: the POS can re-POST the same sale after a timeout without creating a second
    // dispense or a second claim.
    const existing = findDispenseBySale(state, input.saleId);
    if (existing) {
      const claim = claimForDispense(state, existing.id);
      if (!claim) throw new Error(`Dispense ${existing.id} exists without a claim row.`);
      return { dispense: existing, claim };
    }

    const now = new Date().toISOString();
    const record: WasfatyDispenseRecord = {
      id: nextDispenseId(state),
      provider: provider.id,
      status: 'authorization_pending',
      saleId: input.saleId,
      invoiceNo: input.invoiceNo,
      prescriptionNo: input.session.prescriptionNo,
      wasfatyReferenceNo: input.session.wasfatyReferenceNo,
      authorizationNo: input.session.authorizationNo,
      patientIdLast4: input.session.patientNationalId.slice(-4),
      pharmacistId: input.session.pharmacistId,
      submittedAt: now,
      totalClaimAmount: input.claimTotal,
      totalPatientShare: round2(input.lines.reduce((sum, line) => sum + line.patientShare, 0)),
      lines: input.lines,
      createdAt: now,
      updatedAt: now,
    };

    // On a provider failure nothing is committed: the POS keeps the sale and queues a retry, and
    // the retry re-enters this function with the same sale id. Committing a half-record here would
    // make that retry look idempotent and suppress the real submission.
    const result = await provider.submitDispense(record);

    record.status = result.status;
    record.nupcoPrescriptionId = result.nupcoPrescriptionId;
    record.nupcoDispenseId = result.nupcoDispenseId;
    record.authorizationNo = result.authorizationNo ?? record.authorizationNo;
    record.rejectionReason = result.rejectionReason;
    if (result.status !== 'manual_recorded' && result.status !== 'rejected') {
      record.dispensedAt = now;
      record.authorizedAt = now;
    }
    record.updatedAt = now;
    state.dispenses.push(record);

    const claim: WasfatyClaim = {
      id: nextClaimId(state),
      dispenseId: record.id,
      invoiceNo: record.invoiceNo,
      prescriptionNo: record.prescriptionNo,
      month: (record.dispensedAt ?? now).slice(0, 7),
      expectedAmount: input.claimTotal,
      status: result.status === 'rejected' ? 'cancelled' : 'pending',
      varianceReason: result.rejectionReason,
      createdAt: now,
      updatedAt: now,
    };
    state.claims.push(claim);

    record.claimId = claim.id;
    record.claimStatus = claim.status;
    record.claimMonth = claim.month;
    return { dispense: record, claim };
  });
}

export interface ListDispenseFilter {
  month?: string;
  status?: string;
  invoiceNo?: string;
}

export async function listDispenses(filter: ListDispenseFilter = {}): Promise<{
  dispenses: WasfatyDispenseRecord[];
  total: number;
}> {
  const state = await readOnlyState();
  const dispenses = state.dispenses
    .filter((d) => !filter.status || d.status === filter.status)
    .filter((d) => !filter.invoiceNo || d.invoiceNo === filter.invoiceNo)
    .filter((d) => !filter.month || (d.dispensedAt ?? d.createdAt).slice(0, 7) === filter.month)
    .slice()
    .reverse();
  return { dispenses, total: dispenses.length };
}

export async function getDispense(id: string): Promise<{ dispense: WasfatyDispenseRecord; claim?: WasfatyClaim }> {
  const state = await readOnlyState();
  const dispense = findDispense(state, id);
  if (!dispense) throw notFound(`No Wasfaty dispense "${id}".`);
  return { dispense, claim: claimForDispense(state, dispense.id) };
}

export async function cancelDispense(
  id: string,
  reason: string,
): Promise<{ dispense: WasfatyDispenseRecord }> {
  const why = requireText(reason, 'Cancellation reason');
  const { provider } = await resolveProvider();
  return mutateState(async (state) => {
    const dispense = findDispense(state, id);
    if (!dispense) throw notFound(`No Wasfaty dispense "${id}".`);
    if (dispense.status === 'cancelled') return { dispense };

    const result = await provider.cancelDispense(dispense, why);
    const now = new Date().toISOString();
    dispense.status = result.status;
    dispense.rejectionReason = why;
    dispense.updatedAt = now;

    const claim = claimForDispense(state, dispense.id);
    if (claim && claim.status === 'pending') {
      claim.status = 'cancelled';
      claim.varianceReason = why;
      claim.updatedAt = now;
      dispense.claimStatus = 'cancelled';
    }
    return { dispense };
  });
}

export interface ListClaimFilter {
  month?: string;
  status?: string;
}

export async function listClaims(filter: ListClaimFilter = {}): Promise<{
  claims: WasfatyClaim[];
  total: number;
}> {
  const state = await readOnlyState();
  const claims = state.claims
    .filter((claim) => !filter.status || claim.status === filter.status)
    .filter((claim) => !filter.month || claim.month === filter.month)
    .slice()
    .reverse();
  return { claims, total: claims.length };
}

// Claim submission is provider work. Manual mode refuses (there is no NUPCO connection to submit
// through); mock reports it; a live adapter calls the contracted operation. A claim already past
// `pending` is returned unchanged so a double click cannot submit it twice.
export async function submitClaim(id: string): Promise<{ claim: WasfatyClaim }> {
  const { provider } = await resolveProvider();
  return mutateState(async (state) => {
    const claim = findClaim(state, id);
    if (!claim) throw notFound(`No Wasfaty claim "${id}".`);
    if (claim.status !== 'pending') return { claim };

    const result = await provider.submitClaim(claim);
    const now = new Date().toISOString();
    claim.status = result.status;
    claim.reportedAmount = result.reportedAmount ?? claim.reportedAmount ?? claim.expectedAmount;
    claim.varianceReason = result.varianceReason ?? claim.varianceReason;
    claim.updatedAt = now;

    const dispense = state.dispenses.find((d) => d.id === claim.dispenseId);
    if (dispense) {
      dispense.claimStatus = claim.status;
      dispense.status = claim.status === 'paid' || claim.status === 'reconciled' ? 'reconciled' : 'claimed';
      dispense.updatedAt = now;
    }
    return { claim };
  });
}

export async function reconcileClaim(
  id: string,
  input: { reportedAmount?: number; paidAmount?: number; varianceReason?: string },
): Promise<{ claim: WasfatyClaim }> {
  const { provider } = await resolveProvider();
  return mutateState(async (state) => {
    const claim = findClaim(state, id);
    if (!claim) throw notFound(`No Wasfaty claim "${id}".`);
    if (claim.status === 'cancelled') throw badRequest('A cancelled claim cannot be reconciled.');

    const reportedAmount =
      input.reportedAmount === undefined
        ? undefined
        : finiteNonNegative(input.reportedAmount, 'Reported amount');
    const paidAmount =
      input.paidAmount === undefined ? undefined : finiteNonNegative(input.paidAmount, 'Paid amount');

    const result = await provider.reconcileClaim(claim, {
      reportedAmount,
      paidAmount,
      varianceReason: input.varianceReason,
    });
    const now = new Date().toISOString();
    claim.status = result.status as WasfatyClaimStatus;
    claim.reportedAmount = result.reportedAmount ?? claim.reportedAmount;
    claim.paidAmount = result.paidAmount ?? paidAmount ?? claim.paidAmount;
    claim.varianceReason = result.varianceReason ?? input.varianceReason ?? claim.varianceReason;
    claim.updatedAt = now;

    const dispense = state.dispenses.find((d) => d.id === claim.dispenseId);
    if (dispense) {
      dispense.claimStatus = claim.status;
      dispense.status = claim.status === 'reconciled' ? 'reconciled' : dispense.status;
      dispense.updatedAt = now;
    }
    return { claim };
  });
}

export async function lookupPrescription(input: {
  prescriptionNo: string;
  patientNationalId?: string;
}): Promise<WasfatyPrescription> {
  const prescriptionNo = requireText(input.prescriptionNo, 'Prescription number');
  if (input.patientNationalId !== undefined && !/^\d{10}$/.test(input.patientNationalId.replace(/\D/g, ''))) {
    throw badRequest('Patient national ID / Iqama must be exactly 10 digits.');
  }
  const { provider } = await resolveProvider();
  if (!provider.capabilities.lookupPrescription) {
    throw unavailable(
      `Provider "${provider.id}" does not support prescription lookup. Read the Wasfaty message and record the dispense manually.`,
    );
  }
  return provider.lookupPrescription({ prescriptionNo, patientNationalId: input.patientNationalId });
}

export async function requestAuthorization(input: {
  prescriptionNo: string;
  patientNationalId: string;
  lines: WasfatyManualDispenseInput['lines'];
}): Promise<WasfatyAuthorizationResult> {
  requireText(input.prescriptionNo, 'Prescription number');
  if (!/^\d{10}$/.test(String(input.patientNationalId ?? '').replace(/\D/g, ''))) {
    throw badRequest('Patient national ID / Iqama must be exactly 10 digits.');
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw badRequest('At least one line is required to request authorization.');
  }
  for (const [index, line] of input.lines.entries()) {
    if (!NUPCO_CODE.test(String(line.nupcoCode ?? '').replace(/[\s-]/g, ''))) {
      throw badRequest(`Line ${index + 1} NUPCO code must be 13 digits.`);
    }
    if (!Number.isFinite(line.qty) || line.qty <= 0) {
      throw badRequest(`Line ${index + 1} quantity must be greater than zero.`);
    }
  }
  const { provider } = await resolveProvider();
  if (!provider.capabilities.requestAuthorization) {
    throw unavailable(
      `Provider "${provider.id}" does not support authorization requests. Enter the portal answer manually, if any.`,
    );
  }
  return provider.requestAuthorization(input);
}

export async function health(): Promise<WasfatyHealth> {
  const described = await describeProvider();
  return {
    ok: true,
    provider: described.id,
    configured: described.configured,
    environment: process.env.WASFATY_ENV ?? 'sandbox',
    capabilities: described.capabilities,
    contract: described.contract,
    checkedAt: new Date().toISOString(),
  };
}
