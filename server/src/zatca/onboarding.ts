import { generateCsr, csrPemToBase64 } from '../crypto/csr.js';
import { csrFieldsFromIdentity } from '../crypto/csrTemplate.js';
import { config } from '../config.js';
import { loadState, saveState, type StoredCsid, type ZatcaEnv } from '../store/secureStore.js';
import { loadIdentity, requireIdentityConfigured, toUblSupplier } from '../store/identity.js';
import * as zatca from './client.js';
import { buildSampleInvoices } from './sampleInvoices.js';
import { signInvoice } from './signInvoice.js';

export interface OnboardingStatus {
  step: 'not_started' | 'compliance_issued' | 'compliance_checked' | 'production_issued';
  environment: ZatcaEnv;
  compliance?: { issuedAt: string };
  production?: { issuedAt: string };
  complianceCheck?: { passed: boolean; checkedAt?: string };
}

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const state = await loadState();
  const complianceCheck = state.complianceCheck
    ? { passed: state.complianceCheck.passed, checkedAt: state.complianceCheck.checkedAt }
    : undefined;
  if (state.production) return { step: 'production_issued', environment: state.environment, compliance: { issuedAt: state.compliance!.issuedAt }, production: { issuedAt: state.production.issuedAt }, complianceCheck };
  if (state.compliance) return { step: 'compliance_issued', environment: state.environment, compliance: { issuedAt: state.compliance.issuedAt }, complianceCheck };
  return { step: 'not_started', environment: state.environment, complianceCheck };
}

export async function setZatcaEnvironment(env: ZatcaEnv): Promise<OnboardingStatus> {
  await config.setZatcaEnv(env);
  return getOnboardingStatus();
}

// Step 1: generate a fresh key + CSR, exchange it (with the OTP from the taxpayer's Fatoora
// portal) for a Compliance CSID. This CSID can only submit to the compliance-checking endpoint,
// not real invoices.
export async function requestComplianceCsid(otp: string): Promise<StoredCsid> {
  // The CSR is built from the identity stored on this server (Settings > ZATCA > Company & Device),
  // not straight from `.env`. `.env` only seeds that identity the first time.
  const { identity } = await loadIdentity();
  requireIdentityConfigured(identity);
  const fields = csrFieldsFromIdentity(identity);
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
  // A new CSID means a new key pair; an earlier compliance-check result no longer describes it.
  state.complianceCheck = undefined;
  await saveState(state);
  return stored;
}

// Step 2: ZATCA requires proving the integration can produce valid invoices of every type before
// issuing a Production CSID - submit a fixed set of sample invoices (standard/simplified x
// invoice/credit note/debit note) through the compliance-invoices endpoint.
export async function runComplianceChecks(): Promise<{ passed: boolean; results: Array<{ name: string; status: string }> }> {
  const state = await loadState();
  if (!state.compliance) throw new Error('No compliance CSID on file - call requestComplianceCsid first');

  const { identity } = await loadIdentity();
  const samples = buildSampleInvoices(toUblSupplier(identity.seller));
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

  const passed = results.every((r) => r.status === 'PASS');
  // Persist the outcome: the wizard must not ask for six new sample invoices after a page reload,
  // and it must not hide a failed run behind the old "compliance issued" step either.
  state.complianceCheck = { passed, checkedAt: new Date().toISOString() };
  await saveState(state);
  return { passed, results };
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
