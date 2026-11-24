// Offline stand-in for ZATCA's gateway, used when ZATCA_MODE=mock. Mirrors RSD's mock mode:
// no network, no Fatoora OTP, no real CSID - the whole onboarding + submission flow can be
// exercised end-to-end for development/testing without touching ZATCA's infrastructure.
//
// Only the NETWORK calls are faked. CSR generation, UBL signing, hashing and QR building still
// run for real (they need no network), so the produced documents are structurally valid and can
// be inspected; they are just never verified by ZATCA.

export const MOCK_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBxzCCAWygAwIBAgIUJ66TRgABYD9egKCg36qgjX0HFlIwCgYIKoZIzj0EAwIw
OjELMAkGA1UEBhMCU0ExFjAUBgNVBAoMDU1vY2sgUGhhcm1hY3kxEzARBgNVBAMM
Cm1vY2stemF0Y2EwHhcNMjYxMTIzMjMwOTI0WhcNMzYxMTIwMjMwOTI0WjA6MQsw
CQYDVQQGEwJTQTEWMBQGA1UECgwNTW9jayBQaGFybWFjeTETMBEGA1UEAwwKbW9j
ay16YXRjYTBWMBAGByqGSM49AgEGBSuBBAAKA0IABLcdYhrVoywjqEtmj7nj8IWa
/hsAtSTimmyX/KRTWZrx98nvlm5BIZ39CF+D/sZXEw6UOYA193LhW4FWCXV7Xzqj
UzBRMB0GA1UdDgQWBBS07xZcVBgnRL1nbfOCU890qHmRKDAfBgNVHSMEGDAWgBS0
7xZcVBgnRL1nbfOCU890qHmRKDAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMC
A0kAMEYCIQCWeeCt+Q66bjg92wqfVhNV/mw2TejJHhFFodXQAT3fkQIhAJZ6jvJS
6X6FnBIhRVQM/00OwWYs5YPqJRA4vN9Nd/vl
-----END CERTIFICATE-----`;

export const MOCK_KEY_PEM = `-----BEGIN EC PRIVATE KEY-----
MHQCAQEEIHqNqFhc1j39ictbjjus4/CEmlSm+KJtHusP8EEexzW0oAcGBSuBBAAK
oUQDQgAEtx1iGtWjLCOoS2aPuePwhZr+GwC1JOKabJf8pFNZmvH3ye+WbkEhnf0I
X4P+xlcTDpQ5gDX3cuFbgVYJdXtfOg==
-----END EC PRIVATE KEY-----`;

export const MOCK_CERT_BASE64 = Buffer.from(MOCK_CERT_PEM, 'utf8').toString('base64');

export const MOCK_REQUEST_ID = 'mock-request-id';

export interface MockCsidResponse {
  requestID: string;
  binarySecurityToken: string;
  secret: string;
}

export function mockComplianceCsid(): MockCsidResponse {
  return {
    requestID: MOCK_REQUEST_ID,
    binarySecurityToken: MOCK_CERT_BASE64,
    secret: 'mock-secret',
  };
}

export function mockProductionCsid(): MockCsidResponse {
  return {
    requestID: 'mock-production-request-id',
    binarySecurityToken: MOCK_CERT_BASE64,
    secret: 'mock-secret',
  };
}

export function mockCheckComplianceInvoice(): { validationResults: unknown; status: 'PASS' } {
  return { validationResults: { infoMessages: [], warningMessages: [], errorMessages: [] }, status: 'PASS' };
}

export interface MockSubmitResult {
  status: string;
  clearedInvoice?: string;
  warnings?: unknown[];
  errors?: unknown[];
}

export function mockSubmitInvoice(clearance: boolean, invoiceBase64: string): MockSubmitResult {
  return {
    status: clearance ? 'CLEARED' : 'REPORTED',
    clearedInvoice: clearance ? invoiceBase64 : undefined,
    warnings: [],
    errors: [],
  };
}