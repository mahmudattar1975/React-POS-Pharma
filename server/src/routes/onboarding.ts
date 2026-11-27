import { Router } from 'express';
import { requireAdmin } from '../auth/middleware.js';
import { getOnboardingStatus, requestComplianceCsid, runComplianceChecks, requestProductionCsid, setZatcaEnvironment, setZatcaMode, OnboardingStepError } from '../zatca/onboarding.js';
import { getZatcaSettings, updateZatcaSettings } from '../zatca/settings.js';
import { IdentityValidationError } from '../store/identity.js';
import type { ZatcaEnv, ZatcaMode } from '../store/secureStore.js';

export const onboardingRouter = Router();

const VALID_ENVS: ZatcaEnv[] = ['sandbox', 'simulation', 'production'];
const VALID_MODES: ZatcaMode[] = ['mock', 'live'];

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
    res.json(await updateZatcaSettings(req.body));
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
  try {
    res.json(await setZatcaEnvironment(environment as ZatcaEnv));
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
  try {
    res.json(await setZatcaMode(mode as ZatcaMode));
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
    const csid = await requestComplianceCsid(otp);
    res.json({ issuedAt: csid.issuedAt, requestId: csid.requestId });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

onboardingRouter.post('/compliance-check', requireAdmin, async (_req, res) => {
  try {
    res.json(await runComplianceChecks());
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

onboardingRouter.post('/production', requireAdmin, async (_req, res) => {
  try {
    const csid = await requestProductionCsid();
    res.json({ issuedAt: csid.issuedAt, requestId: csid.requestId });
  } catch (err) {
    if (err instanceof OnboardingStepError) {
      res.status(409).json({ error: err.message });
      return;
    }
    res.status(502).json({ error: String(err) });
  }
});
