// RSD domain service: validation, ledger idempotency and mock/live dispatch.
//
// The rules this file enforces are the ones that keep the pharmacy out of trouble with SFDA:
//   * one sale and one cancel record per physical unit (GTIN + SN), ever;
//   * a unit whose sale already returned RC 00000 is never submitted a second time;
//   * a cancel can only exist after its sale was accepted, so it can never overtake the sale;
//   * a business rejection (RC or fault) is terminal until someone corrects the data - an
//     automatic retry of the exact same payload would just be rejected again;
//   * an operator can explicitly reopen a rejected record after fixing an account/configuration
//     problem (for example FC 21017: not authorised); the attempts and evidence are kept.
//   * only infrastructure failures (timeout, connection loss, HTTP 5xx/429) are retryable.
//
// Sending happens INSIDE the ledger's serialised section. That is deliberate: it guarantees two
// concurrent attempts for the same unit cannot both see "no sale yet" and send twice.
import { credentialsEnvNames, getRsdConfig, hasRsdCredentials } from './config.js';
import { conflict, unavailable } from './errors.js';
import { mockAcceptUnit, mockInventorySize, mockReset, mockSendCancel, mockSendSale } from './mock.js';
import {
  normalizeCancelInput,
  normalizeGtin,
  normalizeSaleInput,
  normalizeSerialNo,
  normalizeUnit,
  type NormalizedCancel,
  type NormalizedSale,
} from './normalize.js';
import { postSoap } from './soapClient.js';
import {
  findCancelRecord,
  findSaleRecord,
  mutateLedger,
  nextRecordId,
  readLedger,
} from './store.js';
import type {
  RsdCancelInput,
  RsdRecord,
  RsdRecordStatus,
  RsdReportResult,
  RsdSaleInput,
  RsdStatus,
  RsdUnit,
  RsdUnitStatus,
} from './types.js';
import { buildCancelEnvelope, buildSaleEnvelope, isSuccessRc, parseSoapResponse } from './wire.js';

// A response is small, but a proxy error page can be large. Cap what the ledger keeps so one bad
// afternoon cannot bloat the audit file, while still storing enough to diagnose the failure.
const MAX_STORED_XML = 20_000;

interface SendResult {
  httpStatus: number | null;
  durationMs: number;
  rc?: string;
  notificationId?: string;
  message?: string;
  fault?: { code?: string; message: string };
  networkError?: string;
  requestXml?: string;
  responseXml?: string;
}

interface Verdict {
  status: RsdRecordStatus;
  rc?: string;
  message?: string;
  notificationId?: string;
  retryable: boolean;
}

// Short, human-readable explanations for the return codes seen so far. The code itself is always
// stored; this text only makes the ledger and the trial report readable.
const RC_TEXT: Record<string, string> = {
  '00000': 'Accepted by SFDA.',
  '10224': 'Product already sold by this pharmacy.',
  '10602': 'Serial number length is outside the accepted range.',
  '11035': 'Expiry date does not match the unit registered in RSD.',
  '11036': 'Batch number does not match the unit registered in RSD.',
  '11037': 'GTIN is not known to RSD.',
  '11043': 'Unit is not in this pharmacy’s RSD inventory.',
  '21017': 'Stakeholder is not authorised for this operation (check the account’s Pharmacy Sale privilege and that these are production credentials).',
  '21000': 'Invalid prescription date.',
  '80201': 'Wrong stakeholder type for this operation.',
};

function describeRc(rc: string): string {
  return RC_TEXT[rc] ?? `SFDA returned ${rc}.`;
}

function cap(xml: string | undefined): string | undefined {
  if (!xml) return undefined;
  return xml.length <= MAX_STORED_XML ? xml : `${xml.slice(0, MAX_STORED_XML)}\n<!-- truncated -->`;
}

