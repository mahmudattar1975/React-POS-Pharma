import { Router } from 'express';
import { getOnboardingStatus, requestComplianceCsid, runComplianceChecks, requestProductionCsid, setZatcaEnvironment } from '../zatca/onboarding.js';
import type { ZatcaEnv } from '../store/secureStore.js';

export const onboardingRouter = Router();

const VALID_ENVS: ZatcaEnv[] = ['sandbox', 'simulation', 'production'];

onboardingRouter.get('/status', async (_req, res) => {
  try {
    res.json(await getOnboardingStatus());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

onboardingRouter.post('/environment', async (req, res) => {
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

onboardingRouter.post('/compliance', async (req, res) => {
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

onboardingRouter.post('/compliance-check', async (_req, res) => {
  try {
    res.json(await runComplianceChecks());
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

onboardingRouter.post('/production', async (_req, res) => {
  try {
    const csid = await requestProductionCsid();
    res.json({ issuedAt: csid.issuedAt, requestId: csid.requestId });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});
