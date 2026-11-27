// Settings > RSD (SFDA Drug Track & Trace).
//
// The browser never holds RSD credentials: this panel edits configuration that lives on the
// server (server/data/rsd-settings.json, seeded by server/.env) and only ever reads back booleans
// such as `hasPassword`. The password box is therefore write-only - leave it blank to keep the
// stored credential.
//
// Two independent switches are shown together because they answer different questions:
//   * "Report sales from this register" is LOCAL and opt-in (types/settings.ts rsdEnabled);
//   * "mode / environment" is SERVER-side and decides whether calls go to the mock simulator or
//     to SFDA's test/production hosts.
//
// The lower section keeps the Phase 3 outbox view: server ledger plus the browser's durable queue.
// A saved credential and a queued pack are different things; both belong on one screen.
import { useEffect, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, MenuItem, Paper, Stack,
  Table, TableBody, TableCell, TableRow, TextField, Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import SaveIcon from '@mui/icons-material/Save';
import SendIcon from '@mui/icons-material/Send';
import NetworkCheckIcon from '@mui/icons-material/NetworkCheck';
import TrackChangesIcon from '@mui/icons-material/TrackChanges';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import {
  getRsdSettings, getRsdStatus, testRsdConnection, updateRsdSettings,
  type RsdConnectionTest, type RsdEnvironment, type RsdMode, type RsdSettingsUpdate,
  type RsdSettingsView, type RsdStatus,
} from '../../api/rsdApi';
import { useSettingsStore } from '../../store/settingsStore';
import { useRsdOutboxStore } from '../../store/rsdOutboxStore';
import { rsdQueueSummary } from '../../utils/rsdOutbox';

import { T, useT } from '../../i18n';
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
  const tr = useT();
  const navigate = useNavigate();
  const enabled = useSettingsStore((s) => s.settings.rsdEnabled === true);
  const updateSettings = useSettingsStore((s) => s.update);

  const queue = useRsdOutboxStore((s) => s.queue);
  const isFlushing = useRsdOutboxStore((s) => s.isFlushing);
  const flush = useRsdOutboxStore((s) => s.flush);
  const summary = rsdQueueSummary(queue);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [view, setView] = useState<RsdSettingsView | null>(null);
  const [status, setStatus] = useState<RsdStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<RsdConnectionTest | null>(null);

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const [settings, serverStatus] = await Promise.all([getRsdSettings(), getRsdStatus()]);
      setView(settings);
      setForm(formFrom(settings));
      setStatus(serverStatus);
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
      onChange: (e: ChangeEvent<HTMLInputElement>) =>
        setForm((current) => ({ ...current, [key]: e.target.value })),
    };
  }

  async function save() {
    // Switching the SFDA adapter to live/production is irreversible in effect: every later sale is
    // a national track-and-trace movement. Ask a human first, then send the exact server phrase.
    const goesLive = form.mode === 'live' && view?.mode !== 'live';
    const goesProduction = form.environment === 'production' && view?.environment !== 'production';
    const needsConfirmation = goesLive || goesProduction;
    if (needsConfirmation && !window.confirm(
      'Enable live RSD reporting? Future sales will be reported to the SFDA' +
      (goesProduction ? ' PRODUCTION' : ' test') + ' service. Continue only when the account and endpoints are verified.',
    )) return;

    setSaving(true);
    setError(null);
    setNotice(null);
    setTestResult(null);
    // The local opt-in is independent of the server: save it even if the server is unreachable,
    // so turning reporting off always works at the till.
    updateSettings({ rsdEnabled: enabled });
    try {
      const payload: RsdSettingsUpdate = {
        ...form,
        ...(needsConfirmation ? { confirmation: 'ENABLE LIVE RSD' } : {}),
      };
      // Blank means "keep the stored password" (the UI never receives it back).
      if ((payload.password ?? '').trim() === '') delete payload.password;
      const next = await updateRsdSettings(payload);
      setView(next);
      setForm(formFrom(next));
      setNotice('RSD settings saved. The server applies them immediately - no restart needed.');
      await load();
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
              <T>SFDA RSD - Pharmacy Sale / Sale Cancel</T>
            </Typography>
            <Typography variant="caption" color="text.secondary">
              <T>Unit-level drug track &amp; trace. Only sold packs and full returns are reported.</T>
            </Typography>
          </Box>
          <Button size="small" startIcon={<RefreshIcon />} onClick={() => void load()} disabled={loading}>
            {loading ? tr("Loading…") : tr("Reload")}
          </Button>
        </Stack>

        <Alert severity="info" sx={{ mb: 2 }}>
          <T>RSD is a national reporting side-channel, never a checkout dependency. With it off, sales
          are recorded locally and nothing is queued. With it on, every serialised pack whose item
          has</T> <strong><T>Batch / expiry tracking</T></strong> <T>enabled is queued and sent in the background.</T>
        </Alert>

        <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
          <Chip
            color={enabled ? 'success' : 'default'}
            variant={enabled ? 'filled' : 'outlined'}
            label={enabled ? 'Reporting on this register' : 'Reporting off'}
          />
          <Chip
            size="small"
            color={summary.pending ? 'warning' : 'default'}
            variant="outlined"
            label={`${summary.pending} queued · ${summary.rejected + summary.blocked} need attention`}
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
          {!view && <Chip size="small" variant="outlined" label={tr('server settings unknown')} />}
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
              {enabled ? tr("Disable") : tr("Enable")}
            </Button>
          }
        >
          {enabled
            ? tr("Sales on this register are queued for RSD. Turning this off stops NEW units; already queued units still finish, because abandoning a movement mid-report is worse.")
            : tr("RSD reporting is disabled by default. Enable it only after the pharmacy GLN and credentials below are confirmed.")}
        </Alert>

        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
        {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}

        {loading && !view ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={16} />
            <Typography variant="body2" color="text.secondary"><T>Loading RSD settings…</T></Typography>
          </Box>
        ) : (
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField select label={tr('Mode')} size="small" sx={{ minWidth: 220 }} {...field('mode')}>
                <MenuItem value="mock"><T>mock - local simulator (safe)</T></MenuItem>
                <MenuItem value="live"><T>live - real SOAP calls</T></MenuItem>
              </TextField>
              <TextField select label={tr('Environment')} size="small" sx={{ minWidth: 220 }} {...field('environment')}>
                <MenuItem value="test"><T>test</T></MenuItem>
                <MenuItem value="production"><T>production</T></MenuItem>
              </TextField>
              <TextField
                label={tr('Pharmacy GLN')}
                size="small"
                sx={{ minWidth: 220 }}
                {...field('gln')}
                helperText={tr('13 digits; identifies this pharmacy\'s RSD location.')}
                slotProps={{ htmlInput: { maxLength: 13, inputMode: 'numeric' } }}
              />
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label={tr('RSD username')} size="small" fullWidth {...field('username')} />
              <TextField
                label={tr('RSD password')}
                size="small"
                type="password"
                fullWidth
                value={form.password}
                onChange={(e) => setForm((current) => ({ ...current, password: e.target.value }))}
                placeholder={view?.hasPassword ? 'Stored - leave blank to keep' : 'Not set'}
                helperText={tr('Write-only: the browser never reads it back. Stored on the server.')}
                autoComplete="new-password"
              />
            </Stack>

            <Divider />
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              <T>Endpoints (leave blank on test to disable live reporting)</T>
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label={tr('Sale service URL')} size="small" fullWidth {...field('saleUrl')} />
              <TextField label={tr('Cancel service URL')} size="small" fullWidth {...field('cancelUrl')} />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label={tr('Direct Sale to-GLN')}
                size="small"
                fullWidth
                {...field('directToGln')}
                helperText={tr('The all-zero GLN means \'patient at the counter\' (Direct Sale).')}
              />
              <TextField
                label={tr('Direct Sale prescription ID')}
                size="small"
                fullWidth
                {...field('directPrescriptionId')}
                helperText={tr('Placeholder PRESCRIPTIONID for OTC/direct sales until SFDA confirms the ISD value.')}
              />
            </Stack>

            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
              <Button variant="contained" startIcon={<SaveIcon />} onClick={() => void save()} disabled={saving}>
                {saving ? tr("Saving…") : tr("Save RSD settings")}
              </Button>
              <Button variant="outlined" startIcon={<NetworkCheckIcon />} onClick={() => void test()} disabled={testing}>
                {testing ? tr("Testing…") : tr("Test connection")}
              </Button>
              <Button
                variant="text"
                startIcon={<SendIcon />}
                disabled={isFlushing || summary.pending === 0}
                onClick={() => void flush()}
              >
                {isFlushing ? tr("Sending…") : tr("Send queue now")}
              </Button>
              <Button
                variant="text"
                startIcon={<FactCheckOutlinedIcon />}
                onClick={() => navigate('/rsd-reporting')}
              >
                <T>Open RSD monitor</T>
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
                  <TableBody>
                    {testResult.checks.map((check) => (
                      <TableRow key={check.name}>
                        <TableCell sx={{ width: 100 }}>{check.name}</TableCell>
                        <TableCell sx={{ width: 70 }}>{check.httpStatus ?? '—'}</TableCell>
                        <TableCell>
                          {check.message}
                          {check.operations && check.operations.length > 0 && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              <T>Operations:</T> {check.operations.join(', ')}
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  <T>The probe only fetches the WSDL; it never submits a sale or a cancel, so testing
                  cannot create a movement.</T>
                </Typography>
              </Paper>
            )}
          </Stack>
        )}
      </Paper>

      {status && (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}><T>Server ledger &amp; browser queue</T></Typography>
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell sx={{ width: 220, color: 'text.secondary' }}><T>Pharmacy GLN</T></TableCell>
                <TableCell>{status.gln ?? '—'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ color: 'text.secondary' }}><T>Sale service</T></TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{status.saleUrl || '—'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ color: 'text.secondary' }}><T>Cancel service</T></TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{status.cancelUrl || '—'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ color: 'text.secondary' }}><T>Direct sale to-GLN / prescription id</T></TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {status.directToGln} / {status.directPrescriptionId ?? '—'}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ color: 'text.secondary' }}><T>Server ledger</T></TableCell>
                <TableCell>
                  {status.ledger.records} <T>records ·</T> {status.ledger.salesSent} <T>sales sent ·</T>{' '}
                  {status.ledger.cancelsSent} <T>cancels sent ·</T> {status.ledger.pendingOrFailed} <T>not accepted</T>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
            <T>Credentials, endpoints and mode live on the server (server/.env seeds server/data/rsd-settings.json)
            and never reach the browser. RSD reports drugs only: a line is queued when Item Master had
            “Batch / expiry tracking” enabled and the pack carried a serial and expiry. The POS never
            waits on SFDA — failures stay in the outbox and retry every 60 seconds.</T>
          </Typography>
        </Paper>
      )}
    </Stack>
  );
}
