// Append-oriented reporting ledger for RSD.
//
// Every sale/cancel attempt is kept forever, including rejections and the raw SOAP request and
// response. That is the audit trail an SFDA inspection asks for, and it is also what makes a
// retry safe: a unit whose sale already returned RC 00000 can never be sent a second time.
//
// Writes go through one promise chain (the same pattern as wasfaty/store.ts and
// store/invoiceArchive.ts): two tills reporting at the same moment would otherwise read-modify-
// write this JSON and lose an event.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RsdRecord } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.join(__dirname, '..', '..', 'data', 'rsd-ledger.json');

export interface RsdLedgerState {
  records: RsdRecord[];
  counters: { record: number };
}

function dataFile(): string {
  return (process.env.RSD_DATA_FILE ?? '').trim() || DEFAULT_FILE;
}

let writeChain: Promise<unknown> = Promise.resolve();

async function readState(): Promise<RsdLedgerState> {
  try {
    const text = await readFile(dataFile(), 'utf8');
    const parsed = JSON.parse(text) as Partial<RsdLedgerState>;
    return {
      records: Array.isArray(parsed.records) ? parsed.records : [],
      counters: { record: Number(parsed.counters?.record ?? 0) || 0 },
    };
  } catch {
    return { records: [], counters: { record: 0 } };
  }
}

async function writeState(state: RsdLedgerState): Promise<void> {
  const file = dataFile();
  await mkdir(path.dirname(file), { recursive: true });
  // Write-then-rename: a crash mid-write must not truncate the audit trail.
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await rename(tmp, file);
}

// The callback both mutates and may perform the (awaited) network send. Keeping the send inside
// the serialised section is deliberate: it guarantees two concurrent reports for the same unit
// cannot both observe "no sale yet" and send twice.
export function mutateLedger<T>(fn: (state: RsdLedgerState) => T | Promise<T>): Promise<T> {
  const run = writeChain.then(async () => {
    const state = await readState();
    const result = await fn(state);
    await writeState(state);
    return result;
  });
  // Keep later writes alive after a validation throw.
  writeChain = run.catch(() => undefined);
  return run;
}

export async function readLedger(): Promise<RsdLedgerState> {
  return readState();
}

export function nextRecordId(state: RsdLedgerState): string {
  state.counters.record += 1;
  return `RSD-${String(state.counters.record).padStart(6, '0')}`;
}

// A unit is identified by GTIN + SN. There is at most one sale and one cancel record per unit.
export function findSaleRecord(
  state: RsdLedgerState,
  gtin: string,
  serialNo: string,
): RsdRecord | undefined {
  return state.records.find(
    (r) => r.kind === 'sale' && r.gtin === gtin && r.serialNo === serialNo,
  );
}

export function findCancelRecord(
  state: RsdLedgerState,
  gtin: string,
  serialNo: string,
): RsdRecord | undefined {
  return state.records.find(
    (r) => r.kind === 'cancel' && r.gtin === gtin && r.serialNo === serialNo,
  );
}
