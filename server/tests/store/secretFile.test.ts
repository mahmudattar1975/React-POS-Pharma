// SEC-09 regressions for the encrypted secret-file envelope. These tests use temporary files and
// throwaway keys: no real CSID/RSD credential or live endpoint is involved.
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertSecretStoreConfigured,
  readSecretJson,
  SecretStoreError,
  writeSecretJson,
} from '../../src/store/secretFile';

const KEY = randomBytes(32).toString('base64');
const HEX_KEY = randomBytes(32).toString('hex');
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_KEY = process.env.SECURE_STORE_KEY;

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'secret-file-'));
  file = join(dir, 'state.json');
  process.env.NODE_ENV = 'test';
  process.env.SECURE_STORE_KEY = KEY;
});

afterEach(async () => {
  if (ORIGINAL_KEY === undefined) delete process.env.SECURE_STORE_KEY;
  else process.env.SECURE_STORE_KEY = ORIGINAL_KEY;
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  await rm(dir, { recursive: true, force: true });
});

describe('secretFile envelope (SEC-09)', () => {
  it('writes AES-256-GCM JSON with no plaintext, a fresh IV and no temp files', async () => {
    const value = { secret: 'CSID_PRIVATE_KEY', password: 'hunter2', icv: 1 };
    await writeSecretJson(file, value);

    const firstRaw = await readFile(file, 'utf8');
    expect(firstRaw).not.toContain('CSID_PRIVATE_KEY');
    expect(firstRaw).not.toContain('hunter2');
    const first = JSON.parse(firstRaw);
    expect(first).toMatchObject({ v: 1, alg: 'aes-256-gcm' });
    expect(Buffer.from(first.iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(first.tag, 'base64')).toHaveLength(16);
    expect(await readSecretJson(file)).toEqual(value);

    await writeSecretJson(file, value);
    const second = JSON.parse(await readFile(file, 'utf8'));
    expect(second.iv).not.toBe(first.iv);
    expect(await readdir(dir)).toEqual(['state.json']);
  });

  it('accepts a 32-byte key supplied as base64 or 64 hex characters', async () => {
    const value = { password: 'hex-key-secret' };
    process.env.SECURE_STORE_KEY = HEX_KEY;
    await writeSecretJson(file, value);
    expect(await readSecretJson(file)).toEqual(value);
    expect(await readFile(file, 'utf8')).not.toContain('hex-key-secret');
  });

  it('migrates legacy plaintext on first read, preserving the parsed value', async () => {
    delete process.env.SECURE_STORE_KEY;
    const legacy = { environment: 'sandbox', password: 'legacy-secret', icv: 3 };
    await writeFile(file, JSON.stringify(legacy), 'utf8');
    expect(await readFile(file, 'utf8')).toContain('legacy-secret');

    process.env.SECURE_STORE_KEY = KEY;
    expect(await readSecretJson(file)).toEqual(legacy);
    const migrated = await readFile(file, 'utf8');
    expect(migrated).not.toContain('legacy-secret');
    expect(JSON.parse(migrated)).toMatchObject({ v: 1, alg: 'aes-256-gcm' });
  });

  it('preserves the dev plaintext fallback when no key is configured', async () => {
    delete process.env.SECURE_STORE_KEY;
    const value = { password: 'dev-only-secret' };
    await writeSecretJson(file, value);
    expect(await readFile(file, 'utf8')).toBe(`${JSON.stringify(value, null, 2)}\n`);
    expect(await readSecretJson(file)).toEqual(value);
    expect(() => assertSecretStoreConfigured()).not.toThrow();
  });

  it('fails closed in production when the key is missing or malformed', async () => {
    delete process.env.SECURE_STORE_KEY;
    process.env.NODE_ENV = 'production';
    expect(() => assertSecretStoreConfigured()).toThrow('SECURE_STORE_KEY is required in production');
    await expect(readSecretJson(file)).rejects.toMatchObject({
      code: 'missing_secret_store_key',
    });
    await expect(writeSecretJson(file, { password: 'never-written' })).rejects.toMatchObject({
      code: 'missing_secret_store_key',
    });
    expect(await readFile(file, 'utf8').catch(() => '')).toBe('');

    process.env.SECURE_STORE_KEY = 'short';
    expect(() => assertSecretStoreConfigured()).toThrow('base64-encoded 32-byte key');
    await expect(readSecretJson(file)).rejects.toBeInstanceOf(SecretStoreError);
  });

  it('rejects a wrong key, tampered ciphertext and unsupported envelope metadata', async () => {
    await writeSecretJson(file, { password: 'do-not-leak' });

    process.env.SECURE_STORE_KEY = randomBytes(32).toString('base64');
    await expect(readSecretJson(file)).rejects.toMatchObject({
      code: 'secret_file_decryption_failed',
    });

    process.env.SECURE_STORE_KEY = KEY;
    const tampered = JSON.parse(await readFile(file, 'utf8'));
    tampered.data = Buffer.from('tampered').toString('base64');
    await writeFile(file, JSON.stringify(tampered), 'utf8');
    await expect(readSecretJson(file)).rejects.toMatchObject({
      code: 'secret_file_decryption_failed',
    });

    const unsupported = JSON.parse(await readFile(file, 'utf8'));
    unsupported.alg = 'aes-256-cbc';
    await writeFile(file, JSON.stringify(unsupported), 'utf8');
    await expect(readSecretJson(file)).rejects.toMatchObject({
      code: 'unsupported_secret_file',
    });
  });
});
