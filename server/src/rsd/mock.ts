// A local stand-in for SFDA's two services, used by RSD_MODE=mock.
//
// It implements the parts of the real state machine that matter to this app:
//   * only a unit accepted into the pharmacy's inventory can be sold;
//   * the same unit cannot be sold twice;
//   * only a currently sold unit can be cancelled, and only once.
//
// Failure injection (serial prefixes) lets the trial suite exercise SOAP faults, HTTP 500 and
// network loss without touching SFDA:
//   FAULT-...   -> SOAP fault FC 98765
//   HTTP500-... -> HTTP 500
//   NET-...     -> connection reset
//   RC-#####-.. -> that return code (e.g. RC-11043-X)
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RsdUnit } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.join(__dirname, '..', '..', 'data', 'rsd-mock.json');

interface MockInventoryUnit extends RsdUnit {
  acceptedAt: string;
}

interface MockSale {
  gtin: string;
  serialNo: string;
  notificationId: string;
  soldAt: string;
  cancelledAt?: string;
  cancelNotificationId?: string;
}

interface MockState {
  inventory: MockInventoryUnit[];
  sales: MockSale[];
  counters: { sale: number; cancel: number };
}

export interface MockResponse {
  // null when the failure happened before HTTP (network/timeout), mirroring postSoap.
  httpStatus: number | null;
  rc?: string;
  message?: string;
  notificationId?: string;
  fault?: { code?: string; message: string };
  networkError?: string;
}

function dataFile(): string {
  return (process.env.RSD_MOCK_FILE ?? '').trim() || DEFAULT_FILE;
}

let writeChain: Promise<unknown> = Promise.resolve();

async function readState(): Promise<MockState> {
  try {
    const text = await readFile(dataFile(), 'utf8');
    const parsed = JSON.parse(text) as Partial<MockState>;
    return {
      inventory: Array.isArray(parsed.inventory) ? parsed.inventory : [],
      sales: Array.isArray(parsed.sales) ? parsed.sales : [],
      counters: {
        sale: Number(parsed.counters?.sale ?? 0) || 0,
        cancel: Number(parsed.counters?.cancel ?? 0) || 0,
      },
    };
  } catch {
    return { inventory: [], sales: [], counters: { sale: 0, cancel: 0 } };
  }
}

async function writeState(state: MockState): Promise<void> {
  const file = dataFile();
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await rename(tmp, file);
}

function mutate<T>(fn: (state: MockState) => T): Promise<T> {
  const run = writeChain.then(async () => {
    const state = await readState();
    const result = fn(state);
    await writeState(state);
    return result;
  });
  writeChain = run.catch(() => undefined);
  return run;
}

function injection(unit: RsdUnit): MockResponse | undefined {
  if (unit.serialNo.startsWith('NET-')) {
    return { httpStatus: null, networkError: 'Mock connection reset' };
  }
  if (unit.serialNo.startsWith('FAULT-')) {
    return { httpStatus: 400, fault: { code: '98765', message: 'Mock SOAP fault' } };
  }
  if (unit.serialNo.startsWith('HTTP500-')) {
    return { httpStatus: 500, message: 'Mock internal server error' };
  }
  const rc = /^RC-(\d{5})-/i.exec(unit.serialNo);
  if (rc) return { httpStatus: 200, rc: rc[1], message: `Mock return code ${rc[1]}` };
  return undefined;
}

// Mirrors Accept, which is outside this app's RSD scope but is what puts a unit into the
// pharmacy's RSD inventory. In mock mode it is how the trial suite prepares a sellable unit.
export function mockAcceptUnit(unit: RsdUnit): Promise<boolean> {
  return mutate((state) => {
    const exists = state.inventory.some(
      (u) => u.gtin === unit.gtin && u.serialNo === unit.serialNo,
    );
    if (exists) return false;
    state.inventory.push({ ...unit, acceptedAt: new Date().toISOString() });
    return true;
  });
}

export function mockReset(): Promise<void> {
  return mutate((state) => {
    state.inventory = [];
    state.sales = [];
    state.counters = { sale: 0, cancel: 0 };
  });
}

export function mockInventorySize(): Promise<number> {
  return readState().then((state) => state.inventory.length);
}

export function mockSendSale(unit: RsdUnit): Promise<MockResponse> {
  const injected = injection(unit);
  if (injected) return Promise.resolve(injected);

  return mutate((state) => {
    const accepted = state.inventory.find(
      (u) => u.gtin === unit.gtin && u.serialNo === unit.serialNo,
    );
    if (!accepted) {
      return {
        httpStatus: 200,
        rc: '11043',
        message: 'Unit is not in the pharmacy RSD inventory (supplier dispatch/accept missing).',
      } satisfies MockResponse;
    }
    if (accepted.batchNo !== unit.batchNo) {
      return { httpStatus: 200, rc: '11036', message: 'Batch number does not match the sold unit.' } satisfies MockResponse;
    }
    if (accepted.expiryDate !== unit.expiryDate) {
      return { httpStatus: 200, rc: '11035', message: 'Expiry date does not match the sold unit.' } satisfies MockResponse;
    }
    const active = state.sales.find(
      (s) => s.gtin === unit.gtin && s.serialNo === unit.serialNo && !s.cancelledAt,
    );
    if (active) {
      return { httpStatus: 200, rc: '10224', message: 'Product already sold by pharmacy.' } satisfies MockResponse;
    }
    state.counters.sale += 1;
    const notificationId = `MOCK-SALE-${String(state.counters.sale).padStart(6, '0')}`;
    state.sales.push({
      gtin: unit.gtin,
      serialNo: unit.serialNo,
      notificationId,
      soldAt: new Date().toISOString(),
    });
    return { httpStatus: 200, rc: '00000', notificationId } satisfies MockResponse;
  });
}

export function mockSendCancel(unit: RsdUnit): Promise<MockResponse> {
  const injected = injection(unit);
  if (injected) return Promise.resolve(injected);

  return mutate((state) => {
    const active = state.sales.find(
      (s) => s.gtin === unit.gtin && s.serialNo === unit.serialNo && !s.cancelledAt,
    );
    if (!active) {
      return {
        httpStatus: 200,
        rc: '98765',
        message: 'No active sale for this unit (already cancelled or never sold).',
      } satisfies MockResponse;
    }
    state.counters.cancel += 1;
    const notificationId = `MOCK-CANCEL-${String(state.counters.cancel).padStart(6, '0')}`;
    active.cancelledAt = new Date().toISOString();
    active.cancelNotificationId = notificationId;
    return { httpStatus: 200, rc: '00000', notificationId } satisfies MockResponse;
  });
}
