// Persists ZATCA onboarding material (CSID private key, certificate, secrets) and the invoice
// chain counter (ICV) to a local JSON file.
//
// SEC-09: the whole file is encrypted with AES-256-GCM when SECURE_STORE_KEY is configured (required
// in production). Without a key outside production, the original plaintext workflow is preserved
// for local development. See store/secretFile.ts for the envelope, migration and failure rules.
// A real HSM/KMS would still be needed to stop a compromised running process from using the key.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ZatcaIdentity } from './identity.js';
import { readSecretJson, writeSecretJson } from './secretFile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DEFAULT_FILE = path.join(DATA_DIR, 'zatca-state.json');

function stateFile(): string {
  // Tests and special deployments can relocate the state file; production still requires the key.
  return process.env.ZATCA_STATE_FILE?.trim() || DEFAULT_FILE;
}

export interface StoredCsid {
  requestId: string;
  binarySecurityToken: string;
  secret: string;
  certificatePem: string;
  privateKeyPem: string;
  issuedAt: string;
}

export type ZatcaEnv = 'sandbox' | 'simulation' | 'production';
export type ZatcaMode = 'mock' | 'live';

export interface ZatcaState {
  environment: ZatcaEnv;
  mode?: ZatcaMode;
  compliance?: StoredCsid;
  production?: StoredCsid;
  icv: number; // last-used Invoice Counter Value, increments per invoice on this device
  lastInvoiceHash: string; // PIH for the next invoice; "0" (base64 of a single zero byte) for the very first
  // ZATCA will not issue a Production CSID until the six sample invoices have passed the compliance
  // check. Persist that result: the UI's step 3 must stay locked after a reload, and a second client
  // must not be able to skip step 2 just because it never saw the first client's screen.
  complianceCheck?: {
    passed: boolean;
    passedAt?: string;
    results: Array<{ name: string; status: string }>;
  };
  // Seller + device identity (see store/identity.ts). Optional so state files written before it
  // existed still load; those get seeded from `.env` on first read.
  identity?: ZatcaIdentity;
}

// Base64 of a single zero byte - the chain root ZATCA expects before the first invoice on a device.
export const ZERO_INVOICE_HASH = Buffer.from([0]).toString('base64');

const EMPTY_STATE: ZatcaState = {
  environment: 'sandbox', // safe default - no real Fatoora OTP needed, see config.ts
  icv: 0,
  lastInvoiceHash: ZERO_INVOICE_HASH,
};

async function ensureFile(): Promise<void> {
  if (await readSecretJson<ZatcaState>(stateFile()) === null) {
    await writeSecretJson(stateFile(), EMPTY_STATE);
  }
}

export async function loadState(): Promise<ZatcaState> {
  await ensureFile();
  const parsed = await readSecretJson<Partial<ZatcaState>>(stateFile());
  return { ...EMPTY_STATE, ...parsed }; // back-fills `environment` for state files written before it existed
}

export async function saveState(state: ZatcaState): Promise<void> {
  await writeSecretJson(stateFile(), state);
}

export async function getEnvironment(): Promise<ZatcaEnv> {
  return (await loadState()).environment;
}

// Switching environment also clears any CSID material from a different environment - a
// compliance/production CSID issued against `sandbox` is meaningless (and will be rejected) if
// sent to `simulation`, so carrying it over silently would just produce confusing auth failures
// later instead of a clear "you need to onboard again" state right when the switch happens.
export async function setEnvironment(environment: ZatcaEnv): Promise<void> {
  const state = await loadState();
  if (state.environment !== environment) {
    state.environment = environment;
    state.compliance = undefined;
    state.complianceCheck = undefined;
    state.production = undefined;
    state.icv = 0;
    state.lastInvoiceHash = EMPTY_STATE.lastInvoiceHash;
  }
  await saveState(state);
}

export async function getMode(): Promise<ZatcaMode> {
  const state = await loadState();
  return state.mode ?? ((process.env.ZATCA_MODE as ZatcaMode) ?? 'live');
}

// Switching mode clears any CSID material from the other mode - a mock CSID is meaningless against
// live ZATCA and vice versa, so carrying it over would only produce confusing failures later.
export async function setMode(mode: ZatcaMode): Promise<void> {
  const state = await loadState();
  if ((state.mode ?? 'live') !== mode) {
    state.mode = mode;
    state.compliance = undefined;
    state.complianceCheck = undefined;
    state.production = undefined;
    state.icv = 0;
    state.lastInvoiceHash = EMPTY_STATE.lastInvoiceHash;
  } else {
    state.mode = mode;
  }
  await saveState(state);
}

export async function nextInvoiceCounter(): Promise<{ icv: number; previousHash: string }> {
  const state = await loadState();
  return { icv: state.icv + 1, previousHash: state.lastInvoiceHash };
}

export async function recordInvoice(icv: number, invoiceHashBase64: string): Promise<void> {
  const state = await loadState();
  state.icv = icv;
  state.lastInvoiceHash = invoiceHashBase64;
  await saveState(state);
}
