// Settings > RSD (SFDA Drug Track & Trace).
//
// The browser never holds RSD credentials: this panel edits configuration that lives on the
// server (server/data/rsd-settings.json, seeded by server/.env) and only ever reads back
// booleans such as `hasPassword`. The password box is therefore write-only - leave it blank to
// keep the stored credential.
//
// Two independent switches are shown together because they answer different questions:
//   * "Report sales from this register" is LOCAL and opt-in (types/settings.ts rsdEnabled);
//   * "mode / environment" is SERVER-side and decides whether calls go to the mock simulator or
//     to SFDA's test/production hosts.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, MenuItem, Paper, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import SaveIcon from '@mui/icons-material/Save';
import NetworkCheckIcon from '@mui/icons-material/NetworkCheck';
import TrackChangesIcon from '@mui/icons-material/TrackChanges';
import { useSettingsStore } from '../../store/settingsStore';
import {
  getRsdSettings, testRsdConnection, updateRsdSettings,
  type RsdConnectionTest, type RsdEnvironment, type RsdMode, type RsdSettingsUpdate,
  type RsdSettingsView,
} from '../../api/rsdApi';

interface FormState {
  mode: RsdMode;
  environment: RsdEnvironment;
  gln: string;
  username: string;
  password: string;
  saleUrl: string;
  cancelUrl: string;
  directToGln: string;
  directPrescriptionId: string;
}

const EMPTY_FORM: FormState = {
  mode: 'mock',
  environment: 'test',
  gln: '',
  username: '',
  password: '',
  saleUrl: '',
  cancelUrl: '',
  directToGln: '0000000000000',
  directPrescriptionId: 'DIRECT-SALE',
};

function formFrom(view: RsdSettingsView): FormState {
  return {
    mode: view.mode,
    environment: view.environment,
    gln: view.gln,
    username: view.username,
    password: '',
    saleUrl: view.saleUrl,
    cancelUrl: view.cancelUrl,
    directToGln: view.directToGln,
    directPrescriptionId: view.directPrescriptionId,
  };
}