// Live mode must never quietly degrade to "pretend it worked". Missing configuration is a 503 the
// POS turns into a queued retry, exactly like a network failure.
function assertLiveReady(): void {
  const config = getRsdConfig();
  if (config.mode !== 'live') return;
  if (!hasRsdCredentials(config.environment)) {
    throw unavailable(
      `RSD is set to live (${config.environment}) but credentials are missing. Fill ${credentialsEnvNames(
        config.environment,
      ).join(', ')} in server/.env.`,
      'rsd_not_configured',
    );
  }
  if (!config.saleUrl || !config.cancelUrl) {
    throw unavailable(
      `RSD is set to live (${config.environment}) but a service URL is missing. Set RSD_${
        config.environment === 'production' ? 'PROD' : 'TEST'
      }_SALE_URL and RSD_${config.environment === 'production' ? 'PROD' : 'TEST'}_CANCEL_URL.`,
      'rsd_not_configured',
    );
  }
  // HTTP Basic over plain HTTP would put the production password on the wire in clear text.
  // Test may be plain HTTP (SFDA's test host is), production must not be.
  if (
    config.environment === 'production' &&
    (!config.saleUrl.startsWith('https://') || !config.cancelUrl.startsWith('https://'))
  ) {
    throw unavailable(
      'Production RSD endpoints must use https://; refusing to send credentials over plain HTTP.',
      'rsd_insecure_endpoint',
    );
  }
}

function classify(result: SendResult): Verdict {
  if (result.networkError || result.httpStatus === null) {
    return {
      status: 'failed',
      retryable: true,
      message: result.networkError ?? 'No HTTP response from SFDA.',
    };
  }
  // A SOAP fault is a business answer (bad date, bad GTIN, wrong stakeholder), not a transport
  // problem: retrying the same payload unchanged would fail identically.
  if (result.fault) {
    const code = result.fault.code;
    // SFDA often puts only the numeric code in faultstring ("21017"). Store the readable text
    // instead of a bare number, since this message is what an operator sees in the ledger.
    const raw = result.fault.message;
    const message = code && (raw === code || raw === '' || raw === undefined) ? describeRc(code) : raw;
    return {
      status: 'rejected',
      rc: code,
      message,
      retryable: false,
    };
  }
  const http = result.httpStatus;
  if (http === 429 || http >= 500) {
    return {
      status: 'failed',
      retryable: true,
      message: result.message ?? `SFDA returned HTTP ${http}; the request may be retried.`,
    };
  }
  if (http === 401 || http === 403) {
    return {
      status: 'failed',
      retryable: false,
      message: `SFDA rejected the credentials (HTTP ${http}). Check the RSD username/password and GLN.`,
    };
  }
  if (http < 200 || http >= 300) {
    return {
      status: 'failed',
      retryable: false,
      message:
        result.message ??
        `SFDA returned HTTP ${http}. Check the service URL and whether the pharmacy GLN is provisioned.`,
    };
  }

  const rc = result.rc?.trim();
  if (!rc) {
    return {
      status: 'failed',
      retryable: false,
      message: result.message ?? 'SFDA response did not contain a return code (RC).',
    };
  }
  if (isSuccessRc(rc)) {
    return {
      status: 'sent',
      rc,
      notificationId: result.notificationId,
      retryable: false,
    };
  }
  return {
    status: 'rejected',
    rc,
    message: result.message ?? describeRc(rc),
    notificationId: result.notificationId,
    retryable: false,
  };
}

function applyResult(record: RsdRecord, result: SendResult): RsdReportResult {
  const config = getRsdConfig();
  const verdict = classify(result);
  const now = new Date().toISOString();

  record.status = verdict.status;
  record.rc = verdict.rc;
  record.message = verdict.message;
  record.notificationId = verdict.notificationId ?? record.notificationId;
  record.retryable = verdict.retryable;
  record.updatedAt = now;
  record.attempts.push({
    at: now,
    mode: config.mode,
    environment: config.environment,
    status: verdict.status,
    rc: verdict.rc,
    message: verdict.message,
    notificationId: verdict.notificationId,
    retryable: verdict.retryable,
    durationMs: result.durationMs,
    requestXml: cap(result.requestXml),
    responseXml: cap(result.responseXml),
  });

  return { record, outcome: verdict.status, message: verdict.message };
}

