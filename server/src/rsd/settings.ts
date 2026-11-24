// Runtime-editable RSD settings for Settings > RSD.
//
// `server/.env` stays the seed: it is what a fresh installation uses. Once the panel saves, the
// values live in `server/data/rsd-settings.json` and are pushed into `process.env`, because
// config.ts reads the environment on every call. That makes a saved change take effect without a
// restart, while keeping every credential on the server - the browser only ever receives booleans
// such as `hasPassword` / `credentialsConfigured`.
//
// DEV-GRADE, like store/secureStore.ts: the file is plaintext on disk. Before a production rollout,
// move these values to a real secrets store (KMS/HSM or an encrypted store with access control).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getRsdConfig,
  getRsdEnvironment,
  getRsdMode,
  getRsdUrls,
  hasRsdCredentials,
} from './config.js';
import type { RsdEnvironment, RsdMode } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.join(__dirname, '..', '..', 'data', 'rsd-settings.json');

export interface RsdEnvSettings {
  gln: string;
  username: string;
  password: string;
  saleUrl: string;
  cancelUrl: string;
}

export interface RsdStoredSettings {
  mode: RsdMode;
  environment: RsdEnvironment;
  test: RsdEnvSettings;
  production: RsdEnvSettings;
  directToGln: string;
  directPrescriptionId: string;
  updatedAt: string;
}

// What the browser is allowed to see. Deliberately no password field.
export interface RsdSettingsView {
  mode: RsdMode;
  environment: RsdEnvironment;
  gln: string;
  username: string;
  hasPassword: boolean;
  credentialsConfigured: boolean;
  saleUrl: string;
  cancelUrl: string;
  directToGln: string;
  directPrescriptionId: string;
  // 'stored' once the panel has saved; 'env' means the values still come from server/.env.
  source: 'stored' | 'env';
}

export interface RsdSettingsUpdate {
  mode?: string;
  environment?: string;
  gln?: string;
  username?: string;
  // Blank/absent keeps the stored password: the UI never receives it back, so an empty box must
  // not wipe a working credential.
  password?: string;
  saleUrl?: string;
  cancelUrl?: string;
  directToGln?: string;
  directPrescriptionId?: string;
}

const ENVIRONMENTS: RsdEnvironment[] = ['test', 'production'];

function settingsFile(): string {
  return (process.env.RSD_SETTINGS_FILE ?? '').trim() || DEFAULT_FILE;
}

function envPrefix(environment: RsdEnvironment): string {
  return environment === 'production' ? 'RSD_PROD' : 'RSD_TEST';
}

function setEnv(name: string, value: string): void {
  if (value === '') delete process.env[name];
  else process.env[name] = value;
}

function currentEnvSettings(environment: RsdEnvironment): RsdEnvSettings {
  const prefix = envPrefix(environment);
  const urls = getRsdUrls(environment);
  return {
    gln: (process.env[`${prefix}_GLN`] ?? '').trim(),
    username: (process.env[`${prefix}_USERNAME`] ?? '').trim(),
    password: process.env[`${prefix}_PASSWORD`] ?? '',
    saleUrl: urls.saleUrl,
    cancelUrl: urls.cancelUrl,
  };
}

export async function loadStoredSettings(): Promise<RsdStoredSettings | null> {
  try {
    const text = await readFile(settingsFile(), 'utf8');
    const parsed = JSON.parse(text) as Partial<RsdStoredSettings>;
    if (!parsed || typeof parsed !== 'object') return null;
    const base = {
      mode: getRsdMode(),
      environment: getRsdEnvironment(),
      test: currentEnvSettings('test'),
      production: currentEnvSettings('production'),
      directToGln: getRsdConfig().directToGln,
      directPrescriptionId: getRsdConfig().directPrescriptionId,
      updatedAt: new Date(0).toISOString(),
    };
    for (const environment of ENVIRONMENTS) {
      const block = parsed[environment];
      if (block && typeof block === 'object') {
        base[environment] = { ...base[environment], ...block };
      }
    }
    return {
      ...base,
      mode: parsed.mode === 'live' ? 'live' : parsed.mode === 'mock' ? 'mock' : base.mode,
      environment:
        parsed.environment === 'production'
          ? 'production'
          : parsed.environment === 'test'
            ? 'test'
            : base.environment,
      directToGln: typeof parsed.directToGln === 'string' ? parsed.directToGln : base.directToGln,
      directPrescriptionId:
        typeof parsed.directPrescriptionId === 'string'
          ? parsed.directPrescriptionId
          : base.directPrescriptionId,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : base.updatedAt,
    };
  } catch {
    return null;
  }
}

