import { useEffect, useState } from 'react';
import {
  Box, Typography, TextField, Button, Paper, Stack, Alert, Chip, CircularProgress, Divider,
  ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import * as zatcaApi from '../../api/zatcaApi';
import type { OnboardingStatus, ZatcaEnv } from '../../api/zatcaApi';

type StepState = 'done' | 'active' | 'pending';

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') return <CheckCircleIcon fontSize="small" color="success" />;
  return <RadioButtonUncheckedIcon fontSize="small" color={state === 'active' ? 'primary' : 'disabled'} />;
}

const ENV_INFO: Record<ZatcaEnv, { label: string; help: string; suggestedOtp?: string }> = {
  sandbox: {
    label: 'Test Mode',
    help: "ZATCA's public developer portal - no real Fatoora account needed. A commonly-documented sample OTP for this tier is 123345, but this hasn't been confirmed working live yet (see server/README.md) - the request may need a different shape than this app assumes.",
    suggestedOtp: '123345',
  },
  simulation: {
    label: 'Simulation',
    help: "ZATCA's pre-production environment - needs a real OTP from this business's actual Fatoora portal account (Onboard New Solution Unit).",
  },
  production: {
    label: 'Production',
    help: 'Real ZATCA production. Invoices submitted here are legally reported/cleared. Only use once Simulation has been fully validated.',
  },
};

export default function ZatcaOnboardingPanel() {
  const [serverUp, setServerUp] = useState<boolean | null>(null);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [otp, setOtp] = useState(ENV_INFO.sandbox.suggestedOtp ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkResults, setCheckResults] = useState<Array<{ name: string; status: string }> | null>(null);

  async function refresh() {
    const up = await zatcaApi.isServerReachable();
    setServerUp(up);
    if (up) setStatus(await zatcaApi.getOnboardingStatus());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function run(step: string, fn: () => Promise<void>) {
    setBusy(step);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const env = status?.environment ?? 'sandbox';

  async function switchEnv(next: ZatcaEnv) {
    if (next === env) return;
    setOtp(ENV_INFO[next].suggestedOtp ?? '');
    setCheckResults(null);
    // Switching environment invalidates any CSID already on file (server/src/store/secureStore.ts
    // clears it) - a CSID issued against sandbox is meaningless in simulation and vice versa.
    await run('env', async () => { await zatcaApi.setEnvironment(next); });
  }

  const step = status?.step ?? 'not_started';
  const complianceState: StepState = step === 'not_started' ? 'active' : 'done';
  const checkState: StepState = step === 'not_started' ? 'pending' : step === 'compliance_issued' ? 'active' : 'done';
  const productionState: StepState = step === 'production_issued' ? 'done' : step === 'compliance_checked' ? 'active' : 'pending';

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>ZATCA Phase 2 Onboarding</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        One-time setup that lets this device cryptographically sign and submit real invoices to
        ZATCA. Runs against the <code>{import.meta.env.VITE_ZATCA_SERVER_URL ?? 'http://localhost:4300'}</code> server
        (see <code>server/README.md</code>) - it holds the private key, this page never sees it.
      </Typography>

      <Box sx={{ mb: 2 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Environment</Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={env}
          onChange={(_, v) => v && switchEnv(v)}
          disabled={busy !== null || serverUp === false}
        >
          {(Object.keys(ENV_INFO) as ZatcaEnv[]).map((e) => (
            <ToggleButton key={e} value={e}>{ENV_INFO[e].label}</ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {ENV_INFO[env].help}
        </Typography>
      </Box>

      {serverUp === false && (
        <Alert severity="error" sx={{ mb: 2 }}>
          ZATCA server isn't reachable. Start it with <code>npm run dev</code> in <code>Pharmacy-App/server</code> first.
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Stack spacing={2}>
        <Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
            <StepIcon state={complianceState} />
            <Typography sx={{ fontWeight: 600 }}>1. Compliance CSID</Typography>
            {status?.compliance && <Chip size="small" label={`issued ${new Date(status.compliance.issuedAt).toLocaleDateString()}`} />}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Get an OTP from your Fatoora portal account (Onboard New Solution Unit), enter it below,
            and this generates a fresh key + CSR and exchanges it for a Compliance CSID.
          </Typography>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              label="OTP from Fatoora portal"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              disabled={complianceState === 'done'}
            />
            <Button
              variant="contained"
              disabled={!otp || complianceState === 'done' || busy !== null || serverUp === false}
              onClick={() => run('compliance', async () => { await zatcaApi.requestComplianceCsid(otp); })}
            >
              {busy === 'compliance' ? <CircularProgress size={20} /> : 'Get Compliance CSID'}
            </Button>
          </Stack>
        </Box>

        <Divider />

        <Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
            <StepIcon state={checkState} />
            <Typography sx={{ fontWeight: 600 }}>2. Compliance checks</Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Submits 6 sample invoices (standard/simplified × invoice/credit note/debit note) so
            ZATCA can validate this integration before issuing a Production CSID.
          </Typography>
          <Button
            variant="outlined"
            disabled={checkState === 'pending' || busy !== null || serverUp === false}
            onClick={() => run('check', async () => setCheckResults((await zatcaApi.runComplianceCheck()).results))}
          >
            {busy === 'check' ? <CircularProgress size={20} /> : 'Run Compliance Checks'}
          </Button>
          {checkResults && (
            <Stack spacing={0.5} sx={{ mt: 1 }}>
              {checkResults.map((r) => (
                <Stack key={r.name} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Chip size="small" color={r.status === 'PASS' ? 'success' : 'warning'} label={r.status} />
                  <Typography variant="caption">{r.name}</Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </Box>

        <Divider />

        <Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
            <StepIcon state={productionState} />
            <Typography sx={{ fontWeight: 600 }}>3. Production CSID</Typography>
            {status?.production && <Chip size="small" color="success" label={`issued ${new Date(status.production.issuedAt).toLocaleDateString()}`} />}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            The CSID actually used to sign and submit real invoices from this device going forward.
          </Typography>
          <Button
            variant="contained"
            disabled={productionState !== 'active' || busy !== null}
            onClick={() => run('production', async () => { await zatcaApi.requestProductionCsid(); })}
          >
            {busy === 'production' ? <CircularProgress size={20} /> : 'Get Production CSID'}
          </Button>
        </Box>

        {status?.step === 'production_issued' && (
          <Alert severity="success">
            Onboarding complete - checkout now signs and submits real invoices to ZATCA ({ENV_INFO[env].label} environment).
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}