function soapResult(
  http: { httpStatus: number | null; body: string; durationMs: number; networkError?: string },
  requestXml: string,
): SendResult {
  const parsed = parseSoapResponse(http.body);
  return {
    httpStatus: http.httpStatus,
    durationMs: http.durationMs,
    networkError: http.networkError,
    rc: parsed.rc ?? parsed.products[0]?.rc,
    notificationId: parsed.notificationId,
    fault: parsed.fault,
    requestXml,
    responseXml: http.body,
  };
}

async function sendSale(input: NormalizedSale): Promise<SendResult> {
  const config = getRsdConfig();
  if (config.mode === 'mock') {
    const mock = await mockSendSale(input);
    return {
      httpStatus: mock.httpStatus,
      durationMs: 1,
      rc: mock.rc,
      notificationId: mock.notificationId,
      message: mock.message,
      fault: mock.fault,
      networkError: mock.networkError,
    };
  }
  const requestXml = buildSaleEnvelope(input);
  const http = await postSoap(
    config.saleUrl,
    requestXml,
    { gln: config.gln, username: config.username, password: config.password },
    config.timeoutMs,
  );
  return soapResult(http, requestXml);
}

async function sendCancel(
  input: NormalizedCancel,
  sale: Pick<NormalizedSale, 'toGln' | 'prescriptionId'>,
): Promise<SendResult> {
  const config = getRsdConfig();
  if (config.mode === 'mock') {
    const mock = await mockSendCancel(input);
    return {
      httpStatus: mock.httpStatus,
      durationMs: 1,
      rc: mock.rc,
      notificationId: mock.notificationId,
      message: mock.message,
      fault: mock.fault,
      networkError: mock.networkError,
    };
  }
  const requestXml = buildCancelEnvelope(input, sale);
  const http = await postSoap(
    config.cancelUrl,
    requestXml,
    { gln: config.gln, username: config.username, password: config.password },
    config.timeoutMs,
  );
  return soapResult(http, requestXml);
}

// A rejected attempt is only worth repeating once the data actually changed (a corrected batch,
// expiry, payer or prescription). Same payload + same rejection = a wasted SFDA round-trip.
function saleChanged(record: RsdRecord, input: NormalizedSale): boolean {
  return (
    record.batchNo !== input.batchNo ||
    record.expiryDate !== input.expiryDate ||
    record.toGln !== input.toGln ||
    record.prescriptionId !== input.prescriptionId ||
    record.prescriptionDate !== input.prescriptionDate
  );
}

function cancelChanged(record: RsdRecord, input: NormalizedCancel): boolean {
  return record.batchNo !== input.batchNo || record.expiryDate !== input.expiryDate;
}

function assignSale(record: RsdRecord, input: NormalizedSale): void {
  record.gtin = input.gtin;
  record.serialNo = input.serialNo;
  record.batchNo = input.batchNo;
  record.expiryDate = input.expiryDate;
  record.toGln = input.toGln;
  record.prescriptionId = input.prescriptionId;
  record.prescriptionDate = input.prescriptionDate;
  record.doctorId = input.doctorId;
  record.patientNationalId = input.patientNationalId;
  record.invoiceId = input.invoiceId;
  record.invoiceNo = input.invoiceNo;
  record.saleLineId = input.saleLineId;
}

function assignCancel(record: RsdRecord, input: NormalizedCancel): void {
  record.gtin = input.gtin;
  record.serialNo = input.serialNo;
  record.batchNo = input.batchNo;
  record.expiryDate = input.expiryDate;
  record.invoiceId = input.invoiceId;
  record.invoiceNo = input.invoiceNo;
  record.saleLineId = input.saleLineId;
  record.reason = input.reason;
}

