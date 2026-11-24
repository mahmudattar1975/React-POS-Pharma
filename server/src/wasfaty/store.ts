// Durable-enough operational store for Wasfaty dispenses and claims.
//
// The browser's own sale is the tax/clinical record and lives in localStorage + the sales mirror.
// This file is the CLAIM ledger: which dispense went to NUPCO, under which authorization, and what
// was reported/paid. It must therefore be append-friendly and idempotent - a retried mirror of the
// same sale must return the SAME dispense and claim, never a duplicate claim.
//
// Writes are serialised through one promise chain (the pattern server/src/store/invoiceArchive.ts
// already uses): two tills completing a dispense at the same moment would otherwise read-modify-
// write this JSON and silently lose one claim.
//
// Like the rest of server/src/store, this is DEV-GRADE plaintext on disk. It contains patient ID
// last-4 only (never the full national ID) and no credentials, but production still needs an
// access-controlled database with a backup policy.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WasfatyClaim, WasfatyDispenseRecord } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.join(__dirname, '..', '..', 'data', 'wasfaty.json');

interface WasfatyState {
  dispenses: WasfatyDispenseRecord[];
  claims: WasfatyClaim[];
  counters: { dispense: number; claim: number };
}

const EMPTY: WasfatyState = { dispenses: [], claims: [], counters: { dispense: 0, claim: 0 } };

function dataFile(): string {
  return (process.env.WASFATY_DATA_FILE ?? '').trim() || DEFAULT_FILE;
}

let writeChain: Promise<unknown> = Promise.resolve();

async function readState(): Promise<WasfatyState> {
  try {
    const text = await readFile(dataFile(), 'utf8');
    const parsed = JSON.parse(text) as Partial<WasfatyState>;
    return {
      dispenses: Array.isArray(parsed.dispenses) ? parsed.dispenses : [],
      claims: Array.isArray(parsed.claims) ? parsed.claims : [],
      counters: {
        dispense: Number(parsed.counters?.dispense ?? 0) || 0,
        claim: Number(parsed.counters?.claim ?? 0) || 0,
      },
    };
  } catch {
    return { dispenses: [], claims: [], counters: { dispense: 0, claim: 0 } };
  }
}

async function writeState(state: WasfatyState): Promise<void> {
  const file = dataFile();
  await mkdir(path.dirname(file), { recursive: true });
  // Write-then-rename so a crash mid-write cannot leave a truncated claim ledger behind.
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await rename(tmp, file);
}

// Every mutation goes through this single serialised chain. The callback's return value is handed
// back to the caller, so an idempotent "find or create" can be expressed in one pass.
export function mutateState<T>(fn: (state: WasfatyState) => T | Promise<T>): Promise<T> {
  const run = writeChain.then(async () => {
    const state = await readState();
    const result = await fn(state);
    await writeState(state);
    return result;
  });
  // Keep the chain alive after a failed mutation (e.g. validation throw) so later writes still run.
  writeChain = run.catch(() => undefined);
  return run;
}

export async function readOnlyState(): Promise<WasfatyState> {
  return readState();
}

export function nextDispenseId(state: WasfatyState): string {
  state.counters.dispense += 1;
  return `WDSP-${String(state.counters.dispense).padStart(6, '0')}`;
}

export function nextClaimId(state: WasfatyState): string {
  state.counters.claim += 1;
  return `WCLM-${String(state.counters.claim).padStart(6, '0')}`;
}

export function findDispense(state: WasfatyState, id: string): WasfatyDispenseRecord | undefined {
  return state.dispenses.find((d) => d.id === id || d.nupcoDispenseId === id);
}

export function findDispenseBySale(state: WasfatyState, saleId: string): WasfatyDispenseRecord | undefined {
  return state.dispenses.find((d) => d.saleId === saleId);
}

export function findClaim(state: WasfatyState, id: string): WasfatyClaim | undefined {
  return state.claims.find((c) => c.id === id);
}

export function claimForDispense(state: WasfatyState, dispenseId: string): WasfatyClaim | undefined {
  return state.claims.find((c) => c.dispenseId === dispenseId);
}

export function resetStoreForTest(): void {
  writeChain = Promise.resolve();
}

export { EMPTY as EMPTY_WASFATY_STATE };
