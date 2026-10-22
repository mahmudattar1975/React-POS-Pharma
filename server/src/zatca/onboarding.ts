import { generateCsr, csrPemToBase64 } from '../crypto/csr.js';
import { csrFieldsFromConfig } from '../crypto/csrTemplate.js';
import { config } from '../config.js';
import { loadState, saveState, type StoredCsid, type ZatcaEnv } from '../store/secureStore.js';
import * as zatca from './client.js';
import { buildSampleInvoices } from './sampleInvoices.js';
import { signInvoice } from './signInvoice.js';

export interface OnboardingStatus {
  step: 'not_started' | 'compliance_issued' | 'compliance_checked' | 'production_issued';
  environment: ZatcaEnv;
  compliance?: { issuedAt: string };
  production?: { issuedAt: string };
}

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const state = await loadState();
  if (state.production) return { step: 'production_issued', environment: state.environment, compliance: { issuedAt: state.compliance!.issuedAt }, production: { issuedAt: state.production.issuedAt } };
  if (state.compliance) return { step: 'compliance_issued', environment: state.environment, compliance: { issuedAt: state.compliance.issuedAt } };
  return { step: 'not_started', environment: state.environment };
}

export async function setZatcaEnvironment(env: ZatcaEnv): Promise<OnboardingStatus> {
  await config.setZatcaEnv(env);
  return getOnboardingStatus();
}

// Step 1: generate a fresh key + CSR, exchange it (with the OTP from the taxpayer's Fatoora
// portal) for a Compliance CSID. This CSID can only submit to the compliance-checking endpoint,
// not real invoices.
export async function requestComplianceCsid(otp: string): Promise<StoredCsid> {
  config.requireSellerConfigured();
  const fields = csrFieldsFromConfig();
  const { privateKeyPem, csrPem } = await generateCsr(fields, config.zatcaEnv);
  const csrBase64 = csrPemToBase64(csrPem);

  const response = await zatca.requestComplianceCsid(csrBase64, otp);
  const certificatePem = Buffer.from(response.binarySecurityToken, 'base64').toString('utf8');

  const stored: StoredCsid = {
    requestId: response.requestID,
    binarySecurityToken: response.binarySecurityToken,
    secret: response.secret,
    certificatePem,
    privateKeyPem,
    issuedAt: new Date().toISOString(),
  };

  const state = await loadState();
  state.compliance = stored;
  await saveState(state);
  return stored;
}

// Step 2: ZATCA requires proving the integration can produce valid invoices of every type before
// issuing a Production CSID - submit a fixed set of sample invoices (standard/simplified x
// invoice/credit note/debit note) through the compliance-invoices endpoint.
export async function runComplianceChecks(): Promise<{ passed: boolean; results: Array<{ name: string; status: string }> }> {
  const state = await loadState();
  if (!state.compliance) throw new Error('No compliance CSID on file - call requestComplianceCsid first');

  const samples = buildSampleInvoices();
  const results: Array<{ name: string; status: string }> = [];

  for (const sample of samples) {
    const signed = await signInvoice(sample.input, state.compliance);
    const check = await zatca.checkComplianceInvoice(
      state.compliance,
      signed.invoiceHashBase64,
      sample.input.uuid,
      Buffer.from(signed.signedXml, 'utf8').toString('base64')
    );
    results.push({ name: sample.name, status: check.status });
  }

  return { passed: results.every((r) => r.status === 'PASS'), results };
}

// Step 3: exchange the (now-validated) compliance CSID for a Production CSID - this is the one
// actually used to sign and submit real invoices going forward.
export async function requestProductionCsid(): Promise<StoredCsid> {
  const state = await loadState();
  if (!state.compliance) throw new Error('No compliance CSID on file');

  const response = await zatca.requestProductionCsid(state.compliance, state.compliance.requestId);
  const certificatePem = Buffer.from(response.binarySecurityToken, 'base64').toString('utf8');

  const stored: StoredCsid = {
    requestId: response.requestID,
    binarySecurityToken: response.binarySecurityToken,
    secret: response.secret,
    certificatePem,
    privateKeyPem: state.compliance.privateKeyPem, // same keypair carries over to production
    issuedAt: new Date().toISOString(),
  };

  state.production = stored;
  await saveState(state);
  return stored;
}