export async function reportSale(raw: RsdSaleInput): Promise<RsdReportResult> {
  assertLiveReady();
  const input = normalizeSaleInput(raw);

  return mutateLedger(async (state) => {
    const existing = findSaleRecord(state, input.gtin, input.serialNo);
    if (existing) {
      if (existing.status === 'sent') {
        // The only correct answer to a retry of an accepted sale: the SAME record, no new send.
        return { record: existing, outcome: 'already_reported' as const };
      }
      const terminal = existing.status === 'rejected' || !existing.retryable;
      if (terminal && !saleChanged(existing, input)) {
        return {
          record: existing,
          outcome: existing.status === 'rejected' ? ('rejected' as const) : ('failed' as const),
          message: existing.message,
        };
      }
      // Retryable failure, or a corrected payload after a rejection: keep the record and append
      // an attempt, never create a second sale row for the same unit.
      assignSale(existing, input);
      return applyResult(existing, await sendSale(input));
    }

    const now = new Date().toISOString();
    const record: RsdRecord = {
      id: nextRecordId(state),
      kind: 'sale',
      gtin: input.gtin,
      serialNo: input.serialNo,
      batchNo: input.batchNo,
      expiryDate: input.expiryDate,
      toGln: input.toGln,
      prescriptionId: input.prescriptionId,
      prescriptionDate: input.prescriptionDate,
      doctorId: input.doctorId,
      patientNationalId: input.patientNationalId,
      invoiceId: input.invoiceId,
      invoiceNo: input.invoiceNo,
      saleLineId: input.saleLineId,
      createdAt: now,
      updatedAt: now,
      status: 'failed',
      retryable: true,
      attempts: [],
    };
    state.records.push(record);
    return applyResult(record, await sendSale(input));
  });
}

export async function reportCancel(raw: RsdCancelInput): Promise<RsdReportResult> {
  assertLiveReady();
  const input = normalizeCancelInput(raw);

  return mutateLedger(async (state) => {
    // A full return is the cancellation, and it only makes sense after the sale was accepted.
    // Refusing here is what guarantees a cancel can never reach SFDA before its sale.
    const sale = findSaleRecord(state, input.gtin, input.serialNo);
    if (!sale) {
      throw conflict(
        `Unit ${input.gtin}/${input.serialNo} has no sale record; nothing to cancel.`,
        'sale_not_reported',
      );
    }
    if (sale.status !== 'sent') {
      throw conflict(
        `Unit ${input.gtin}/${input.serialNo} was not accepted by RSD (sale ${sale.status}); cancel not sent.`,
        'sale_not_sent',
        sale.retryable,
      );
    }

    const context = {
      toGln: sale.toGln,
      prescriptionId: sale.prescriptionId ?? getRsdConfig().directPrescriptionId,
      prescriptionDate: sale.prescriptionDate ?? sale.createdAt.slice(0, 10),
    };

    const existing = findCancelRecord(state, input.gtin, input.serialNo);
    if (existing) {
      if (existing.status === 'sent') {
        return { record: existing, outcome: 'already_cancelled' as const };
      }
      const terminal = existing.status === 'rejected' || !existing.retryable;
      if (terminal && !cancelChanged(existing, input)) {
        return {
          record: existing,
          outcome: existing.status === 'rejected' ? ('rejected' as const) : ('failed' as const),
          message: existing.message,
        };
      }
      assignCancel(existing, input);
      return applyResult(existing, await sendCancel(input, context));
    }

    const now = new Date().toISOString();
    const record: RsdRecord = {
      id: nextRecordId(state),
      kind: 'cancel',
      gtin: input.gtin,
      serialNo: input.serialNo,
      batchNo: input.batchNo,
      expiryDate: input.expiryDate,
      toGln: context.toGln,
      prescriptionId: context.prescriptionId,
      prescriptionDate: context.prescriptionDate,
      invoiceId: input.invoiceId,
      invoiceNo: input.invoiceNo,
      saleLineId: input.saleLineId,
      reason: input.reason,
      createdAt: now,
      updatedAt: now,
      status: 'failed',
      retryable: true,
      attempts: [],
    };
    state.records.push(record);
    return applyResult(record, await sendCancel(input, context));
  });
}

