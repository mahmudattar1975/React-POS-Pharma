// The service is where money-adjacent rules live: never report the same pack twice, never cancel a
// pack whose sale SFDA did not accept, and never let an automatic retry duplicate a movement.
// These tests run the real service against the mock SFDA state machine and a temp ledger.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RsdUnit } from '../../src/rsd/types';
import {
  acceptMockUnit,
  getStatus,
  listRecords,
  reopenRejected,
  reportCancel,
  reportSale,
  resetMock,
  unitStatus,
} from '../../src/rsd/service';

const UNIT: RsdUnit = {
  gtin: '06281007320021',
  serialNo: 'SN123456',
  batchNo: 'AX24C09',
  expiryDate: '2027-05-31',
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'rsd-test-'));
  process.env.RSD_MODE = 'mock';
  process.env.RSD_ENV = 'test';
  process.env.RSD_DATA_FILE = path.join(dir, 'ledger.json');
  process.env.RSD_MOCK_FILE = path.join(dir, 'mock.json');
  await resetMock();
});

afterEach(async () => {
  delete process.env.RSD_MODE;
  delete process.env.RSD_ENV;
  delete process.env.RSD_DATA_FILE;
  delete process.env.RSD_MOCK_FILE;
  await rm(dir, { recursive: true, force: true });
});

async function accept(...units: RsdUnit[]): Promise<void> {
  for (const unit of units) {
    const result = await acceptMockUnit(unit);
    expect(result.accepted).toBe(true);
  }
}

describe('Pharmacy Sale', () => {
  it('sends an accepted unit and stores the success + notification id', async () => {
    await accept(UNIT);
    const result = await reportSale(UNIT);

    expect(result.outcome).toBe('sent');
    expect(result.record.rc).toBe('00000');
    expect(result.record.status).toBe('sent');
    expect(result.record.notificationId).toMatch(/^MOCK-SALE-/);
    expect(result.record.attempts).toHaveLength(1);
    expect(result.record.attempts[0].status).toBe('sent');
  });

  it('returns the same record on a duplicate and never sends again', async () => {
    await accept(UNIT);
    const first = await reportSale(UNIT);
    const second = await reportSale(UNIT);

    expect(first.outcome).toBe('sent');
    expect(second.outcome).toBe('already_reported');
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.attempts).toHaveLength(1);

    const sales = await listRecords({ kind: 'sale' });
    expect(sales.total).toBe(1);
  });

  it('refuses a serial that is not in the pharmacy inventory (11043, terminal)', async () => {
    const result = await reportSale(UNIT);
    expect(result.outcome).toBe('rejected');
    expect(result.record.rc).toBe('11043');
    expect(result.record.retryable).toBe(false);
  });

  it('does not resend an identical rejected payload', async () => {
    await accept(UNIT);
    const wrong = { ...UNIT, batchNo: 'WRONG-BATCH' };
    const first = await reportSale(wrong);
    const second = await reportSale(wrong);

    expect(first.outcome).toBe('rejected');
    expect(first.record.rc).toBe('11036');
    expect(second.outcome).toBe('rejected');
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.attempts).toHaveLength(1);
  });

  it('retries the same record once a rejected payload is corrected', async () => {
    await accept(UNIT);
    const first = await reportSale({ ...UNIT, batchNo: 'WRONG-BATCH' });
    const corrected = await reportSale(UNIT);

    expect(first.outcome).toBe('rejected');
    expect(corrected.outcome).toBe('sent');
    expect(corrected.record.id).toBe(first.record.id);
    expect(corrected.record.attempts).toHaveLength(2);
    expect(corrected.record.batchNo).toBe('AX24C09');
  });

  it('reopens a rejection caused by the account and resends the same payload', async () => {
    // Rejected because the unit was not in inventory yet; the operator then fixes the inventory
    // (or the account privilege) and explicitly reopens the record.
    const first = await reportSale(UNIT);
    expect(first.outcome).toBe('rejected');
    await accept(UNIT);

    const reopened = await reopenRejected('sale', UNIT.gtin, UNIT.serialNo);
    expect(reopened?.status).toBe('failed');
    expect(reopened?.retryable).toBe(true);

    const retried = await reportSale(UNIT);
    expect(retried.outcome).toBe('sent');
    expect(retried.record.id).toBe(first.record.id);
    expect(retried.record.attempts).toHaveLength(2);
  });

  it('never reopens a sale SFDA already accepted', async () => {
    await accept(UNIT);
    const sale = await reportSale(UNIT);
    expect(sale.outcome).toBe('sent');

    const reopened = await reopenRejected('sale', UNIT.gtin, UNIT.serialNo);
    expect(reopened?.status).toBe('sent');
    expect((await unitStatus(UNIT.gtin, UNIT.serialNo)).sale?.status).toBe('sent');
  });

  it('treats HTTP 500 and connection loss as retryable without creating new records', async () => {
    const flaky: RsdUnit = { ...UNIT, serialNo: 'HTTP500-TEST-1' };
    const offline: RsdUnit = { ...UNIT, serialNo: 'NET-TEST-1' };

    const first = await reportSale(flaky);
    expect(first.outcome).toBe('failed');
    expect(first.record.retryable).toBe(true);

    const second = await reportSale(flaky);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.attempts).toHaveLength(2);

    const lost = await reportSale(offline);
    expect(lost.outcome).toBe('failed');
    expect(lost.record.retryable).toBe(true);
  });

  it('serialises concurrent reports of the same unit into one send', async () => {
    await accept(UNIT);
    const results = await Promise.all([reportSale(UNIT), reportSale(UNIT)]);
    const outcomes = results.map((r) => r.outcome).sort();

    expect(outcomes).toEqual(['already_reported', 'sent']);
    expect((await listRecords({ kind: 'sale' })).total).toBe(1);
    expect((await unitStatus(UNIT.gtin, UNIT.serialNo)).sale?.attempts).toHaveLength(1);
  });
});

