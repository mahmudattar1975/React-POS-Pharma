// Client for this app's OWN RSD API (server/src/routes/rsd.ts).
//
// The browser never talks to SFDA directly and never sees RSD credentials: the server holds them
// and is the only place that speaks SOAP. This module is the mirror the POS uses after a sale is
// saved locally.
//
// Reporting is best-effort. A thrown RsdReportError with `retryable` true (or a network failure)
// means "queue it and try again"; the sale itself is already complete and must never be rolled
// back because SFDA was unreachable.
import type { RsdUnit } from '../types/rsd';

export type { RsdUnit } from '../types/rsd';
export { isRsdReportableLine, rsdUnitsForLine } from '../utils/rsdUnits';

const BASE_URL = import.meta.env.VITE_ZATCA_SERVER_URL ?? 'http://localhost:4300';
const BASE_PATH = `${BASE_URL}/api/rsd`;

export class RsdReportError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryable: boolean;

  constructor(message: string, status: number, code?: string, retryable = false) {
    super(message);
    this.name = 'RsdReportError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_PATH}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    // The server is down or unreachable: the caller must queue a retry, not lose the report.
    throw new RsdReportError(
      err instanceof Error ? err.message : 'RSD server unreachable.',
      0,
      'network_error',
      true,
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const payload = body as { error?: string; code?: string; retryable?: boolean };
    throw new RsdReportError(
      payload.error ?? `RSD API failed (${res.status})`,
      res.status,
      payload.code,
      Boolean(payload.retryable),
    );
  }
  return body as T;
}

export type RsdMode = 'mock' | 'live';
export type RsdEnvironment = 'test' | 'production';
export type RsdRecordKind = 'sale' | 'cancel';
export type RsdRecordStatus = 'sent' | 'rejected' | 'failed';
export type RsdOutcome =
  | 'sent'
  | 'already_reported'
  | 'rejected'
  | 'failed'
  | 'already_cancelled'
  | 'sale_not_reported'
  | 'sale_not_sent';

export interface RsdSaleInput extends RsdUnit {
  toGln?: string;
  prescriptionId?: string;
  prescriptionDate?: string;
  doctorId?: string;
  patientNationalId?: string;
  invoiceId?: string;
  invoiceNo?: string;
  saleLineId?: string;
}

export interface RsdCancelInput extends RsdUnit {
  invoiceId?: string;
  invoiceNo?: string;
  saleLineId?: string;
  reason?: string;
}

export interface RsdAttempt {
  at: string;
  mode: RsdMode;
  environment: RsdEnvironment;
  status: RsdRecordStatus;
  rc?: string;
  message?: string;
  notificationId?: string;
  retryable: boolean;
  durationMs?: number;
}

export interface RsdRecord extends RsdUnit {
  id: string;
  kind: RsdRecordKind;
  toGln: string;
  prescriptionId?: string;
  prescriptionDate?: string;
  doctorId?: string;
  patientNationalId?: string;
  invoiceId?: string;
  invoiceNo?: string;
  saleLineId?: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
  status: RsdRecordStatus;
  rc?: string;
  message?: string;
  notificationId?: string;
  retryable: boolean;
  attempts: RsdAttempt[];
}

export interface RsdReportResult {
  record: RsdRecord;
  outcome: RsdOutcome;
  message?: string;
}

export interface RsdStatus {
  mode: RsdMode;
  environment: RsdEnvironment;
  gln: string | null;
  credentialsConfigured: boolean;
  saleUrl: string;
  cancelUrl: string;
  directToGln: string;
  directPrescriptionId: string;
  ledger: { records: number; salesSent: number; cancelsSent: number; pendingOrFailed: number };
  mockInventoryUnits?: number;
}

// Settings > RSD. The server never returns the stored password, only whether one exists.
export interface RsdSettingsView {
  mode: RsdMode;
  environment: RsdEnvironment;
  gln: string;
  username: string;
  hasPassword: boolean;
  credentialsConfigured: boolean;
  saleUrl: string;
  cancelUrl: string;
  directToGln: string;
  directPrescriptionId: string;
  source: 'stored' | 'env';
}

export interface RsdSettingsUpdate {
  mode: RsdMode;
  environment: RsdEnvironment;
  gln: string;
  username: string;
  // Omit/blank to keep the stored password.
  password?: string;
  saleUrl: string;
  cancelUrl: string;
  directToGln: string;
  directPrescriptionId: string;
}

export interface RsdConnectionCheck {
  name: 'sale' | 'cancel' | 'mock';
  ok: boolean;
  httpStatus?: number | null;
  message?: string;
  operations?: string[];
}

export interface RsdConnectionTest {
  ok: boolean;
  mode: RsdMode;
  environment: RsdEnvironment;
  checkedAt: string;
  checks: RsdConnectionCheck[];
}

export interface RsdUnitStatus {
  gtin: string;
  serialNo: string;
  sale?: RsdRecord;
  cancel?: RsdRecord;
}

export function getRsdStatus(): Promise<RsdStatus> {
  return request<RsdStatus>('/status');
}

export function getRsdSettings(): Promise<RsdSettingsView> {
  return request<RsdSettingsView>('/settings');
}

export function updateRsdSettings(input: RsdSettingsUpdate): Promise<RsdSettingsView> {
  return request<RsdSettingsView>('/settings', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

// Read-only probe. Live mode fetches both WSDLs with Basic auth; mock mode reports the simulator.
// It cannot create a sale or a cancel, so it is safe to press as often as needed.
export function testRsdConnection(): Promise<RsdConnectionTest> {
  return request<RsdConnectionTest>('/test', { method: 'POST' });
}

export function reportRsdSale(input: RsdSaleInput): Promise<RsdReportResult> {
  return request<RsdReportResult>('/sales', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function reportRsdCancel(input: RsdCancelInput): Promise<RsdReportResult> {
  return request<RsdReportResult>('/sales/cancel', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getRsdUnit(gtin: string, serialNo: string): Promise<RsdUnitStatus> {
  return request<RsdUnitStatus>(`/units/${encodeURIComponent(gtin)}/${encodeURIComponent(serialNo)}`);
}

// Clear the terminal flag on a rejection caused by the account/configuration (FC 21017, a corrected
// credential) so the same payload may be sent again. This is the browser equivalent of the trial's
// --retry-rejected. Attempts and evidence stay in the server ledger.
export function reopenRsdRecord(
  kind: RsdRecordKind,
  gtin: string,
  serialNo: string,
): Promise<{ record: RsdRecord | null }> {
  return request<{ record: RsdRecord | null }>('/reopen', {
    method: 'POST',
    body: JSON.stringify({ kind, gtin, serialNo }),
  });
}

export function listRsdRecords(filter: {
  kind?: RsdRecordKind;
  status?: RsdRecordStatus;
  invoiceId?: string;
  invoiceNo?: string;
  limit?: number;
} = {}): Promise<{ records: RsdRecord[]; total: number }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return request<{ records: RsdRecord[]; total: number }>(`/records${qs ? `?${qs}` : ''}`);
}

// Mock-only: seed a unit as if it had been accepted into the pharmacy inventory. Never exposed by
// a live server (the route returns 409 in live mode).
export function mockAcceptRsdUnit(unit: RsdUnit): Promise<{ accepted: boolean; unit: RsdUnit }> {
  return request<{ accepted: boolean; unit: RsdUnit }>('/mock/accept', {
    method: 'POST',
    body: JSON.stringify(unit),
  });
}

export function mockResetRsd(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/mock/reset', { method: 'POST' });
}
