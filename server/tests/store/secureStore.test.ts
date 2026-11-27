// SEC-09 integration regressions: the CSID private key and invoice-chain state live in an encrypted
// envelope, while the existing environment/mode switch semantics stay byte-for-byte compatible.
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadState,
  saveState,
  setEnvironment,
  setMode,
  type StoredCsid,
  type ZatcaState,
} from '../../src/store/secureStore';
import { readSecretJson } from '../../src/store/secretFile';

const KEY = randomBytes(32).toString('base64');
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_KEY = process.env.SECURE_STORE_KEY;
const ORIGINAL_STATE_FILE = process.env.ZATCA_STATE_FILE;

const CSID: StoredCsid = {
  requestId: 'req-1',
  binarySecurityToken: 'TOKEN-VALUE',
  secret: 'CSID-SECRET',
  certificatePem: '-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----',
  privateKeyPem: '-----BEGIN PRIVATE KEY-----\nMOCK-PRIVATE-KEY\n-----END PRIVATE KEY-----',
  issuedAt: '2026-11-27T00:00:00Z',
};

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'secure-store-'));
  file = join(dir, 'zatca-state.json');
  process.env.NODE_ENV = 'test';
  process.env.SECURE_STORE_KEY = KEY;
  process.env.ZATCA_STATE_FILE = file;
});

afterEach(async () => {
  if (ORIGINAL_KEY === undefined) delete process.env.SECURE_STORE_KEY;
  else process.env.SECURE_STORE_KEY = ORIGINAL_KEY;
  if (ORIGINAL_STATE_FILE === undefined) delete process.env.ZATCA_STATE_FILE;
  else process.env.ZATCA_STATE_FILE = ORIGINAL_STATE_FILE;
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  await rm(dir, { recursive: true, force: true });
});

describe('secureStore secret-at-rest (SEC-09)', () => {
  it('never writes CSID private key or secret as plaintext and still reloads them', async () => {
    const state: ZatcaState = {
      environment: 'sandbox',
      mode: 'live',
      compliance: CSID,
      production: CSID,
      icv: 9,
      lastInvoiceHash: 'chain-hash',
    };
    await saveState(state);

    const raw = await readFile(file, 'utf8');
    expect(raw).not.toContain('CSID-SECRET');
    expect(raw).not.toContain('MOCK-PRIVATE-KEY');
    expect(raw).not.toContain('TOKEN-VALUE');
    expect(await readSecretJson<ZatcaState>(file)).toEqual(state);
    expect(await loadState()).toEqual(state);
  });

  it('keeps the CSID-clearing and ICV reset rules after encryption', async () => {
    await saveState({
      environment: 'sandbox',
      mode: 'mock',
      compliance: CSID,
      production: CSID,
      icv: 4,
      lastInvoiceHash: 'chain-hash',
    });

    await setEnvironment('simulation');
    const afterEnvironment = await loadState();
    expect(afterEnvironment.environment).toBe('simulation');
    expect(afterEnvironment.compliance).toBeUndefined();
    expect(afterEnvironment.production).toBeUndefined();
    expect(afterEnvironment.icv).toBe(0);

    await saveState({ ...afterEnvironment, compliance: CSID, icv: 2 });
    await setMode('live');
    const afterMode = await loadState();
    expect(afterMode.mode).toBe('live');
    expect(afterMode.compliance).toBeUndefined();
    expect(afterMode.icv).toBe(0);
  });

  it('migrates an existing plaintext state file without changing onboarding state', async () => {
    delete process.env.SECURE_STORE_KEY;
    const legacy: ZatcaState = {
      environment: 'simulation',
      mode: 'live',
      production: CSID,
      icv: 7,
      lastInvoiceHash: 'legacy-hash',
    };
    await writeFile(file, JSON.stringify(legacy, null, 2), 'utf8');

    process.env.SECURE_STORE_KEY = KEY;
    expect(await loadState()).toEqual(legacy);
    const raw = await readFile(file, 'utf8');
    expect(raw).not.toContain('CSID-SECRET');
    expect(raw).not.toContain('MOCK-PRIVATE-KEY');
    expect(JSON.parse(raw)).toMatchObject({ v: 1, alg: 'aes-256-gcm' });
  });
});
