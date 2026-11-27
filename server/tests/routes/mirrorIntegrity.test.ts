// Route-level security regressions for SEC-03/04/05. The Express routers are exercised over HTTP
// with an in-memory Prisma double: no live database or destructive staging action is needed, and
// the assertions cover the exact SQL-mirror writes that must never cross branches or repeat.
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const state = {
  sales: [] as Row[],
  saleLines: [] as Row[],
  returns: [] as Row[],
  batches: [] as Row[],
  items: [] as Row[],
  events: [] as Row[],
};

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return (value as Row[]).some((part) => matches(row, part));
    if (key === 'qtyOnHand' && value && typeof value === 'object' && 'gte' in value) {
      return row[key] >= (value as Row).gte;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.entries(value as Row).every(([op, operand]) => {
        if (op === 'gte') return row[key] >= operand;
        if (op === 'gt') return row[key] > operand;
        if (op === 'increment') return true;
        if (op === 'decrement') return true;
        return false;
      });
    }
    return row[key] === value;
  });
}

const prismaMock = {
  $transaction: async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock),
  sale: {
    findFirst: async ({ where }: { where: Row }) => {
      const sale = state.sales.find((row) => matches(row, where));
      // Prisma's select includes the lines relation; mirror that shape for the route under test.
      return sale ? { ...sale, lines: state.saleLines.filter((line) => line.saleId === sale.id) } : null;
    },
    create: async ({ data }: { data: Row }) => {
      const { lines, payments, ...header } = data;
      const sale = { ...header, id: header.id ?? `sale-${state.sales.length}` };
      state.sales.push(sale);
      for (const line of lines.create) state.saleLines.push({ ...line, id: line.id ?? `line-${state.saleLines.length}`, saleId: sale.id });
      void payments;
      return sale;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const sale = state.sales.find((row) => matches(row, where));
      if (!sale) throw new Error('sale not found');
      Object.assign(sale, data);
      return sale;
    },
  },
  saleLine: {
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const line = state.saleLines.find((row) => matches(row, where));
      if (!line) throw new Error('saleLine not found');
      Object.assign(line, data);
      return line;
    },
  },
  returnRecord: {
    findFirst: async ({ where }: { where: Row }) => state.returns.find((row) => matches(row, where)) ?? null,
    create: async ({ data }: { data: Row }) => {
      const ret = { ...data, id: data.id ?? `return-${state.returns.length}` };
      state.returns.push(ret);
      return ret;
    },
  },
  batch: {
    findFirst: async ({ where }: { where: Row }) => state.batches.find((row) => matches(row, where)) ?? null,
    findUnique: async ({ where }: { where: Row }) => state.batches.find((row) => matches(row, where)) ?? null,
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const batch = state.batches.find((row) => matches(row, where));
      if (!batch) throw new Error('batch not found');
      const change = (data.qtyOnHand as Row | number);
      if (typeof change === 'number') batch.qtyOnHand = change;
      else if (change.increment !== undefined) batch.qtyOnHand += change.increment;
      else if (change.decrement !== undefined) batch.qtyOnHand -= change.decrement;
      return batch;
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const batch = state.batches.find((row) => matches(row, where));
      if (!batch) return { count: 0 };
      const change = data.qtyOnHand as Row;
      if (change.decrement !== undefined) batch.qtyOnHand -= change.decrement;
      if (change.increment !== undefined) batch.qtyOnHand += change.increment;
      return { count: 1 };
    },
    create: async ({ data }: { data: Row }) => {
      state.batches.push({ ...data });
      return data;
    },
  },
  item: {
    upsert: async ({ where, create }: { where: Row; create: Row }) => {
      const existing = state.items.find((row) => matches(row, where));
      if (existing) return existing;
      state.items.push({ ...create });
      return create;
    },
  },
  receivingBackupEvent: {
    findUnique: async ({ where }: { where: Row }) => state.events.find((row) => matches(row, where)) ?? null,
    create: async ({ data }: { data: Row }) => {
      state.events.push({ ...data });
      return data;
    },
  },
};

let server: Server;
let base: string;

