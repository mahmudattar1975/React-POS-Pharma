// Persists ZATCA onboarding material (CSID private key, certificate, secrets) and the invoice
// chain counter (ICV) to a local JSON file.
//
// DEV-GRADE ONLY - this is plaintext-on-disk storage, fine for building and testing this project
// locally, NOT fine for production. Before going live, replace this with a real secrets store
// (a KMS, an HSM, or at minimum an encrypted-at-rest store with access control) - the CSID
// private key is exactly the kind of material a compromise of which lets someone forge invoices
// under this business's VAT registration.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'zatca-state.json');

export interface StoredCsid {
  requestId: string;
  binarySecurityToken: string;
  secret: string;
  certificatePem: string;
  privateKeyPem: string;
  issuedAt: string;
}

export type ZatcaEnv = 'sandbox' | 'simulation' | 'production';

export interface ZatcaState {
  environment: ZatcaEnv;
  compliance?: StoredCsid;
  production?: StoredCsid;
  icv: number; // last-used Invoice Counter Value, increments per invoice on this device
  lastInvoiceHash: string; // PIH for the next invoice; "0" (base64 of a single zero byte) for the very first
}

const EMPTY_STATE: ZatcaState = {
  environment: 'sandbox', // safe default - no real Fatoora OTP needed, see config.ts
  icv: 0,
  lastInvoiceHash: Buffer.from([0]).toString('base64'),
};

async function ensureFile(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    await readFile(FILE, 'utf8');
  } catch {
    await writeFile(FILE, JSON.stringify(EMPTY_STATE, null, 2), 'utf8');
  }
}

export async function loadState(): Promise<ZatcaState> {
  await ensureFile();
  const text = await readFile(FILE, 'utf8');
  const parsed = JSON.parse(text) as Partial<ZatcaState>;
  return { ...EMPTY_STATE, ...parsed }; // back-fills `environment` for state files written before it existed
}

export async function saveState(state: ZatcaState): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(state, null, 2), 'utf8');
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
    state.production = undefined;
    state.icv = 0;
    state.lastInvoiceHash = EMPTY_STATE.lastInvoiceHash;
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
