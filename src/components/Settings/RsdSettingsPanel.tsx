// RSD settings/status panel. Setup itself is server-side (server/.env: mode, environment,
// credentials, URLs) because the browser must never hold SFDA credentials. What this panel can do
// is show whether the server is configured and how its ledger/queue stand, and send the queue now.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, Paper, Stack, Table, TableBody, TableCell, TableRow, Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import SendIcon from '@mui/icons-material/Send';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import { getRsdStatus, type RsdStatus } from '../../api/rsdApi';
import { useRsdOutboxStore } from '../../store/rsdOutboxStore';
import { rsdQueueSummary } from '../../utils/rsdOutbox';

export default function RsdSettingsPanel() {
  const navigate = useNavigate();
  const queue = useRsdOutboxStore((s) => s.queue);
  const isFlushing = useRsdOutboxStore((s) => s.isFlushing);
  const flush = useRsdOutboxStore((s) => s.flush);

  const [status, setStatus] = useState<RsdStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const summary = rsdQueueSummary(queue);

  async function refresh() {
    try {
      setStatus(await getRsdStatus());
      setError(null);
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await getRsdStatus();
        if (!cancelled) {
          setStatus(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setStatus(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
        {status ? (
          <>
            <Chip
              size="small"
              color={status.mode === 'live' ? 'success' : 'default'}
              label={`${status.mode} mode`}
              variant="outlined"
            />
            <Chip
              size="small"
              color={status.environment === 'production' ? 'warning' : 'default'}
              label={status.environment}
              variant="outlined"
            />
            <Chip
              size="small"
              color={status.credentialsConfigured ? 'success' : 'error'}
              label={status.credentialsConfigured ? 'credentials configured' : 'credentials missing'}
              variant="outlined"
            />
            <Chip
              size="small"
              color={summary.pending ? 'warning' : 'default'}
              label={`${summary.pending} queued · ${summary.rejected + summary.blocked} need attention`}
              variant="outlined"
            />
          </>
        ) : (
          <Chip size="small" variant="outlined" label="server status unknown" />
        )}
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<RefreshIcon />} onClick={() => void refresh()}>
          Refresh
        </Button>
        <Button
          size="small"
          variant="contained"
          startIcon={<SendIcon />}
          disabled={isFlushing || summary.pending === 0}
          onClick={() => void flush()}
        >
          {isFlushing ? 'Sending…' : 'Send queue now'}
        </Button>
        <Button
          size="small"
          startIcon={<FactCheckOutlinedIcon />}
          onClick={() => navigate('/rsd-reporting')}
        >
          Open RSD monitor
        </Button>
      </Stack>

      {error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          RSD server not reachable: {error}
        </Alert>
      )}

      {status && (
        <Table size="small">
          <TableBody>
            <TableRow>
              <TableCell sx={{ width: 220, color: 'text.secondary' }}>Pharmacy GLN</TableCell>
              <TableCell>{status.gln ?? '—'}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ color: 'text.secondary' }}>Sale service</TableCell>
              <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{status.saleUrl || '—'}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ color: 'text.secondary' }}>Cancel service</TableCell>
              <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{status.cancelUrl || '—'}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ color: 'text.secondary' }}>Direct sale to-GLN / prescription id</TableCell>
              <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                {status.directToGln} / {status.directPrescriptionId ?? '—'}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ color: 'text.secondary' }}>Server ledger</TableCell>
              <TableCell>
                {status.ledger.records} records · {status.ledger.salesSent} sales sent ·{' '}
                {status.ledger.cancelsSent} cancels sent · {status.ledger.pendingOrFailed} not accepted
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
        Credentials, endpoints and mode live in <code>server/.env</code> and never reach the browser.
        RSD reports drugs only: a line is queued when Item Master had “Batch / expiry tracking”
        enabled and the pack carried a serial and expiry. The POS never waits on SFDA — failures stay
        in the outbox and retry every 60 seconds.
      </Typography>
    </Paper>
  );
}
