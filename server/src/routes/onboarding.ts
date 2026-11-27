import { Router } from 'express';
import { requireAdmin } from '../auth/middleware.js';
import { confirmationMatches, requireConfirmation } from '../auth/confirmation.js';
import { audited } from '../audit.js';
import { config } from '../config.js';
import { getOnboardingStatus, requestComplianceCsid, runComplianceChecks, requestProductionCsid, setZatcaEnvironment, setZatcaMode, OnboardingStepError } from '../zatca/onboarding.js';
import { getZatcaSettings, updateZatcaSettings } from '../zatca/settings.js';
import { IdentityValidationError } from '../store/identity.js';
import type { ZatcaEnv, ZatcaMode } from '../store/secureStore.js';

export const onboardingRouter = Router();

const VALID_ENVS: ZatcaEnv[] = ['sandbox', 'simulation', 'production'];
const VALID_MODES: ZatcaMode[] = ['mock', 'live'];

// Explicit proof of intent for the irreversible ZATCA switches (SEC-10). The phrases are sent by the
// UI only after a human confirmation dialog; they are not secrets, and are never logged themselves.
export const ZATCA_CONFIRMATIONS = {
  productionEnvironment: 'PRODUCTION ENVIRONMENT',
  liveMode: 'ENABLE LIVE',
  productionCsid: 'PRODUCTION CSID',
} as const;

onboardingRouter.get('/status', async (_req, res) => {
  try {
    res.json(await getOnboardingStatus());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Seller + device identity shared by the CSR and the signed UBL document. These two routes are what
// the Settings > ZATCA > Company & Device tab reads and writes; `.env` is only the first-run seed.
onboardingRouter.get('/settings', async (_req, res) => {
  try {
    res.json(await getZatcaSettings());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

onboardingRouter.put('/settings', requireAdmin, async (req, res) => {
  try {
    // Audit the field NAMES only: the body contains seller identity, never log its values.
    const fields = Object.keys((req.body ?? {}) as Record<string, unknown>).length;
    res.json(await audited(req, 'zatca.settings.update', { fieldCount: fields }, () => updateZatcaSettings(req.body)));
  } catch (err) {
    if (err instanceof IdentityValidationError) {
      res.status(400).json({ error: err.errors.join(' '), errors: err.errors });
      return;
    }
    res.status(500).json({ error: String(err) });
  }
});

onboardingRouter.post('/environment', requireAdmin, async (req, res) => {
  const { environment } = req.body as { environment?: string };
  if (!environment || !VALID_ENVS.includes(environment as ZatcaEnv)) {
    res.status(400).json({ error: `environment must be one of: ${VALID_ENVS.join(', ')}` });
    return;
  }
  // Switching to production clears any existing CSID and points signing at the real gateway.
  if (environment === 'production' &&
      !(await confirmationMatches(req, ZATCA_CONFIRMATIONS.productionEnvironment, 'zatca.environment.production'))) {
    res.status(400).json({ error: 'confirmation_required', confirmation: ZATCA_CONFIRMATIONS.productionEnvironment });
    return;
  }
  try {
    res.json(await audited(req, 'zatca.environment.set', {
      environment,
      previous: config.zatcaEnv,
    }, () => setZatcaEnvironment(environment as ZatcaEnv)));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

onboardingRouter.post('/mode', requireAdmin, async (req, res) => {
  const { mode } = req.body as { mode?: string };
  if (!mode || !VALID_MODES.includes(mode as ZatcaMode)) {
    res.status(400).json({ error: `mode must be one of: ${VALID_MODES.join(', ')}` });
    return;
  }
  // Going live makes every later submission a real fiscal document; require a second key.
  if (mode === 'live' &&
      !(await confirmationMatches(req, ZATCA_CONFIRMATIONS.liveMode, 'zatca.mode.live'))) {
    res.status(400).json({ error: 'confirmation_required', confirmation: ZATCA_CONFIRMATIONS.liveMode });
    return;
  }
  try {
    res.json(await audited(req, 'zatca.mode.set', {
      mode,
      previous: config.zatcaMode,
    }, () => setZatcaMode(mode as ZatcaMode)));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

onboardingRouter.post('/compliance', requireAdmin, async (req, res) => {
  const { otp } = req.body as { otp?: string };
  if (!otp) {
    res.status(400).json({ error: 'otp is required - get it from your Fatoora portal account (Onboard New Solution Unit)' });
    return;
  }
  try {
    // The OTP is deliberately never included in the audit detail, only the fact of the attempt.
    const csid = await audited(req, 'zatca.csid.compliance', {
      environment: config.zatcaEnv,
      mode: config.zatcaMode,
    }, () => requestComplianceCsid(otp));
    res.json({ issuedAt: csid.issuedAt, requestId: csid.requestId });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

onboardingRouter.post('/compliance-check', requireAdmin, async (_req, res) => {
  try {
    res.json(await audited(_req, 'zatca.compliance.check', {
      environment: config.zatcaEnv,
      mode: config.zatcaMode,
    }, () => runComplianceChecks()));
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

onboardingRouter.post(
  '/production',
  requireAdmin,
  requireConfirmation(ZATCA_CONFIRMATIONS.productionCsid, 'zatca.csid.production'),
  async (req, res) => {
    try {
      const csid = await audited(req, 'zatca.csid.production', {
        environment: config.zatcaEnv,
        mode: config.zatcaMode,
      }, () => requestProductionCsid());
      res.json({ issuedAt: csid.issuedAt, requestId: csid.requestId });
    } catch (err) {
      if (err instanceof OnboardingStepError) {
        res.status(409).json({ error: err.message });
        return;
      }
      res.status(502).json({ error: String(err) });
    }
  },
);
