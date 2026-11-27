// Settings > RSD is the only place a credential can be entered. These tests pin the two rules the
// browser relies on: it never receives the password back, and a blank password field must keep the
// stored one instead of wiping it. They also check that test/production blocks survive a switch.
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getRsdMode } from '../../src/rsd/config';
import {
  getRsdSettingsView,
  initRsdSettings,
  updateRsdSettings,
} from '../../src/rsd/settings';
import { readSecretJson } from '../../src/store/secretFile';

const TOUCHED = [
  'RSD_MODE',
  'RSD_ENV',
  'RSD_TEST_GLN',
  'RSD_TEST_USERNAME',
  'RSD_TEST_PASSWORD',
  'RSD_TEST_SALE_URL',
  'RSD_TEST_CANCEL_URL',
  'RSD_PROD_GLN',
  'RSD_PROD_USERNAME',
  'RSD_PROD_PASSWORD',
  'RSD_PROD_SALE_URL',
  'RSD_PROD_CANCEL_URL',
  'RSD_DIRECT_TO_GLN',
  'RSD_DIRECT_PRESCRIPTION_ID',
  'RSD_SETTINGS_FILE',
  'SECURE_STORE_KEY',
];

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'rsd-settings-'));
  process.env.RSD_MODE = 'mock';
  process.env.RSD_ENV = 'test';
  process.env.RSD_TEST_GLN = '6286479000015';
  process.env.RSD_TEST_USERNAME = '62864790000150000';
  process.env.RSD_TEST_PASSWORD = 'test-secret';
  process.env.RSD_TEST_SALE_URL = 'http://rsd-test/sale';
  process.env.RSD_TEST_CANCEL_URL = 'http://rsd-test/cancel';
  process.env.RSD_SETTINGS_FILE = path.join(dir, 'rsd-settings.json');
  process.env.SECURE_STORE_KEY = randomBytes(32).toString('base64');
});

afterEach(async () => {
  for (const name of TOUCHED) delete process.env[name];
  await rm(dir, { recursive: true, force: true });
});

describe('RSD settings', () => {
  it('starts from the .env seed and never returns the password', async () => {
    const view = await getRsdSettingsView();
    expect(view.source).toBe('env');
    expect(view.mode).toBe('mock');
    expect(view.environment).toBe('test');
    expect(view.gln).toBe('6286479000015');
    expect(view.hasPassword).toBe(true);
    expect(view.credentialsConfigured).toBe(true);
    expect(JSON.stringify(view)).not.toContain('test-secret');
  });

  it('keeps the stored password when the password box is left blank', async () => {
    await updateRsdSettings({
      mode: 'mock',
      environment: 'test',
      gln: '6286479000015',
      username: '62864790000150000',
      password: '',
      saleUrl: 'http://rsd-test/sale',
      cancelUrl: 'http://rsd-test/cancel',
    });

    const file = await readSecretJson<{ test: { password: string } }>(
      process.env.RSD_SETTINGS_FILE as string,
    );
    expect(file?.test.password).toBe('test-secret');
    expect(await readFile(process.env.RSD_SETTINGS_FILE as string, 'utf8')).not.toContain('test-secret');
    expect((await getRsdSettingsView()).source).toBe('stored');
  });

  it('stores test and production credentials separately', async () => {
    await updateRsdSettings({
      mode: 'live',
      environment: 'test',
      gln: '6286479000015',
      username: 'test-user',
      password: 'test-secret-2',
      saleUrl: 'http://rsd-test/sale',
      cancelUrl: 'http://rsd-test/cancel',
    });
    await updateRsdSettings({
      mode: 'live',
      environment: 'production',
      gln: '6280000000001',
      username: 'prod-user',
      password: 'prod-secret',
      saleUrl: 'https://rsd.sfda.gov.sa/sale',
      cancelUrl: 'https://rsd.sfda.gov.sa/cancel',
    });

    // Switch back to test: the production block must not have overwritten it.
    const view = await updateRsdSettings({ environment: 'test' });
    expect(view.environment).toBe('test');
    expect(view.gln).toBe('6286479000015');
    expect(view.username).toBe('test-user');

    const file = await readSecretJson<{ test: { password: string }; production: { password: string } }>(
      process.env.RSD_SETTINGS_FILE as string,
    );
    expect(file?.test.password).toBe('test-secret-2');
    expect(file?.production.password).toBe('prod-secret');
  });

  it('re-applies the saved configuration after a restart', async () => {
    await updateRsdSettings({
      mode: 'live',
      environment: 'test',
      gln: '6286479000015',
      username: 'test-user',
      password: 'test-secret-2',
      saleUrl: 'http://rsd-test/sale',
      cancelUrl: 'http://rsd-test/cancel',
    });

    // Simulate a fresh process: only the seed env vars come back.
    process.env.RSD_MODE = 'mock';
    process.env.RSD_ENV = 'test';
    delete process.env.RSD_TEST_USERNAME;

    await initRsdSettings();

    expect(getRsdMode()).toBe('live');
    const view = await getRsdSettingsView();
    expect(view.username).toBe('test-user');
    expect(view.hasPassword).toBe(true);
  });

  it('never leaves the RSD password in plaintext and rejects a wrong key', async () => {
    await updateRsdSettings({
      mode: 'live',
      environment: 'production',
      gln: '6280000000001',
      username: 'prod-user',
      password: 'prod-secret-encrypted',
      saleUrl: 'https://rsd.sfda.gov.sa/sale',
      cancelUrl: 'https://rsd.sfda.gov.sa/cancel',
    });

    const raw = await readFile(process.env.RSD_SETTINGS_FILE as string, 'utf8');
    expect(raw).not.toContain('prod-secret-encrypted');
    expect(JSON.parse(raw)).toMatchObject({ v: 1, alg: 'aes-256-gcm' });

    const configuredKey = process.env.SECURE_STORE_KEY;
    process.env.SECURE_STORE_KEY = randomBytes(32).toString('base64');
    await expect(getRsdSettingsView()).rejects.toMatchObject({
      code: 'secret_file_decryption_failed',
    });
    process.env.SECURE_STORE_KEY = configuredKey;
    expect((await getRsdSettingsView()).source).toBe('stored');
  });

  it('migrates a legacy plaintext RSD settings file on first read', async () => {
    delete process.env.SECURE_STORE_KEY;
    await writeFile(process.env.RSD_SETTINGS_FILE as string, JSON.stringify({
      mode: 'live',
      environment: 'test',
      test: {
        gln: '6286479000015',
        username: 'legacy-user',
        password: 'legacy-secret',
        saleUrl: 'http://rsd-test/sale',
        cancelUrl: 'http://rsd-test/cancel',
      },
    }), 'utf8');

    process.env.SECURE_STORE_KEY = randomBytes(32).toString('base64');
    await initRsdSettings(); // a restart applies the migrated stored settings to process.env
    const view = await getRsdSettingsView();
    expect(view.source).toBe('stored');
    expect(view.username).toBe('legacy-user');
    expect(view.hasPassword).toBe(true);
    const migrated = await readSecretJson<{ test: { password: string } }>(
      process.env.RSD_SETTINGS_FILE as string,
    );
    expect(migrated?.test.password).toBe('legacy-secret');
    expect(await readFile(process.env.RSD_SETTINGS_FILE as string, 'utf8')).not.toContain('legacy-secret');
  });
});
