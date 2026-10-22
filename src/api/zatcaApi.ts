// Talks to the local ZATCA server (server/) that holds the CSID private key and does the actual
// signing/submission - see server/README.md. The POS must keep working even when this backend is
// unreachable or onboarding hasn't happened yet (see cartStore/POSPage's fallback to the Phase 1
// client-side QR), so every function here throws on failure rather than silently degrading -
// callers decide what "ZATCA isn't available right now" should mean for the sale.
const BASE_URL = import.meta.env.VITE_ZATCA_SERVER_URL ?? 'http://localhost:4300';

export type ZatcaEnv = 'sandbox' | 'simulation' | 'production';

export interface OnboardingStatus {
  step: 'not_started' | 'compliance_issued' | 'compliance_checked' | 'production_issued';
  environment: ZatcaEnv;
  compliance?: { issuedAt: string };
  production?: { issuedAt: string };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `ZATCA server ${path} failed (${res.status})`);
  return body as T;
}

export function getOnboardingStatus(): Promise<OnboardingStatus> {
  return request('/api/zatca/onboarding/status');
}

export function setEnvironment(environment: ZatcaEnv): Promise<OnboardingStatus> {
  return request('/api/zatca/onboarding/environment', { method: 'POST', body: JSON.stringify({ environment }) });
}

export function requestComplianceCsid(otp: string): Promise<{ issuedAt: string; requestId: string }> {
  return request('/api/zatca/onboarding/compliance', { method: 'POST', body: JSON.stringify({ otp }) });
}

export function runComplianceCheck(): Promise<{ passed: boolean; results: Array<{ name: string; status: string }> }> {
  return request('/api/zatca/onboarding/compliance-check', { method: 'POST' });
}

export function requestProductionCsid(): Promise<{ issuedAt: string; requestId: string }> {
  return request('/api/zatca/onboarding/production', { method: 'POST' });
}

export interface SubmitInvoiceLine {
  id: string;
  itemNameEn: string;
  qty: number;
  unitPrice: number;
  vatRate: number;
  discountAmount: number;
}

export interface SubmitInvoiceRequest {
  invoiceNo: string;
  invoiceType: 'standard' | 'simplified';
  date: string;
  customerName: string;
  customerVatNumber?: string;
  lines: SubmitInvoiceLine[];
  paymentMethod: 'cash' | 'card' | 'insurance';
}

export interface SubmitInvoiceResult {
  status: 'cleared' | 'reported' | 'accepted_with_warnings' | 'failed';
  qrBase64: string;
  invoiceHashBase64: string;
  zatcaResponse: unknown;
  signedXmlBase64: string;
}

export function submitInvoice(req: SubmitInvoiceRequest): Promise<SubmitInvoiceResult> {
  return request('/api/zatca/invoices', { method: 'POST', body: JSON.stringify(req) });
}

export async function isServerReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}
