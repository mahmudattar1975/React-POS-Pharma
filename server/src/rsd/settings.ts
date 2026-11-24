// Server side of the Settings > RSD panel. The browser can read the non-secret fields, save new
// values, and run a read-only WSDL probe - it never receives a password and never speaks SOAP to
// SFDA itself. This mirrors src/api/rsdApi.ts, which is the only client of these routes.
import {
  getRsdConfig,
  getRsdCredentials,
  hasRsdAuth,
  hasRsdCredentials,
  loadRsdStoredSettings,
  saveRsdStoredSettings,
  type RsdStoredSettings,
} from './config.js';
import { badRequest } from './errors.js';
import { probeWsdl } from './soapClient.js';
import type { RsdEnvironment, RsdMode } from './types.js';

export interface RsdSettingsView {
  mode: RsdMode;
  environment: RsdEnvironment;
  gln: string;
  username: string;
  // The password itself is never returned, only whether one is available to the adapter.
  hasPassword: boolean;
  credentialsConfigured: boolean;
  saleUrl: string;
  cancelUrl: string;
  directToGln: string;
  directPrescriptionId: string;
  source: 'stored' | 'env';
}

export interface RsdConnectionCheck {
  name: 'sale' | 'cancel' | 'mock';
  ok: boolean;
  httpStatus?: number | null;
  message?: string;
  operations?: string[];
}

export interface RsdConnectionTest {
  ok: boolean;
  mode: RsdMode;
  environment: RsdEnvironment;
  checkedAt: string;
  checks: RsdConnectionCheck[];
}

export function rsdSettingsView(): RsdSettingsView {
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
    source: Object.keys(loadRsdStoredSettings()).length > 0 ? 'stored' : 'env',
  };
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw badRequest(`${field} must be a string.`);
  return value.trim();
}

// Saving settings writes the complete record. A blank password means "keep the one already stored"
// (or keep using the .env value), so the UI never has to round-trip the secret.
export function updateRsdSettings(input: unknown): RsdSettingsView {
  const body = (input ?? {}) as Partial<RsdStoredSettings>;
  const mode = text(body.mode, 'mode');
  if (mode !== 'mock' && mode !== 'live') throw badRequest('mode must be "mock" or "live".');
  const environment = text(body.environment, 'environment');
  if (environment !== 'test' && environment !== 'production') {
    throw badRequest('environment must be "test" or "production".');
  }
  const saleUrl = text(body.saleUrl, 'saleUrl');
  const cancelUrl = text(body.cancelUrl, 'cancelUrl');
  if (environment === 'production' && (!saleUrl.startsWith('https://') || !cancelUrl.startsWith('https://'))) {
    // Same guard as the send path: never let a saved setting become a way to put Basic credentials
    // on the wire in clear text.
    throw badRequest('Production RSD endpoints must use https://; refusing plain HTTP.', 'rsd_insecure_endpoint');
  }
  const previous = loadRsdStoredSettings();
  const passwordInput = typeof body.password === 'string' ? body.password.trim() : '';
  const settings: RsdStoredSettings = {
    mode,
    environment,
    gln: text(body.gln, 'gln'),
    username: text(body.username, 'username'),
    password: passwordInput || previous.password || '',
    saleUrl,
    cancelUrl,
    directToGln: text(body.directToGln, 'directToGln'),
    directPrescriptionId: text(body.directPrescriptionId, 'directPrescriptionId'),
  };
  saveRsdStoredSettings(settings);
  return rsdSettingsView();
}

function probeCheck(
  name: 'sale' | 'cancel',
  result: Awaited<ReturnType<typeof probeWsdl>>,
): RsdConnectionCheck {
  const ok = result.httpStatus === 200 && result.bytes > 0 && !result.networkError;
  return {
    name,
    ok,
    httpStatus: result.httpStatus,
    operations: result.operations,
    message: ok
      ? 'WSDL reachable with the stored credentials; no sale or cancel was sent.'
      : result.networkError
        ? `Network failure: ${result.networkError}`
        : result.httpStatus
          ? `WSDL request answered HTTP ${result.httpStatus}; check the URL and credentials.`
          : 'WSDL request did not complete.',
  };
}

// Read-only: fetching a WSDL cannot move a unit. Safe to press before a live trial or after saving
// new credentials, unlike a dummy sale which would have to be cancelled again.
export async function testRsdConnection(): Promise<RsdConnectionTest> {
  const config = getRsdConfig();
  const base = { mode: config.mode, environment: config.environment, checkedAt: new Date().toISOString() };
  if (config.mode === 'mock') {
    return {
      ...base,
      ok: true,
      checks: [{ name: 'mock', ok: true, message: 'Mock mode - SFDA is never contacted.' }],
    };
  }
  if (!config.saleUrl || !config.cancelUrl) {
    return {
      ...base,
      ok: false,
      checks: [
        { name: 'sale', ok: false, message: 'Sale service URL is not configured.' },
        { name: 'cancel', ok: false, message: 'Cancel service URL is not configured.' },
      ],
    };
  }
  if (!hasRsdAuth(config.environment)) {
    return {
      ...base,
      ok: false,
      checks: [
        { name: 'sale', ok: false, message: 'Username or password is missing.' },
        { name: 'cancel', ok: false, message: 'Username or password is missing.' },
      ],
    };
  }
  if (config.environment === 'production' &&
      (!config.saleUrl.startsWith('https://') || !config.cancelUrl.startsWith('https://'))) {
    return {
      ...base,
      ok: false,
      checks: [
        { name: 'sale', ok: false, message: 'Production endpoint must use https://; credentials were not sent.' },
        { name: 'cancel', ok: false, message: 'Production endpoint must use https://; credentials were not sent.' },
      ],
    };
  }
  const creds = getRsdCredentials(config.environment);
  const [sale, cancel] = await Promise.all([
    probeWsdl(config.saleUrl, creds, config.timeoutMs),
    probeWsdl(config.cancelUrl, creds, config.timeoutMs),
  ]);
  const checks = [probeCheck('sale', sale), probeCheck('cancel', cancel)];
  return { ...base, ok: checks.every((c) => c.ok), checks };
}
