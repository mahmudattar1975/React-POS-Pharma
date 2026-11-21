// HTTP surface for the RSD adapter. Mounted at /api/rsd.
//
// This is the contract the browser's sale mirror uses (src/api/rsdApi.ts). Credentials never
// appear in any request or response: the browser only learns whether they are configured.
//
// Reporting is deliberately synchronous per unit. The POS calls this after the sale is already
// saved locally; a 5xx/503 means "not reported yet, queue a retry", never "the sale failed".
import { Router, type Request, type Response } from 'express';
import { RsdApiError } from '../rsd/errors.js';
import {
  acceptMockUnit,
  getStatus,
  listRecords,
  reportCancel,
  reportSale,
  resetMock,
  unitStatus,
} from '../rsd/service.js';
import type { RsdCancelInput, RsdRecordStatus, RsdSaleInput, RsdUnit } from '../rsd/types.js';

export const rsdRouter = Router();

function fail(res: Response, err: unknown): void {
  if (err instanceof RsdApiError) {
    res.status(err.status).json({ error: err.message, code: err.code, retryable: err.retryable });
    return;
  }
  console.error('[rsd] unexpected error:', err);
  res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
}

function query(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

rsdRouter.get('/status', async (_req, res) => {
  try {
    res.json(await getStatus());
  } catch (err) {
    fail(res, err);
  }
});

// Report one sold pack. Idempotent on GTIN + serial: replaying the same unit returns the original
// record instead of a second sale.
rsdRouter.post('/sales', async (req, res) => {
  try {
    res.json(await reportSale(req.body as RsdSaleInput));
  } catch (err) {
    fail(res, err);
  }
});

// Report the cancellation of one pack (a full return). Refused unless the sale was accepted.
rsdRouter.post('/sales/cancel', async (req, res) => {
  try {
    res.json(await reportCancel(req.body as RsdCancelInput));
  } catch (err) {
    fail(res, err);
  }
});

async function reports(req: Request, res: Response): Promise<void> {
  try {
    res.json(
      await listRecords({
        kind: query(req, 'kind') === 'cancel' ? 'cancel' : query(req, 'kind') === 'sale' ? 'sale' : undefined,
        status: query(req, 'status') as RsdRecordStatus | undefined,
        invoiceId: query(req, 'invoiceId'),
        invoiceNo: query(req, 'invoiceNo'),
        limit: query(req, 'limit') ? Number(query(req, 'limit')) : undefined,
      }),
    );
  } catch (err) {
    fail(res, err);
  }
}

rsdRouter.get('/reports', reports);
rsdRouter.get('/records', reports);

rsdRouter.get('/units/:gtin/:serialNo', async (req, res) => {
  try {
    res.json(await unitStatus(req.params.gtin, req.params.serialNo));
  } catch (err) {
    fail(res, err);
  }
});

// Mock-only stand-ins for Accept, used to prepare sellable units for the offline trial.
rsdRouter.post('/mock/accept', async (req, res) => {
  try {
    res.json(await acceptMockUnit(req.body as RsdUnit));
  } catch (err) {
    fail(res, err);
  }
});

rsdRouter.post('/mock/reset', async (_req, res) => {
  try {
    await resetMock();
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});
