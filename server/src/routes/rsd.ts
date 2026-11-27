// HTTP surface for the RSD adapter. Mounted at /api/rsd.
//
// This is the contract the browser's sale mirror uses (src/api/rsdApi.ts). Credentials never
// appear in any request or response: the browser only learns whether they are configured.
//
// Reporting is deliberately synchronous per unit. The POS calls this after the sale is already
// saved locally; a 5xx/503 means "not reported yet, queue a retry", never "the sale failed".
import { Router, type Request, type Response } from 'express';
import { requireAdmin } from '../auth/middleware.js';
import { confirmationMatches, requireConfirmation } from '../auth/confirmation.js';
import { audited } from '../audit.js';
import { getRsdEnvironment, getRsdMode } from '../rsd/config.js';
import { RsdApiError } from '../rsd/errors.js';
import {
  acceptMockUnit,
  getStatus,
  listRecords,
  reopenRejected,
  reportCancel,
  reportSale,
  resetMock,
  testConnection,
  unitStatus,
} from '../rsd/service.js';
import { getRsdSettingsView, updateRsdSettings, type RsdSettingsUpdate } from '../rsd/settings.js';
import type { RsdCancelInput, RsdRecordStatus, RsdSaleInput, RsdUnit } from '../rsd/types.js';

export const rsdRouter = Router();

// SEC-10: switching the SFDA adapter from mock to live (or test to production) needs a second,
// explicit key from an admin. Mock helpers are dev-only and also need one; they are 404 in a
// production process (see src/index.ts). The UI sends these phrases only after a human dialog.
export const RSD_CONFIRMATIONS = {
  liveSettings: 'ENABLE LIVE RSD',
  mockControl: 'ALLOW MOCK RSD',
} as const;

function movementDetail(kind: string) {
  // Never log GTIN/serial/prescription: those can identify a patient. Mode + environment are enough
  // to prove which national endpoint was addressed.
  return { kind, mode: getRsdMode(), environment: getRsdEnvironment() };
}

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
    // Cashier reporting stays authenticated-only so the till cannot be blocked, but every movement
    // is written to the append-only audit trail with the verified JWT identity.
    res.json(await audited(req, 'rsd.sale.report', movementDetail('sale'), () => reportSale(req.body as RsdSaleInput)));
  } catch (err) {
    fail(res, err);
  }
});

// Report the cancellation of one pack (a full return). Refused unless the sale was accepted.
rsdRouter.post('/sales/cancel', requireAdmin, async (req, res) => {
  try {
    res.json(await audited(req, 'rsd.sale.cancel', movementDetail('cancel'), () => reportCancel(req.body as RsdCancelInput)));
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

// Operator action for a terminal rejection that was caused by the account/configuration rather
// than the unit data (for example FC 21017, or a corrected credential). It clears the terminal
// flag on the existing record and keeps every attempt; the next report sends again. The outbox's
// Retry button calls this before resending, which is the browser equivalent of --retry-rejected.
rsdRouter.post('/reopen', requireAdmin, async (req, res) => {
  try {
    const body = req.body as { kind?: string; gtin?: string; serialNo?: string };
    if (body.kind !== 'sale' && body.kind !== 'cancel') {
      res.status(400).json({ error: 'kind must be "sale" or "cancel".', code: 'invalid_kind' });
      return;
    }
    const kind = body.kind;
    const record = await audited(req, 'rsd.reopen', movementDetail(kind), () =>
      reopenRejected(kind, body.gtin ?? '', body.serialNo ?? ''));
    res.json({ record: record ?? null });
  } catch (err) {
    fail(res, err);
  }
});

// Settings > RSD. The GET view never contains the password; PUT accepts a blank password to mean
// "keep the stored one", because the UI cannot echo a value it never received.
rsdRouter.get('/settings', async (_req, res) => {
  try {
    res.json(await getRsdSettingsView());
  } catch (err) {
    fail(res, err);
  }
});

rsdRouter.put('/settings', requireAdmin, async (req, res) => {
  try {
    const raw = (req.body ?? {}) as RsdSettingsUpdate;
    const current = await getRsdSettingsView();
    const nextMode = raw.mode === 'live' || raw.mode === 'mock' ? raw.mode : current.mode;
    const nextEnvironment =
      raw.environment === 'production' || raw.environment === 'test' ? raw.environment : current.environment;
    const goesLive = nextMode === 'live' && current.mode !== 'live';
    const goesProduction = nextEnvironment === 'production' && current.environment !== 'production';
    if ((goesLive || goesProduction) &&
        !(await confirmationMatches(req, RSD_CONFIRMATIONS.liveSettings, 'rsd.settings.live'))) {
      res.status(400).json({ error: 'confirmation_required', confirmation: RSD_CONFIRMATIONS.liveSettings });
      return;
    }
    const view = await audited(req, 'rsd.settings.update', {
      fromMode: current.mode,
      fromEnvironment: current.environment,
      toMode: nextMode,
      toEnvironment: nextEnvironment,
    }, () => updateRsdSettings(raw));
    res.json(view);
  } catch (err) {
    fail(res, err);
  }
});

// Read-only connectivity probe: WSDL + Basic auth in live mode, local simulator in mock mode.
// It never sends a sale/cancel, so pressing "Test connection" cannot create a movement.
rsdRouter.post('/test', requireAdmin, async (_req, res) => {
  try {
    res.json(await audited(_req, 'rsd.connection.test', movementDetail('probe'), () => testConnection()));
  } catch (err) {
    fail(res, err);
  }
});

// Mock-only stand-ins for Accept, used to prepare sellable units for the offline trial.
rsdRouter.post(
  '/mock/accept',
  requireAdmin,
  requireConfirmation(RSD_CONFIRMATIONS.mockControl, 'rsd.mock.accept'),
  async (req, res) => {
    try {
      res.json(await audited(req, 'rsd.mock.accept', movementDetail('accept'), () => acceptMockUnit(req.body as RsdUnit)));
    } catch (err) {
      fail(res, err);
    }
  },
);

rsdRouter.post(
  '/mock/reset',
  requireAdmin,
  requireConfirmation(RSD_CONFIRMATIONS.mockControl, 'rsd.mock.reset'),
  async (req, res) => {
    try {
      await audited(req, 'rsd.mock.reset', movementDetail('reset'), () => resetMock());
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  },
);