// Push a saved configuration into the process environment so the per-call config reader sees it.
export function applyStoredSettings(stored: RsdStoredSettings): void {
  setEnv('RSD_MODE', stored.mode);
  setEnv('RSD_ENV', stored.environment);
  setEnv('RSD_DIRECT_TO_GLN', stored.directToGln);
  setEnv('RSD_DIRECT_PRESCRIPTION_ID', stored.directPrescriptionId);
  for (const environment of ENVIRONMENTS) {
    const prefix = envPrefix(environment);
    const block = stored[environment];
    setEnv(`${prefix}_GLN`, block.gln);
    setEnv(`${prefix}_USERNAME`, block.username);
    setEnv(`${prefix}_PASSWORD`, block.password);
    setEnv(`${prefix}_SALE_URL`, block.saleUrl);
    setEnv(`${prefix}_CANCEL_URL`, block.cancelUrl);
  }
}

// Called once at server start, before routes are mounted. A missing/corrupt file leaves the .env
// seed in place, which is the right failure mode: an unreadable settings file must not silently
// switch RSD off or point it at a different environment.
export async function initRsdSettings(): Promise<void> {
  const stored = await loadStoredSettings();
  if (stored) applyStoredSettings(stored);
}

export async function getRsdSettingsView(): Promise<RsdSettingsView> {
  const stored = await loadStoredSettings();
  const config = getRsdConfig();
  return {
    mode: config.mode,
    environment: config.environment,
    gln: config.gln,
    username: config.username,
    hasPassword: Boolean(config.password),
    credentialsConfigured: hasRsdCredentials(config.environment),
    saleUrl: config.saleUrl,
    cancelUrl: config.cancelUrl,
    directToGln: config.directToGln,
    directPrescriptionId: config.directPrescriptionId,
    source: stored ? 'stored' : 'env',
  };
}

function clean(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

export async function updateRsdSettings(raw: RsdSettingsUpdate): Promise<RsdSettingsView> {
  const existing = await loadStoredSettings();
  const current = getRsdConfig();
  const base: RsdStoredSettings =
    existing ?? {
      mode: getRsdMode(),
      environment: getRsdEnvironment(),
      test: currentEnvSettings('test'),
      production: currentEnvSettings('production'),
      directToGln: current.directToGln,
      directPrescriptionId: current.directPrescriptionId,
      updatedAt: new Date(0).toISOString(),
    };

  const mode: RsdMode = raw.mode === 'live' ? 'live' : raw.mode === 'mock' ? 'mock' : base.mode;
  const environment: RsdEnvironment =
    raw.environment === 'production'
      ? 'production'
      : raw.environment === 'test'
        ? 'test'
        : base.environment;
  const active = base[environment];
  const password = typeof raw.password === 'string' && raw.password.trim() !== ''
    ? raw.password
    : active.password;
  const nextBlock: RsdEnvSettings = {
    gln: clean(raw.gln, active.gln),
    username: clean(raw.username, active.username),
    password,
    saleUrl: clean(raw.saleUrl, active.saleUrl),
    cancelUrl: clean(raw.cancelUrl, active.cancelUrl),
  };

  const next: RsdStoredSettings = {
    ...base,
    mode,
    environment,
    test: environment === 'test' ? nextBlock : base.test,
    production: environment === 'production' ? nextBlock : base.production,
    directToGln: clean(raw.directToGln, base.directToGln) || base.directToGln,
    directPrescriptionId:
      clean(raw.directPrescriptionId, base.directPrescriptionId) || base.directPrescriptionId,
    updatedAt: new Date().toISOString(),
  };

  const file = settingsFile();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(next, null, 2), 'utf8');
  applyStoredSettings(next);
  return getRsdSettingsView();
}