export default function RsdSettingsPanel() {
  const navigate = useNavigate();
  const enabled = useSettingsStore((s) => s.settings.rsdEnabled === true);
  const updateSettings = useSettingsStore((s) => s.update);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [view, setView] = useState<RsdSettingsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<RsdConnectionTest | null>(null);

  async function load(): Promise<void> {
    try {
      const next = await getRsdSettings();
      setView(next);
      setForm(formFrom(next));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function field<K extends keyof FormState>(key: K) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setForm((current) => ({ ...current, [key]: e.target.value })),
    };
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    setTestResult(null);
    // The local opt-in is independent of the server: save it even if the server is unreachable,
    // so turning reporting off always works at the till.
    updateSettings({ rsdEnabled: enabled });
    try {
      const payload: RsdSettingsUpdate = { ...form };
      // Blank means "keep the stored password" (the UI never receives it back).
      if ((payload.password ?? '').trim() === '') delete payload.password;
      const next = await updateRsdSettings(payload);
      setView(next);
      setForm(formFrom(next));
      setNotice('RSD settings saved. The server applies them immediately - no restart needed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      setTestResult(await testRsdConnection());
    } catch (err) {
      setTestResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }

  const sourceChip = view
    ? view.source === 'stored'
      ? 'Saved on server'
      : 'Seeded from server/.env'
    : null;

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.5 }}>
          <TrackChangesIcon color="primary" />
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              SFDA RSD - Pharmacy Sale / Sale Cancel
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Unit-level drug track &amp; trace. Only sold packs and full returns are reported.
            </Typography>
          </Box>
          <Button size="small" startIcon={<RefreshIcon />} onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : 'Reload'}
          </Button>
        </Stack>

        <Alert severity="info" sx={{ mb: 2 }}>
          RSD is a national reporting side-channel, never a checkout dependency. With it off, sales
          are recorded locally and nothing is queued. With it on, every serialised pack whose item
          has <strong>Batch / expiry tracking</strong> enabled is queued and sent in the background.
        </Alert>

        <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
          <Chip
            color={enabled ? 'success' : 'default'}
            variant={enabled ? 'filled' : 'outlined'}
            label={enabled ? 'Reporting on this register' : 'Reporting off'}
          />
          {view && (
            <>
              <Chip variant="outlined" label={`${view.mode} · ${view.environment}`} />
              <Chip
                color={view.credentialsConfigured ? 'success' : 'warning'}
                variant="outlined"
                label={view.credentialsConfigured ? 'Credentials configured' : 'Credentials missing'}
              />
              {sourceChip && <Chip variant="outlined" label={sourceChip} />}
            </>
          )}
        </Stack>

        <Alert
          severity={enabled ? 'success' : 'warning'}
          sx={{ mb: 2 }}
          action={
            <Button
              size="small"
              color="inherit"
              onClick={() => updateSettings({ rsdEnabled: !enabled })}
            >
              {enabled ? 'Disable' : 'Enable'}
            </Button>
          }
        >
          {enabled
            ? 'Sales on this register are queued for RSD. Turning this off stops NEW units; already queued units still finish, because abandoning a movement mid-report is worse.'
            : 'RSD reporting is disabled by default. Enable it only after the pharmacy GLN and credentials below are confirmed.'}
        </Alert>

        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
        {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}

        {loading && !view ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={16} />
            <Typography variant="body2" color="text.secondary">Loading RSD settings…</Typography>
          </Box>
        ) : (
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField select label="Mode" size="small" sx={{ minWidth: 220 }} {...field('mode')}>
                <MenuItem value="mock">mock - local simulator (safe)</MenuItem>
                <MenuItem value="live">live - real SOAP calls</MenuItem>
              </TextField>
              <TextField select label="Environment" size="small" sx={{ minWidth: 220 }} {...field('environment')}>
                <MenuItem value="test">test</MenuItem>
                <MenuItem value="production">production</MenuItem>
              </TextField>
              <TextField
                label="Pharmacy GLN"
                size="small"
                sx={{ minWidth: 220 }}
                {...field('gln')}
                helperText="13 digits; identifies this pharmacy's RSD location."
                slotProps={{ htmlInput: { maxLength: 13, inputMode: 'numeric' } }}
              />
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="RSD username" size="small" fullWidth {...field('username')} />
              <TextField
                label="RSD password"
                size="small"
                type="password"
                fullWidth
                value={form.password}
                onChange={(e) => setForm((current) => ({ ...current, password: e.target.value }))}
                placeholder={view?.hasPassword ? 'Stored - leave blank to keep' : 'Not set'}
                helperText="Write-only: the browser never reads it back. Stored on the server."
                autoComplete="new-password"
              />
            </Stack>

            <Divider />
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Endpoints (leave blank on test to disable live reporting)
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Sale service URL" size="small" fullWidth {...field('saleUrl')} />
              <TextField label="Cancel service URL" size="small" fullWidth {...field('cancelUrl')} />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Direct Sale to-GLN"
                size="small"
                fullWidth
                {...field('directToGln')}
                helperText="The all-zero GLN means 'patient at the counter' (Direct Sale)."
              />
              <TextField
                label="Direct Sale prescription ID"
                size="small"
                fullWidth
                {...field('directPrescriptionId')}
                helperText="Placeholder PRESCRIPTIONID for OTC/direct sales until SFDA confirms the ISD value."
              />
            </Stack>

            <Stack direction="row" spacing={1}>
              <Button variant="contained" startIcon={<SaveIcon />} onClick={() => void save()} disabled={saving}>
                {saving ? 'Saving…' : 'Save RSD settings'}
              </Button>
              <Button variant="outlined" startIcon={<NetworkCheckIcon />} onClick={() => void test()} disabled={testing}>
                {testing ? 'Testing…' : 'Test connection'}
              </Button>
              <Button
                variant="text"
                startIcon={<TrackChangesIcon />}
                onClick={() => navigate('/rsd-reporting')}
              >
                Open RSD reporting
              </Button>
            </Stack>
            {testResult && (
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center' }}>
                  <Chip
                    size="small"
                    color={testResult.ok ? 'success' : 'error'}
                    label={testResult.ok ? 'Connection OK' : 'Connection failed'}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {testResult.mode} · {testResult.environment} · {new Date(testResult.checkedAt).toLocaleString()}
                  </Typography>
                </Stack>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Check</TableCell>
                      <TableCell>HTTP</TableCell>
                      <TableCell>Result</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {testResult.checks.map((check) => (
                      <TableRow key={check.name}>
                        <TableCell>{check.name}</TableCell>
                        <TableCell>{check.httpStatus ?? '—'}</TableCell>
                        <TableCell>
                          {check.message}
                          {check.operations && check.operations.length > 0 && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              Operations: {check.operations.join(', ')}
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  The probe only fetches the WSDL; it never submits a sale or a cancel, so testing
                  cannot create a movement.
                </Typography>
              </Paper>
            )}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}
