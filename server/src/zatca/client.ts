// Thin client over ZATCA's e-invoicing gateway. Endpoint paths and auth scheme reflect ZATCA's
// published onboarding/reporting flow (compliance CSID -> compliance invoice checks -> production
// CSID -> clearance/reporting) - VERIFY against ZATCA's current developer documentation before
// relying on this for real onboarding; see server/README.md for what's been validated so far.
//
// CONFIRMED LIVE (2026-09-29): hit the real simulation base URL with a throwaway OTP (expected to
// be rejected - no real onboarding credentials available) and got back a real HTTP response
// rather than a connection failure, confirming ZATCA_BASE_URLS.simulation is reachable/correct.
// That response was `406: "This Version is not supported or not provided in the header"` until
// the Accept-Version header below was added - ZATCA's gateway requires it on every call.
import { config } from '../config.js';

const ZATCA_API_VERSION = 'V2';

export interface CsidResponse {
  requestID: string;
  binarySecurityToken: string; // base64 X.509 certificate
  secret: string; // password for Basic auth on subsequent calls
}

export interface ComplianceCheckResult {
  validationResults: unknown;
  status: 'PASS' | 'WARNING' | 'ERROR' | string;
}

export interface SubmitResult {
  status: string;
  clearedInvoice?: string; // base64 XML, only returned for clearance (standard) invoices
  warnings?: unknown[];
  errors?: unknown[];
}

function authHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

async function postJson<T>(url: string, body: unknown, headers: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Version': ZATCA_API_VERSION, ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`ZATCA ${url} -> ${res.status}: ${JSON.stringify(parsed)}`);
  }
  return parsed as T;
}

export async function requestComplianceCsid(csrBase64: string, otp: string): Promise<CsidResponse> {
  return postJson<CsidResponse>(`${config.zatcaBaseUrl}/compliance`, { csr: csrBase64 }, { OTP: otp });
}

export async function checkComplianceInvoice(
  csid: Pick<CsidResponse, 'binarySecurityToken' | 'secret'>,
  invoiceHashBase64: string,
  uuid: string,
  invoiceBase64: string
): Promise<ComplianceCheckResult> {
  return postJson<ComplianceCheckResult>(
    `${config.zatcaBaseUrl}/compliance/invoices`,
    { invoiceHash: invoiceHashBase64, uuid, invoice: invoiceBase64 },
    { Authorization: authHeader(csid.binarySecurityToken, csid.secret) }
  );
}

export async function requestProductionCsid(
  complianceCsid: Pick<CsidResponse, 'binarySecurityToken' | 'secret'>,
  complianceRequestId: string
): Promise<CsidResponse> {
  return postJson<CsidResponse>(
    `${config.zatcaBaseUrl}/production/csids`,
    { compliance_request_id: complianceRequestId },
    { Authorization: authHeader(complianceCsid.binarySecurityToken, complianceCsid.secret) }
  );
}

export async function submitInvoice(
  productionCsid: Pick<CsidResponse, 'binarySecurityToken' | 'secret'>,
  invoiceHashBase64: string,
  uuid: string,
  invoiceBase64: string,
  clearance: boolean
): Promise<SubmitResult> {
  const path = clearance ? 'invoices/clearance/single' : 'invoices/reporting/single';
  const headers: Record<string, string> = { Authorization: authHeader(productionCsid.binarySecurityToken, productionCsid.secret) };
  if (clearance) headers['Clearance-Status'] = '1';
  return postJson<SubmitResult>(`${config.zatcaBaseUrl}/${path}`, { invoiceHash: invoiceHashBase64, uuid, invoice: invoiceBase64 }, headers);
}
