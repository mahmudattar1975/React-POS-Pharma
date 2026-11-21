// RSD configuration, read from the environment on every call.
//
// Credentials live only here (server/.env, which is gitignored) - never in the browser bundle,
// never in localStorage, and never returned by an API. The browser only ever sees booleans such
// as `credentialsConfigured`.
//
// Two independent switches:
//   RSD_MODE=mock|live  - mock runs the whole pipeline against a local simulated SFDA, so the
//                         app and the trial harness work before credentials arrive.
//   RSD_ENV=test|production - which credential pair and endpoint to use.
//
// Safe defaults: mock + test. Live production is only ever reached when both switches are set
// explicitly, because a Pharmacy Sale in production is a real national track-and-trace movement.
import type { RsdEnvironment, RsdMode } from './types.js';

const DEFAULT_PROD_SALE_URL =
  'https://rsd.sfda.gov.sa/ws/PharmacySaleService/PharmacySaleService';
const DEFAULT_PROD_CANCEL_URL =
  'https://rsd.sfda.gov.sa/ws/PharmacySaleCancelService/PharmacySaleCancelService';

export interface RsdCredentials {
  gln: string;
  username: string;
  password: string;
}

export interface RsdConfig {
  mode: RsdMode;
  environment: RsdEnvironment;
  gln: string;
  username: string;
  password: string;
  saleUrl: string;
  cancelUrl: string;
  timeoutMs: number;
  directToGln: string;
  directPrescriptionId: string;
}

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

export function getRsdMode(): RsdMode {
  return env('RSD_MODE').toLowerCase() === 'live' ? 'live' : 'mock';
}

export function getRsdEnvironment(): RsdEnvironment {
  return env('RSD_ENV').toLowerCase() === 'production' ? 'production' : 'test';
}

// Names are exposed (never values) so a 503 can tell the operator exactly what to fill in.
export function credentialsEnvNames(environment: RsdEnvironment): string[] {
  const prefix = environment === 'production' ? 'RSD_PROD' : 'RSD_TEST';
  return [`${prefix}_GLN`, `${prefix}_USERNAME`, `${prefix}_PASSWORD`];
}

export function getRsdCredentials(environment = getRsdEnvironment()): RsdCredentials {
  const prefix = environment === 'production' ? 'RSD_PROD' : 'RSD_TEST';
  return {
    gln: env(`${prefix}_GLN`),
    username: env(`${prefix}_USERNAME`),
    password: env(`${prefix}_PASSWORD`),
  };
}

export function hasRsdAuth(environment = getRsdEnvironment()): boolean {
  const creds = getRsdCredentials(environment);
  return Boolean(creds.username && creds.password);
}

export function hasRsdCredentials(environment = getRsdEnvironment()): boolean {
  const creds = getRsdCredentials(environment);
  return Boolean(creds.gln && creds.username && creds.password);
}

function endpoint(environment: RsdEnvironment, kind: 'sale' | 'cancel'): string {
  const prefix = environment === 'production' ? 'RSD_PROD' : 'RSD_TEST';
  const explicit = env(`${prefix}_${kind.toUpperCase()}_URL`);
  if (explicit) return explicit;
  // Test has no published default. Refusing to guess is deliberate: silently falling back to the
  // production URLs would turn a sandbox trial into real traffic.
  if (environment === 'test') return '';
  return kind === 'sale' ? DEFAULT_PROD_SALE_URL : DEFAULT_PROD_CANCEL_URL;
}

export function getRsdConfig(): RsdConfig {
  const environment = getRsdEnvironment();
  const creds = getRsdCredentials(environment);
  const timeout = Number(env('RSD_TIMEOUT_MS') || 20_000);
  return {
    mode: getRsdMode(),
    environment,
    ...creds,
    saleUrl: endpoint(environment, 'sale'),
    cancelUrl: endpoint(environment, 'cancel'),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 20_000,
    // The portal's "Direct Sale" (patient at the counter) uses the all-zero to-GLN in the field
    // guide's verified envelope. A payer GLN can be supplied per sale instead.
    directToGln: env('RSD_DIRECT_TO_GLN') || '0000000000000',
    // PRESCRIPTIONID is part of the verified element ordering. Direct/OTC sales have no real
    // prescription id, so a stable placeholder is used until the ISD says otherwise.
    directPrescriptionId: env('RSD_DIRECT_PRESCRIPTION_ID') || 'DIRECT-SALE',
  };
}