beforeAll(async () => {
  vi.doMock('../../src/db/prisma.js', () => ({ prisma: prismaMock }));
  vi.doMock('../../src/branch.js', () => ({ terminalBranch: { id: 't1', configured: true } }));
  const { salesRouter } = await import('../../src/routes/sales.js');
  const { receivingRouter } = await import('../../src/routes/receiving.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).auth = { cashierId: 7, username: 'amal', fullName: 'Amal Saleh', roles: [], isAdmin: true, claims: {} };
    next();
  });
  app.use('/sales', salesRouter);
  app.use('/receiving', receivingRouter);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

beforeEach(() => {
  state.sales.length = 0;
  state.saleLines.length = 0;
  state.returns.length = 0;
  state.batches.length = 0;
  state.items.length = 0;
  state.events.length = 0;
});

function seedSale(branchId = 't1', qty = 5, returnedQty = 0) {
  state.sales.push({
    id: 'sale-1', invoiceNo: 'T1-SIM-000001', branchId, status: 'completed',
    pointsEarned: 10, pointsRedeemed: 0, pointsEarnedClawedBack: 0,
    pointsRedeemedRefunded: 0, totalIncentive: 5, totalIncentiveClawedBack: 0,
  });
  state.saleLines.push({
    id: 'line-1', saleId: 'sale-1', itemId: 'itm-1', batchNo: 'B1', qty, returnedQty,
  });
}

function seedBatch(qty = 10, branchId = 't1') {
  state.batches.push({
    id: 'bat-1', branchId, itemId: 'itm-1', batchNo: 'B1', qtyOnHand: qty,
  });
}

function salePayload(qty = 2) {
  return {
    id: 'sale-2', invoiceNo: 'T1-SIM-000002', invoiceType: 'simplified', date: new Date('2026-11-27T10:00:00Z').toISOString(),
    lines: [{
      id: 'line-2', itemId: 'itm-1', itemNameAr: '', itemNameEn: 'Paracetamol', batchId: 'bat-1', batchNo: 'B1',
      expiryDate: '2027-01-01', qty, unitPrice: 50, vatRate: 0.15, discountAmount: 0, netExclVat: qty * 50,
      vatAmount: Math.round(qty * 50 * 0.15 * 100) / 100, totalInclVat: Math.round(qty * 50 * 1.15 * 100) / 100,
      returnedQty: 0,
    }],
    subtotalExclVat: qty * 50, totalDiscount: 0,
    totalVatAmount: Math.round(qty * 50 * 0.15 * 100) / 100,
    totalInclVat: Math.round(qty * 50 * 1.15 * 100) / 100,
    payments: [{ method: 'cash', amount: Math.round(qty * 50 * 1.15 * 100) / 100 }],
    zatcaQrBase64: 'base64', zatcaStatus: 'phase1_fallback', status: 'completed', cashierName: 'forged',
  };
}

function returnPayload(qty = 2, overrides: Record<string, unknown> = {}) {
  return {
    id: 'return-1', returnNo: 'T1-CN-000001', date: new Date('2026-11-27T11:00:00Z').toISOString(),
    originalInvoiceId: 'sale-1', originalInvoiceNo: 'T1-SIM-000001',
    lines: [{ saleLineId: 'line-1', itemNameEn: 'Paracetamol', qty, refundAmount: qty * 57.5 }],
    totalRefund: qty * 57.5, reason: 'damaged', updatedInvoiceStatus: 'returned',
    updatedInvoicePointsEarnedClawedBack: 4, updatedLineReturnedQtys: [{ lineId: 'line-1', returnedQty: qty }],
    ...overrides,
  };
}

function receivingPayload(qty = 10) {
  return {
    receivingId: 'rcv-1', batchId: 'bat-new', itemId: 'itm-1', itemNameAr: '', itemNameEn: 'Paracetamol',
    batchNo: 'B2', expiryDate: '2027-01-01', receivedDate: '2026-11-27', qty,
    purchasePrice: 10, purchaseDiscountPercent: 0, costPrice: 10,
  };
}

async function post(path: string, body: unknown) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('sales mirror (SEC-03/04)', () => {
  it('records a valid sale once, with the branch and cashier derived server-side', async () => {
    seedBatch(10);
    const res = await post('/sales', salePayload());
    expect(res.status).toBe(201);
    expect(state.batches[0].qtyOnHand).toBe(8);
    expect(state.sales[0]).toMatchObject({ branchId: 't1', cashierName: 'Amal Saleh', status: 'completed' });

    const replay = await post('/sales', salePayload());
    expect(replay.status).toBe(200);
    expect(state.batches[0].qtyOnHand).toBe(8);
    expect(state.sales).toHaveLength(1);
  });

  it('rejects negative quantities and insufficient stock without touching the shelf', async () => {
    seedBatch(1);
    expect((await post('/sales', salePayload(-1))).status).toBe(400);
    expect((await post('/sales', salePayload(2))).status).toBe(409);
    expect(state.batches[0].qtyOnHand).toBe(1);
    expect(state.sales).toHaveLength(0);
  });

  it('refuses to modify another branch\'s invoice through a return', async () => {
    seedSale('t2');
    seedBatch(10);
    const res = await post('/sales/returns', returnPayload());
    expect(res.status).toBe(409);
    expect(state.batches[0].qtyOnHand).toBe(10);
    expect(state.returns).toHaveLength(0);
    expect(state.sales[0].status).toBe('completed');
  });

  it('restocks and updates a same-branch return exactly once', async () => {
    seedSale('t1');
    seedBatch(10);
    expect((await post('/sales/returns', returnPayload())).status).toBe(201);
    expect(state.batches[0].qtyOnHand).toBe(12);
    expect(state.saleLines[0].returnedQty).toBe(2);
    expect(state.sales[0].status).toBe('partially_returned');

    expect((await post('/sales/returns', returnPayload())).status).toBe(200);
    expect(state.batches[0].qtyOnHand).toBe(12);
    expect(state.returns).toHaveLength(1);
  });

  it('accumulates successive partial returns into a full return', async () => {
    seedSale('t1', 5);
    seedBatch(10);
    expect((await post('/sales/returns', returnPayload(2))).status).toBe(201);
    expect((await post('/sales/returns', returnPayload(3, { id: 'return-2', returnNo: 'T1-CN-000002' }))).status).toBe(201);
    expect(state.saleLines[0].returnedQty).toBe(5);
    expect(state.sales[0].status).toBe('returned');
    expect(state.batches[0].qtyOnHand).toBe(15);
  });

  it('rejects a return quantity above the returnable balance', async () => {
    seedSale('t1', 1);
    seedBatch(10);
    expect((await post('/sales/returns', returnPayload(2))).status).toBe(400);
    expect(state.batches[0].qtyOnHand).toBe(10);
  });
});

describe('receiving mirror (SEC-05)', () => {
  it('rejects negative deliveries', async () => {
    expect((await post('/receiving', receivingPayload(-5))).status).toBe(400);
    expect(state.batches).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it('adds stock once and treats a replayed event id as a no-op', async () => {
    expect((await post('/receiving', receivingPayload())).status).toBe(201);
    expect(state.batches[0]).toMatchObject({ branchId: 't1', batchNo: 'B2', qtyOnHand: 10 });
    expect((await post('/receiving', receivingPayload())).status).toBe(200);
    expect(state.batches).toHaveLength(1);
    expect(state.batches[0].qtyOnHand).toBe(10);
    expect(state.events).toHaveLength(1);
  });

  it('reverses a delivery once, never below zero, and dedupes the reversal', async () => {
    seedBatch(3, 't1');
    const payload = { reversalId: 'rev-inv-1-itm-1-B1', itemId: 'itm-1', batchNo: 'B1', qty: 5 };
    expect((await post('/receiving/reverse', payload)).status).toBe(409);
    expect(state.batches[0].qtyOnHand).toBe(3);

    expect((await post('/receiving/reverse', { ...payload, qty: 2 })).status).toBe(200);
    expect((await post('/receiving/reverse', { ...payload, qty: 2 })).status).toBe(200);
    expect(state.batches[0].qtyOnHand).toBe(1);
    expect(state.events).toHaveLength(1);
  });
});
