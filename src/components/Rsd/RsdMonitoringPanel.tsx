// RSD reporting monitor - the fifth tab of Point of Sale.
//
// A sale never waits for SFDA, so the cashier's success screen cannot be the place that answers
// "did the national system get this pack?". This tab is that answer: every queued unit, what SFDA
// said, and the one action a human can take (Retry a corrected rejection). It deliberately shows
// BOTH sides of the same fact:
//   * the browser outbox (what this till still has to send), and
//   * the server ledger counters (what actually reached RSD and was stored for audit).
//
// The known compliance limit of the agreed scope is called out here rather than hidden: a partial
// return sends nothing, so those units stay "sold" in RSD until the whole invoice is returned.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ReplayIcon from '@mui/icons-material/Replay';
import SendIcon from '@mui/icons-material/Send';
import TuneIcon from '@mui/icons-material/Tune';

import { getRsdStatus, type RsdStatus } from '../../api/rsdApi';
import { useRsdOutboxStore } from '../../store/rsdOutboxStore';
import { useSettingsStore } from '../../store/settingsStore';
import { rsdQueueSummary, type RsdOutboxItem, type RsdOutboxStatus } from '../../utils/rsdOutbox';

type Filter = 'all' | 'attention' | 'pending' | 'sent';

const STATUS_COLOR: Record<RsdOutboxStatus, 'success' | 'info' | 'error' | 'warning'> = {
  sent: 'success',
  pending: 'info',
  rejected: 'error',
  blocked: 'warning',
};

const STATUS_LABEL: Record<RsdOutboxStatus, string> = {
  sent: 'Reported',
  pending: 'Queued',
  rejected: 'Rejected',
  blocked: 'Blocked',
};

function movementLabel(item: RsdOutboxItem): string {
  return item.kind === 'sale' ? 'Pharmacy Sale' : 'Sale Cancel';
}

function timestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export default function RsdMonitoringPanel() {
  const navigate = useNavigate();
  const queue = useRsdOutboxStore((s) => s.queue);
  const isFlushing = useRsdOutboxStore((s) => s.isFlushing);
  const lastFlushAt = useRsdOutboxStore((s) => s.lastFlushAt);
  const flush = useRsdOutboxStore((s) => s.flush);
  const retry = useRsdOutboxStore((s) => s.retry);
  const rsdEnabled = useSettingsStore((s) => s.settings.rsdEnabled === true);

  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<RsdStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  // Starts true: the first render is already "checking", so the mount effect does not need to set
  // state before it awaits the server.
  const [checking, setChecking] = useState(true);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await getRsdStatus());
      setStatusError(null);
    } catch (err) {
      setStatus(null);
      setStatusError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const summary = useMemo(() => rsdQueueSummary(queue), [queue]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return [...queue]
      .reverse()
      .filter((item) => {
        if (filter === 'attention') return item.status === 'rejected' || item.status === 'blocked';
        if (filter === 'pending') return item.status === 'pending';
        if (filter === 'sent') return item.status === 'sent';
        return true;
      })
      .filter((item) => {
        if (!needle) return true;
        return (
          item.invoiceNo.toLowerCase().includes(needle) ||
          item.unit.gtin.includes(needle) ||
          item.unit.serialNo.toLowerCase().includes(needle) ||
          (item.rc ?? '').toLowerCase().includes(needle) ||
          (item.message ?? '').toLowerCase().includes(needle)
        );
      });
  }, [queue, filter, search]);

  return (
    <Box sx={{ maxWidth: 1400 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        SFDA's Drug Track &amp; Trace reporting for serialised drug packs. Selling never waits for
        RSD: a pack is queued here when the sale is saved, sent in the background, and retried every
        minute until SFDA accepts it. A business rejection (wrong batch, unknown serial, unit not in
        the pharmacy's RSD inventory) stops and waits for a human - press Retry only after fixing
        the cause.
      </Typography>

      {!rsdEnabled && (
        <Alert severity="info" sx={{ mb: 2 }} action={
          <Button color="inherit" size="small" startIcon={<TuneIcon />} onClick={() => navigate('/settings')}>
            Settings
          </Button>
        }>
          RSD reporting is off on this register. Sales are recorded locally as usual, but no packs
          are queued for SFDA. Enable it in Settings &gt; RSD after confirming the pharmacy GLN and
          credentials.
        </Alert>
      )}

      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Chip label={`${summary.total} unit${summary.total === 1 ? '' : 's'}`} variant="outlined" />
        <Chip color="success" label={`${summary.sent} reported`} variant="outlined" />
        <Chip color={summary.pending ? 'info' : 'default'} label={`${summary.pending} queued`} variant="outlined" />
        <Chip
          color={summary.rejected ? 'error' : 'default'}
          label={`${summary.rejected} rejected`}
          variant="outlined"
        />
        <Chip
          color={summary.blocked ? 'warning' : 'default'}
          label={`${summary.blocked} blocked`}
          variant="outlined"
        />
        {status && (
          <>
            <Chip
              color={status.mode === 'live' ? 'warning' : 'default'}
              label={`${status.mode} · ${status.environment}`}
              variant="outlined"
            />
            <Chip
              color={status.credentialsConfigured ? 'success' : 'default'}
              label={status.credentialsConfigured ? 'Credentials configured' : 'No credentials'}
              variant="outlined"
            />
            <Chip
              label={`Ledger: ${status.ledger.salesSent} sales · ${status.ledger.cancelsSent} cancels · ${status.ledger.pendingOrFailed} open`}
              variant="outlined"
            />
          </>
        )}
      </Stack>

      {statusError && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setStatusError(null)}>
          RSD server not reachable: {statusError}. Queued packs stay here and are retried
          automatically once it is back.
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={1.5} sx={{ mb: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            size="small"
            label="Search invoice / GTIN / serial / RC"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: 320 }}
          />
          <Select
            size="small"
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="all">All units</MenuItem>
            <MenuItem value="attention">Needs attention</MenuItem>
            <MenuItem value="pending">Queued</MenuItem>
            <MenuItem value="sent">Reported</MenuItem>
          </Select>
          <Typography variant="caption" color="text.secondary">
            {rows.length} shown{lastFlushAt ? ` · last attempt ${timestamp(lastFlushAt)}` : ''}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Button
            size="small"
            startIcon={<SendIcon />}
            onClick={() => void flush()}
            disabled={isFlushing || summary.pending === 0}
          >
            {isFlushing ? 'Sending…' : 'Send pending'}
          </Button>
          <Button
            size="small"
            startIcon={<RefreshIcon />}
            onClick={() => {
              setChecking(true);
              void refreshStatus();
            }}
            disabled={checking}
          >
            {checking ? 'Checking…' : 'Refresh server'}
          </Button>
        </Stack>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Updated</TableCell>
                <TableCell>Invoice</TableCell>
                <TableCell>Movement</TableCell>
                <TableCell>GTIN</TableCell>
                <TableCell>Serial</TableCell>
                <TableCell>Batch</TableCell>
                <TableCell>Expiry</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Tries</TableCell>
                <TableCell>SFDA answer</TableCell>
                <TableCell align="right">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                      {queue.length === 0
                        ? 'Nothing has been queued yet. A serialised drug pack appears here after its sale is completed.'
                        : 'No units match this filter.'}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {rows.map((item) => (
                <TableRow key={item.id} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{timestamp(item.updatedAt)}</TableCell>
                  <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{item.invoiceNo}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{movementLabel(item)}</TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{item.unit.gtin}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{item.unit.serialNo}</Typography>
                  </TableCell>
                  <TableCell>{item.unit.batchNo || '—'}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{item.unit.expiryDate || '—'}</TableCell>
                  <TableCell>
                    <Chip size="small" color={STATUS_COLOR[item.status]} label={STATUS_LABEL[item.status]} />
                  </TableCell>
                  <TableCell align="right">{item.attempts}</TableCell>
                  <TableCell sx={{ maxWidth: 340 }}>
                    {item.rc && (
                      <Typography variant="caption" sx={{ display: 'block', fontWeight: 600 }}>
                        {item.rc}
                      </Typography>
                    )}
                    {item.message && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {item.message}
                      </Typography>
                    )}
                    {!item.rc && !item.message && '—'}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {item.status === 'rejected' ? (
                      <Button
                        size="small"
                        color="warning"
                        startIcon={<ReplayIcon />}
                        onClick={() => void retry(item.id)}
                        disabled={isFlushing}
                      >
                        Retry
                      </Button>
                    ) : item.status === 'blocked' ? (
                      <Tooltip title="The original sale was never accepted, so there is nothing to cancel. Retry the sale row first.">
                        <span>
                          <Button size="small" disabled>Retry</Button>
                        </span>
                      </Tooltip>
                    ) : (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Alert severity="info" sx={{ mt: 2 }}>
        A partial return sends nothing to RSD: the service has no partial-pack cancellation, so
        those units stay reported as sold until the entire invoice is returned. A full return of an
        invoice queues <strong>Pharmacy Sale Cancel</strong> once per accepted pack.
      </Alert>
    </Box>
  );
}
