// Client for this app's OWN provider-neutral Wasfaty API (server/src/routes/wasfaty.ts).
//
// Important distinction: this is not NUPCO's wire contract. NUPCO does not publish one, so the
// browser talks to our API, and the server's `direct`/`hub` adapter is the only place that will
// ever speak NUPCO's actual protocol once onboarding supplies it. Keeping that boundary here is
// what lets the POS work today in Phase 0 (`manual`) and switch to `mock`/`direct`/`hub` with no
// frontend change.
//
// Every call is best-effort at checkout: the sale is already recorded locally before a dispense is
// mirrored, and a failure is queued (see store/pendingSyncStore.ts) rather than blocking the
// patient.
import type {
  WasfatyClaim,
  WasfatyClaimStatus,
  WasfatyDispenseLineInput,
  WasfatyDispenseRecord,
  WasfatyManualDispenseInput,
  WasfatyPrescription,
  WasfatySession,
} from '../types/wasfaty';

const BASE_URL = import.meta.env.VITE_ZATCA_SERVER_URL ?? 'http://localhost:4300';
const BASE_PATH = `${BASE_URL}/api/wasfaty`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_PATH}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error ?? `Wasfaty API failed (${res.status})`);
  }
  return body as T;
}

export interface WasfatyHealth {
  ok: boolean;
  provider: 'manual' | 'mock' | 'direct' | 'hub';
  configured: boolean;
  environment: string;
  capabilities: {
    lookupPrescription: boolean;
    requestAuthorization: boolean;
    submitDispense: boolean;
    submitClaim: boolean;
  };
  contract?: {
    source: 'none' | 'file' | 'env';
    version?: string;
    baseUrl?: string;
    missingOperations?: string[];
  };
  checkedAt: string;
}

export function getWasfatyHealth(): Promise<WasfatyHealth> {
  return request<WasfatyHealth>('/health');
}

export function lookupWasfatyPrescription(input: {
  prescriptionNo: string;
  patientNationalId?: string;
}): Promise<WasfatyPrescription> {
  return request<WasfatyPrescription>('/prescriptions/lookup', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface WasfatyAuthorizationResult {
  authorizationNo: string;
  status: 'authorized' | 'partially_authorized' | 'rejected' | 'authorization_pending';
  approvedLines: { lineId: string; nupcoCode: string; approvedQty: number }[];
  rejectedLines?: { lineId: string; nupcoCode: string; reason: string }[];
  authorizationId?: string;
  message?: string;
}

export function requestWasfatyAuthorization(input: {
  prescriptionNo: string;
  patientNationalId: string;
  lines: WasfatyDispenseLineInput[];
}): Promise<WasfatyAuthorizationResult> {
  return request<WasfatyAuthorizationResult>('/authorizations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface WasfatyDispenseResponse {
  dispense: WasfatyDispenseRecord;
  claim?: WasfatyClaim;
}

export function createWasfatyDispense(input: WasfatyManualDispenseInput): Promise<WasfatyDispenseResponse> {
  return request<WasfatyDispenseResponse>('/dispenses', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listWasfatyDispenses(params: {
  month?: string;
  status?: string;
  invoiceNo?: string;
} = {}): Promise<{ dispenses: WasfatyDispenseRecord[]; total: number }> {
  const query = new URLSearchParams();
  if (params.month) query.set('month', params.month);
  if (params.status) query.set('status', params.status);
  if (params.invoiceNo) query.set('invoiceNo', params.invoiceNo);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return request<{ dispenses: WasfatyDispenseRecord[]; total: number }>(`/dispenses${suffix}`);
}

export function getWasfatyDispense(id: string): Promise<{ dispense: WasfatyDispenseRecord; claim?: WasfatyClaim }> {
  return request<{ dispense: WasfatyDispenseRecord; claim?: WasfatyClaim }>(`/dispenses/${encodeURIComponent(id)}`);
}

export function cancelWasfatyDispense(id: string, reason: string): Promise<{ dispense: WasfatyDispenseRecord }> {
  return request<{ dispense: WasfatyDispenseRecord }>(`/dispenses/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function listWasfatyClaims(params: {
  month?: string;
  status?: WasfatyClaimStatus;
} = {}): Promise<{ claims: WasfatyClaim[]; total: number }> {
  const query = new URLSearchParams();
  if (params.month) query.set('month', params.month);
  if (params.status) query.set('status', params.status);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return request<{ claims: WasfatyClaim[]; total: number }>(`/claims${suffix}`);
}

export function submitWasfatyClaim(id: string): Promise<{ claim: WasfatyClaim }> {
  return request<{ claim: WasfatyClaim }>(`/claims/${encodeURIComponent(id)}/submit`, { method: 'POST' });
}

export function reconcileWasfatyClaim(
  id: string,
  input: { reportedAmount?: number; paidAmount?: number; varianceReason?: string },
): Promise<{ claim: WasfatyClaim }> {
  return request<{ claim: WasfatyClaim }>(`/claims/${encodeURIComponent(id)}/reconcile`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// Full session payload used by the POS when it mirrors a dispense. Kept here so the checkout code
// never has to know the API's request shape.
export function dispenseInputFromSale(input: {
  saleId: string;
  invoiceNo: string;
  session: WasfatySession;
  lines: WasfatyDispenseLineInput[];
  invoiceTotalInclVat: number;
  claimTotal: number;
  currency: string;
}): WasfatyManualDispenseInput {
  return input;
}
