import { generateCsr, csrPemToBase64 } from '../crypto/csr.js';
import { csrFieldsFromIdentity } from '../crypto/csrTemplate.js';
import { config } from '../config.js';
import type { ZatcaMode } from '../config.js';
import { MOCK_CERT_PEM, MOCK_KEY_PEM, MOCK_CERT_BASE64 } from './mock.js';
import { loadState, saveState, type StoredCsid, type ZatcaEnv } from '../store/secureStore.js';
import { loadIdentity, requireIdentityConfigured, toUblSupplier } from '../store/identity.js';
import * as zatca from './client.js';
import { buildSampleInvoices } from './sampleInvoices.js';
import { signInvoice } from './signInvoice.js';

export interface OnboardingStatus {
  step: 'not_started' | 'compliance_issued' | 'compliance_checked' | 'production_issued';
  environment: ZatcaEnv;
  mode: ZatcaMode;
  compliance?: { issuedAt: string };
  complianceCheck?: { passed: boolean; passedAt?: string };
  production?: { issuedAt: string };
}

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const state = await loadState();
  const compliance = state.compliance ? { issuedAt: state.compliance.issuedAt } : undefined;
  const complianceCheck = state.complianceCheck
    ? { passed: state.complianceCheck.passed, passedAt: state.complianceCheck.passedAt }
    : undefined;
  // A partial state file must not crash the status endpoint (e.g. production written without the
  // compliance CSID that issued it). Report what actually exists and let onboarding be repeated.
  if (state.production) {
    return {
      step: 'production_issued',
      environment: state.environment,
      mode: config.zatcaMode,
      ...(compliance ? { compliance } : {}),
      ...(complianceCheck ? { complianceCheck } : {}),
      production: { issuedAt: state.production.issuedAt },
    };
  }
  if (state.compliance) {
    return {
      step: complianceCheck?.passed ? 'compliance_checked' : 'compliance_issued',
      environment: state.environment,
      mode: config.zatcaMode,
      compliance,
      ...(complianceCheck ? { complianceCheck } : {}),
    };
  }
  return { step: 'not_started', environment: state.environment, mode: config.zatcaMode };
}

export async function setZatcaEnvironment(env: ZatcaEnv): Promise<OnboardingStatus> {
  await config.setZatcaEnv(env);
  return getOnboardingStatus();
}

export async function setZatcaMode(mode: ZatcaMode): Promise<OnboardingStatus> {
  await config.setZatcaMode(mode);
  return getOnboardingStatus();
}

// Step 1: generate a fresh key + CSR, exchange it (with the OTP from the taxpayer's Fatoora
// portal) for a Compliance CSID. This CSID can only submit to the compliance-checking endpoint,
// not real invoices.
export async function requestComplianceCsid(otp: string): Promise<StoredCsid> {
  const { identity } = await loadIdentity();
  requireIdentityConfigured(identity);

  let privateKeyPem: string;
  let response: { requestID: string; binarySecurityToken: string; secret: string };

  if (config.zatcaMode === 'mock') {
    // Offline: no CSR generation (no openssl needed) and no network call. Reuse the embedded mock
    // key/cert so signing still works end-to-end for testing.
    privateKeyPem = MOCK_KEY_PEM;
    response = {
      requestID: 'mock-request-id',
      binarySecurityToken: MOCK_CERT_BASE64,
      secret: 'mock-secret',
    };
  } else {
    const fields = csrFieldsFromIdentity(identity);
    const generated = await generateCsr(fields, config.zatcaEnv);
    privateKeyPem = generated.privateKeyPem;
    const csrBase64 = csrPemToBase64(generated.csrPem);
    response = await zatca.requestComplianceCsid(csrBase64, otp);
  }

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
  // A new Compliance CSID means a new certificate and request id, so any earlier check result no
  // longer describes this device. Force step 2 to run again.
  state.complianceCheck = undefined;
  state.production = undefined;
  await saveState(state);
  return stored;
}

// The UI and the route both need to distinguish "you skipped a step" from "ZATCA/network failed".
export class OnboardingStepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnboardingStepError';
  }
}

// Step 2: ZATCA requires proving the integration can produce valid invoices of every type before
// issuing a Production CSID - submit a fixed set of sample invoices (standard/simplified x
// invoice/credit note/debit note) through the compliance-invoices endpoint.
export async function runComplianceChecks(): Promise<{ passed: boolean; results: Array<{ name: string; status: string }> }> {
  const state = await loadState();
  if (!state.compliance) throw new OnboardingStepError('No compliance CSID on file - call requestComplianceCsid first');

  const { identity } = await loadIdentity();
  const samples = buildSampleInvoices(toUblSupplier(identity.seller));
  const results: Array<{ name: string; status: string }> = [];
  let transportError: unknown;

  for (const sample of samples) {
    try {
      const signed = await signInvoice(sample.input, state.compliance!);
      const check = await zatca.checkComplianceInvoice(
        state.compliance!,
        signed.invoiceHashBase64,
        sample.input.uuid,
        Buffer.from(signed.signedXml, 'utf8').toString('base64')
      );
      results.push({ name: sample.name, status: check.status });
    } catch (err) {
      // Keep checking the remaining samples so the operator sees every failure in one pass, but
      // remember that at least one request never reached ZATCA and must not count as a PASS.
      results.push({ name: sample.name, status: 'ERROR' });
      transportError ??= err;
    }
  }

  const passed = !transportError && results.length === samples.length && results.every((r) => r.status === 'PASS');
  const latest = await loadState();
  latest.complianceCheck = {
    passed,
    ...(passed ? { passedAt: new Date().toISOString() } : {}),
    results,
  };
  await saveState(latest);

  if (transportError) throw transportError;
  return { passed, results };
}

// Step 3: exchange the (now-validated) compliance CSID for a Production CSID - this is the one
// actually used to sign and submit real invoices going forward.
export async function requestProductionCsid(): Promise<StoredCsid> {
  const state = await loadState();
  if (!state.compliance) throw new OnboardingStepError('No compliance CSID on file');
  if (!state.complianceCheck?.passed) {
    throw new OnboardingStepError('Compliance checks have not passed - run them before requesting a Production CSID');
  }

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
