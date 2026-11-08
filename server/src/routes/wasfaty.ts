// HTTP surface for this app's provider-neutral Wasfaty API. Mounted at /api/wasfaty.
//
// This is the contract the browser uses (src/api/wasfatyApi.ts). It is stable regardless of which
// adapter is active, which is what lets the POS move from `manual` to `mock` to a live NUPCO
// connection without a frontend change. See Wasfaty-API.md and GET /api/wasfaty/openapi.json.
import { Router, type Request, type Response } from 'express';
import { WasfatyApiError } from '../wasfaty/errors.js';
import { wasfatyOpenApi } from '../wasfaty/openapi.js';
import {
  cancelDispense,
  createDispense,
  getDispense,
  health,
  listClaims,
  listDispenses,
  lookupPrescription,
  reconcileClaim,
  requestAuthorization,
  submitClaim,
} from '../wasfaty/service.js';
import type { WasfatyManualDispenseInput } from '../wasfaty/types.js';

export const wasfatyRouter = Router();

function fail(res: Response, err: unknown): void {
  if (err instanceof WasfatyApiError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  console.error('[wasfaty] unexpected error:', err);
  res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
}

function query(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

wasfatyRouter.get('/health', async (_req, res) => {
  try {
    res.json(await health());
  } catch (err) {
    fail(res, err);
  }
});

wasfatyRouter.get('/openapi.json', (_req, res) => {
  res.json(wasfatyOpenApi);
});

wasfatyRouter.post('/prescriptions/lookup', async (req, res) => {
  try {
    res.json(
      await lookupPrescription({
        prescriptionNo: String(req.body?.prescriptionNo ?? ''),
        patientNationalId: req.body?.patientNationalId ? String(req.body.patientNationalId) : undefined,
      }),
    );
  } catch (err) {
    fail(res, err);
  }
});

wasfatyRouter.post('/authorizations', async (req, res) => {
  try {
    res.json(
      await requestAuthorization({
        prescriptionNo: String(req.body?.prescriptionNo ?? ''),
        patientNationalId: String(req.body?.patientNationalId ?? ''),
        lines: Array.isArray(req.body?.lines) ? req.body.lines : [],
      }),
    );
  } catch (err) {
    fail(res, err);
  }
});

wasfatyRouter.post('/dispenses', async (req, res) => {
  try {
    const result = await createDispense(req.body as WasfatyManualDispenseInput);
    res.status(201).json(result);
  } catch (err) {
    fail(res, err);
  }
});

wasfatyRouter.get('/dispenses', async (req, res) => {
  try {
    res.json(
      await listDispenses({
        month: query(req, 'month'),
        status: query(req, 'status'),
        invoiceNo: query(req, 'invoiceNo'),
      }),
    );
  } catch (err) {
    fail(res, err);
  }
});

wasfatyRouter.get('/dispenses/:id', async (req, res) => {
  try {
    res.json(await getDispense(req.params.id));
  } catch (err) {
    fail(res, err);
  }
});

wasfatyRouter.post('/dispenses/:id/cancel', async (req, res) => {
  try {
    res.json(await cancelDispense(req.params.id, String(req.body?.reason ?? '')));
  } catch (err) {
    fail(res, err);
  }
});

wasfatyRouter.get('/claims', async (req, res) => {
  try {
    res.json(
      await listClaims({
        month: query(req, 'month'),
        status: query(req, 'status'),
      }),
    );
  } catch (err) {
    fail(res, err);
  }
});

wasfatyRouter.post('/claims/:id/submit', async (req, res) => {
  try {
    res.json(await submitClaim(req.params.id));
  } catch (err) {
    fail(res, err);
  }
});

wasfatyRouter.post('/claims/:id/reconcile', async (req, res) => {
  try {
    res.json(
      await reconcileClaim(req.params.id, {
        reportedAmount: req.body?.reportedAmount === undefined ? undefined : Number(req.body.reportedAmount),
        paidAmount: req.body?.paidAmount === undefined ? undefined : Number(req.body.paidAmount),
        varianceReason: req.body?.varianceReason ? String(req.body.varianceReason) : undefined,
      }),
    );
  } catch (err) {
    fail(res, err);
  }
});