// Operator action for a rejection that was caused by the account/environment rather than the unit
// data (FC 21017, wrong stakeholder type, a corrected credential). It keeps the record and every
// attempt, and only clears the terminal flag so the next report sends again. It refuses to touch a
// record that SFDA already accepted.
export async function reopenRejected(
  kind: 'sale' | 'cancel',
  gtin: string,
  serialNo: string,
): Promise<RsdRecord | undefined> {
  const normalizedGtin = normalizeGtin(gtin);
  const normalizedSerial = normalizeSerialNo(serialNo);
  return mutateLedger(async (state) => {
    const record =
      kind === 'sale'
        ? findSaleRecord(state, normalizedGtin, normalizedSerial)
        : findCancelRecord(state, normalizedGtin, normalizedSerial);
    if (!record || record.status !== 'rejected') return record;
    record.status = 'failed';
    record.retryable = true;
    record.updatedAt = new Date().toISOString();
    return record;
  });
}

export interface ListRecordFilter {
  kind?: 'sale' | 'cancel';
  status?: RsdRecordStatus;
  invoiceId?: string;
  invoiceNo?: string;
  limit?: number;
}

export async function listRecords(filter: ListRecordFilter = {}): Promise<{
  records: RsdRecord[];
  total: number;
}> {
  const state = await readLedger();
  const matching = state.records
    .filter((r) => !filter.kind || r.kind === filter.kind)
    .filter((r) => !filter.status || r.status === filter.status)
    .filter((r) => !filter.invoiceId || r.invoiceId === filter.invoiceId)
    .filter((r) => !filter.invoiceNo || r.invoiceNo === filter.invoiceNo)
    .slice()
    .reverse();
  const limit = filter.limit && filter.limit > 0 ? filter.limit : matching.length;
  return { records: matching.slice(0, limit), total: matching.length };
}

export async function unitStatus(gtin: string, serialNo: string): Promise<RsdUnitStatus> {
  const normalizedGtin = normalizeGtin(gtin);
  const normalizedSerial = normalizeSerialNo(serialNo);
  const state = await readLedger();
  return {
    gtin: normalizedGtin,
    serialNo: normalizedSerial,
    sale: findSaleRecord(state, normalizedGtin, normalizedSerial),
    cancel: findCancelRecord(state, normalizedGtin, normalizedSerial),
  };
}

export async function getStatus(): Promise<RsdStatus> {
  const config = getRsdConfig();
  const state = await readLedger();
  const sales = state.records.filter((r) => r.kind === 'sale');
  const cancels = state.records.filter((r) => r.kind === 'cancel');
  return {
    mode: config.mode,
    environment: config.environment,
    gln: config.gln || null,
    credentialsConfigured: hasRsdCredentials(config.environment),
    saleUrl: config.saleUrl,
    cancelUrl: config.cancelUrl,
    directToGln: config.directToGln,
    ledger: {
      records: state.records.length,
      salesSent: sales.filter((r) => r.status === 'sent').length,
      cancelsSent: cancels.filter((r) => r.status === 'sent').length,
      pendingOrFailed: state.records.filter((r) => r.status !== 'sent').length,
    },
    mockInventoryUnits: config.mode === 'mock' ? await mockInventorySize() : undefined,
  };
}

// Mock-only helpers. They stand in for Accept, which is outside this app's RSD scope but is what
// puts a unit into the pharmacy's RSD inventory. Calling them in live mode is a bug, not a no-op.
function assertMockMode(feature: string): void {
  if (getRsdConfig().mode === 'mock') return;
  throw conflict(`${feature} is only available when RSD_MODE=mock.`, 'not_mock');
}

export async function acceptMockUnit(raw: RsdUnit): Promise<{ accepted: boolean; unit: RsdUnit }> {
  assertMockMode('Mock inventory seed');
  const unit = normalizeUnit(raw);
  return { accepted: await mockAcceptUnit(unit), unit };
}

export async function resetMock(): Promise<void> {
  assertMockMode('Mock reset');
  await mockReset();
}