describe('Pharmacy Sale Cancel', () => {
  it('cancels a sold unit using the sale context', async () => {
    await accept(UNIT);
    const sale = await reportSale({ ...UNIT, toGln: '6286479000015' });
    const cancel = await reportCancel(UNIT);

    expect(cancel.outcome).toBe('sent');
    expect(cancel.record.kind).toBe('cancel');
    expect(cancel.record.toGln).toBe('6286479000015');
    expect(cancel.record.notificationId).toMatch(/^MOCK-CANCEL-/);
    expect(sale.record.status).toBe('sent');
  });

  it('returns already_cancelled on a duplicate cancel and never sends again', async () => {
    await accept(UNIT);
    await reportSale(UNIT);
    const first = await reportCancel(UNIT);
    const second = await reportCancel(UNIT);

    expect(first.outcome).toBe('sent');
    expect(second.outcome).toBe('already_cancelled');
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.attempts).toHaveLength(1);
    expect((await listRecords({ kind: 'cancel' })).total).toBe(1);
  });

  it('refuses to cancel before any sale exists', async () => {
    await expect(reportCancel(UNIT)).rejects.toMatchObject({ code: 'sale_not_reported' });
    expect((await listRecords({ kind: 'cancel' })).total).toBe(0);
    expect((await listRecords({ kind: 'sale' })).total).toBe(0);
  });

  it('refuses to cancel a sale RSD never accepted', async () => {
    const failed: RsdUnit = { ...UNIT, serialNo: 'NET-TEST-2' };
    const sale = await reportSale(failed);
    expect(sale.outcome).toBe('failed');

    await expect(reportCancel(failed)).rejects.toMatchObject({ code: 'sale_not_sent' });
    expect((await listRecords({ kind: 'cancel' })).total).toBe(0);
  });
});

describe('status', () => {
  it('counts accepted sales and cancels without exposing credentials', async () => {
    await accept(UNIT);
    await reportSale(UNIT);
    await reportCancel(UNIT);

    const status = await getStatus();
    expect(status.mode).toBe('mock');
    expect(status.environment).toBe('test');
    expect(status.ledger).toMatchObject({ records: 2, salesSent: 1, cancelsSent: 1, pendingOrFailed: 0 });
    expect(status).not.toHaveProperty('password');
    expect(status).not.toHaveProperty('username');
  });
});
