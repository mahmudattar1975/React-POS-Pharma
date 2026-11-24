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
  // Persisted by the server when the six sample invoices have actually passed. Step 3 is unlocked
  // from this, not from a local "I clicked the button" flag, so a reload or a second browser cannot
  // skip onboarding.
  complianceCheck?: { passed: boolean; passedAt?: string };
  production?: { issuedAt: string };
}

// A till must never hang forever on a server that accepted the TCP connection but never answers.
// 15 s is long enough for signing + a ZATCA round trip, short enough that the cashier can fall back
// to the Phase 1 QR and finish the sale.
const REQUEST_TIMEOUT_MS = 15_000;

export class ZatcaApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly path: string;

  constructor(status: number, body: unknown, path: string) {
    const message = typeof body === 'object' && body !== null && 'error' in body
      ? String((body as { error: unknown }).error)
      : `ZATCA server ${path} failed (${status})`;
    super(message);
    this.name = 'ZatcaApiError';
    this.status = status;
    this.body = body;
    this.path = path;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ZatcaApiError(res.status, body, path);
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

// --- Seller + device identity (Settings > ZATCA > Company & Device) -----------------------------
// These values are stored on the ZATCA server and used for BOTH the CSR (the certificate ZATCA
// issues) and the signed UBL invoice, so the two can no longer describe different businesses. `.env`
// is only the first-run seed (`source: 'env'`).

export type ZatcaInvoiceTypeFlag = '0100' | '1000' | '1100';

export interface ZatcaSellerIdentity {
  nameEn: string;
  nameAr: string;
  vatNumber: string;
  crNumber: string;
  street: string;
  city: string;
  postalCode: string;
  district: string;
  country: string;
  organizationUnit: string;
  industry: string;
}

export interface ZatcaDeviceIdentity {
  terminalNo: number;
  solutionName: string;
  solutionRelease: string;
  egUuid: string;
  invoiceType: ZatcaInvoiceTypeFlag;
}

export interface ZatcaDerivedIdentity {
  commonName: string;
  egsSerialNumber: string;
}

export type ZatcaCsidLifecycle = 'active' | 'expiring' | 'expired' | 'unknown';

export interface ZatcaCsidSummary {
  issuedAt: string;
  expiresAt: string | null;
  daysUntilExpiry: number | null;
  status: ZatcaCsidLifecycle;
}

export interface ZatcaSettings {
  seller: ZatcaSellerIdentity;
  device: ZatcaDeviceIdentity;
  derived: ZatcaDerivedIdentity;
  source: 'stored' | 'env';
  configured: boolean;
  missing: string[];
  environment: ZatcaEnv;
  csid: {
    compliance?: ZatcaCsidSummary;
    production?: ZatcaCsidSummary;
  };
}

export interface ZatcaSettingsUpdate extends ZatcaSettings {
  csidsCleared: boolean;
}

export function getSettings(): Promise<ZatcaSettings> {
  return request('/api/zatca/onboarding/settings');
}

export function saveSettings(input: {
  seller: ZatcaSellerIdentity;
  device: ZatcaDeviceIdentity;
}): Promise<ZatcaSettingsUpdate> {
  return request('/api/zatca/onboarding/settings', { method: 'PUT', body: JSON.stringify(input) });
}

export interface SubmitInvoiceLine {
  id: string;
  itemNameEn: string;
  qty: number;
  // UN/ECE Rec 20/21 code for the selling unit (XCT carton, XBX box, SR strip, U2 tablet). Omitted
  // for unpacked items, where the server keeps its PCE default.
  unitCode?: string;
  unitPrice: number;
  vatRate: number;
  discountAmount: number;
}

export interface SubmitInvoiceRequest {
  invoiceNo: string;
  invoiceType: 'standard' | 'simplified';
  // Defaults to 'invoice' on the server. Returns send 'credit_note' with the original document
  // reference, so the signed UBL uses document type 381 instead of 388 and is archived as a credit
  // note rather than looking like a second sale.
  documentType?: 'invoice' | 'credit_note' | 'debit_note';
  billingReference?: { id: string; uuid?: string; issueDate?: string };
  note?: string;
  date: string;
  customerName: string;
  customerVatNumber?: string;
  lines: SubmitInvoiceLine[];
  paymentMethod: 'cash' | 'card' | 'insurance' | 'other';
}

export interface SubmitInvoiceResult {
  status: 'cleared' | 'reported' | 'accepted_with_warnings' | 'failed';
  qrBase64: string;
  invoiceHashBase64: string;
  zatcaResponse: unknown;
  signedXmlBase64: string;
  // Structured validation reason from ZATCA. Shown next to a rejected row so the operator knows what
  // to correct instead of only seeing "rejected".
  reason?: string;
  clearedInvoiceXmlBase64?: string;
  // Identity of the document ZATCA processed. The server assigns these (UUID per document, ICV per
  // device) - the POS stores them on the sale so a reprint or an audit can point at exactly the
  // document that was accepted instead of merely "an" invoice with the same number.
  uuid: string;
  icv: number;
  environment: ZatcaEnv;
}

// One row from the server's retention archive (server/src/store/invoiceArchive.ts). Deliberately
// does NOT include the XML body - the list stays small; fetch one document on demand.
export interface ArchivedInvoiceSummary {
  uuid: string;
  icv: number;
  invoiceNo: string;
  invoiceType: 'standard' | 'simplified';
  documentType?: 'invoice' | 'credit_note' | 'debit_note';
  billingReference?: { id: string; uuid?: string; issueDate?: string };
  note?: string;
  issueDate: string;
  status: SubmitInvoiceResult['status'];
  invoiceHashBase64: string;
  reason?: string;
  submittedAt: string;
  environment: ZatcaEnv;
}

export interface ArchivedInvoice extends ArchivedInvoiceSummary {
  qrBase64: string;
  signedXml: string; // the exact signed UBL 2.1 document that was submitted
  clearedInvoiceXmlBase64?: string;
  response: unknown;
}

export function submitInvoice(req: SubmitInvoiceRequest): Promise<SubmitInvoiceResult> {
  return request('/api/zatca/invoices', { method: 'POST', body: JSON.stringify(req) });
}

// Legal retention: ZATCA requires the signed document to be kept (and produced on request), so the
// server archives every attempt. These two reads back the Sales invoices tab: list for the audit
// table, one document for "view/download the XML that was actually signed".
export function listArchivedInvoices(limit = 200): Promise<{ invoices: ArchivedInvoiceSummary[] }> {
  return request(`/api/zatca/invoices?limit=${limit}`);
}

export function getArchivedInvoice(uuid: string): Promise<ArchivedInvoice> {
  return request(`/api/zatca/invoices/${encodeURIComponent(uuid)}`);
}

export async function isServerReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}
