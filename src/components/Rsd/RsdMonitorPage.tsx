// RSD reporting monitor: every physical pack the POS has queued for SFDA, and what SFDA said.
//
// This is deliberately not an invoice list. RSD is unit-level (GTIN + serial), one sale and one
// cancel per pack, so the unit is the row. An invoice column links it back to the sale.
//
// The queue is local-first: "Queued" means the app still owes SFDA a report (server down, timeout,
// or a sale not accepted yet). "Rejected" is a business answer from SFDA and is never retried
// automatically; the Retry button reopens it on the server first, exactly like the trial's
// --retry-rejected, so an account fix (FC 21017) can be applied and the same payload sent again.
import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import ReplayIcon from '@mui/icons-material/Replay';
import RefreshIcon from '@mui/icons-material/Refresh';
import type { ChipProps } from '@mui/material';
import type { RsdStatus } from '../../api/rsdApi';
import { getRsdStatus } from '../../api/rsdApi';
import { useRsdOutboxStore } from '../../store/rsdOutboxStore';
import { rsdQueueSummary, type RsdOutboxItem, type RsdOutboxStatus } from '../../utils/rsdOutbox';

type Filter = 'all' | RsdOutboxStatus;

const STATUS_LABEL: Record<RsdOutboxStatus, { label: string; color: ChipProps['color']; help: string }> = {
  pending: {
    label: 'Queued',
    color: 'warning',
    help: 'Not reported yet. Retried automatically every 60 seconds (and on app load).',
  },
  sent: { label: 'Sent', color: 'success', help: 'Accepted by SFDA (RC 00000, or already in its ledger).' },
  rejected: {
    label: 'Rejected',
    color: 'error',
    help: 'SFDA answered with a business rejection. Not retried automatically; fix the cause, then Retry.',
  },
  blocked: {
    label: 'Blocked',
    color: 'default',
    help: 'Its sale was never accepted by RSD, so a cancellation cannot be sent. Retry the sale first.',
  },
};

function StatusChip({ status }: { status: RsdOutboxStatus }) {
  const entry = STATUS_LABEL[status];
  return (
    <Tooltip title={entry.help}>
      <Chip size="small" color={entry.color} label={entry.label} variant="outlined" />
    </Tooltip>
  );
}

function saleOf(queue: RsdOutboxItem[], cancel: RsdOutboxItem): RsdOutboxItem | undefined {
  return queue.find(
    (item) =>
      item.kind === 'sale' &&
      item.unit.gtin === cancel.unit.gtin &&
      item.unit.serialNo === cancel.unit.serialNo,
  );
}

// A blocked cancel is unblocked by retrying its sale, so it is never retried on its own.
function blockedCancel(queue: RsdOutboxItem[], item: RsdOutboxItem): boolean {
  if (item.status !== 'blocked') return false;
  return saleOf(queue, item)?.status !== 'sent';
}

export default function RsdMonitorPage() {
  const queue = useRsdOutboxStore((s) => s.queue);
  const isFlushing = useRsdOutboxStore((s) => s.isFlushing);
  const flush = useRsdOutboxStore((s) => s.flush);
  const retry = useRsdOutboxStore((s) => s.retry);

  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<RsdStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const summary = useMemo(() => rsdQueueSummary(queue), [queue]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return [...queue]
      .filter((item) => (filter === 'all' ? true : item.status === filter))
      .filter((item) => {
        if (!needle) return true;
        return (
          item.invoiceNo.toLowerCase().includes(needle) ||
          item.unit.gtin.includes(needle) ||
          item.unit.serialNo.toLowerCase().includes(needle) ||
          (item.rc ?? '').includes(needle)
        );
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [queue, filter, search]);

  async function refreshStatus() {
    try {
      setStatus(await getRsdStatus());
      setStatusError(null);
    } catch (err) {
      setStatus(null);
      setStatusError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    // Same shape as ZatcaInvoicesPanel: the state writes happen after the await, and a cancellation
    // flag keeps a slow/aborted status call from writing into an unmounted page.
    let cancelled = false;
    (async () => {
      try {
        const next = await getRsdStatus();
        if (!cancelled) {
          setStatus(next);
          setStatusError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setStatus(null);
          setStatusError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function retryItem(item: RsdOutboxItem) {
    setBusyId(item.id);
    try {
      await retry(item.id);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1400 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
        <Typography component="h2" variant="h6" sx={{ fontWeight: 700 }}>
          RSD / SFDA reporting
        </Typography>
        <Chip
          size="small"
          variant="outlined"
          color={status?.mode === 'live' ? 'success' : 'default'}
          label={status ? `${status.mode} · ${status.environment}` : 'server status unknown'}
        />
        {status && (
          <Chip
            size="small"
            variant="outlined"
            color={status.credentialsConfigured ? 'success' : 'error'}
            label={status.credentialsConfigured ? 'credentials configured' : 'credentials missing'}
          />
        )}
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<RefreshIcon />} onClick={() => void refreshStatus()}>
          Refresh
        </Button>
        <Button
          size="small"
          variant="contained"
          startIcon={<SendIcon />}
          disabled={isFlushing || summary.pending === 0}
          onClick={() => void flush()}
        >
          {isFlushing ? 'Sending…' : 'Send now'}
        </Button>
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Every serialised drug pack sold at the till is reported to SFDA here, and a full return
        cancels it. Supplies and items without Batch / expiry tracking in Item Master are never
        queued. A sale is saved locally first, so nothing here can block the POS.
      </Typography>

      {statusError && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          RSD server not reachable: {statusError} Queued reports stay in the outbox and are retried
          every 60 seconds.
        </Alert>
      )}

      {status?.mode === 'mock' && (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          RSD is in mock mode, so nothing is sent to SFDA. The whole queue is exercised against the
          local simulated service.
        </Alert>
      )}

      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Chip label={`${summary.total} units`} variant="outlined" />
        <Chip
          color={summary.sent ? 'success' : 'default'}
          label={`${summary.sent} sent`}
          variant="outlined"
        />
        <Chip
          color={summary.pending ? 'warning' : 'default'}
          label={`${summary.pending} queued`}
          variant="outlined"
        />
        <Chip
          color={summary.rejected ? 'error' : 'default'}
          label={`${summary.rejected} rejected`}
          variant="outlined"
        />
        <Chip
          color={summary.blocked ? 'error' : 'default'}
          label={`${summary.blocked} blocked`}
          variant="outlined"
        />
      </Stack>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={2} sx={{ mb: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            size="small"
            label="Search invoice / GTIN / serial / RC"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: 300 }}
          />
          <Select
            size="small"
            inputProps={{ 'aria-label': 'Filter RSD units' }}
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
            sx={{ minWidth: 190 }}
          >
            <MenuItem value="all">All units</MenuItem>
            <MenuItem value="pending">Queued</MenuItem>
            <MenuItem value="sent">Sent</MenuItem>
            <MenuItem value="rejected">Rejected</MenuItem>
            <MenuItem value="blocked">Blocked</MenuItem>
          </Select>
          <Typography variant="caption" color="text.secondary">
            {rows.length} shown
          </Typography>
        </Stack>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Queued</TableCell>
                <TableCell>Invoice</TableCell>
                <TableCell>Movement</TableCell>
                <TableCell>GTIN</TableCell>
                <TableCell>Serial</TableCell>
                <TableCell>Batch</TableCell>
                <TableCell>Expiry</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>RC / reason</TableCell>
                <TableCell align="right">Tries</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                      {summary.total === 0
                        ? 'Nothing queued yet. Sell a batch-tracked drug with a scanned DataMatrix to see it here.'
                        : 'No units match this filter.'}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {rows.map((item) => {
                const canRetry = item.status === 'rejected';
                const blocked = blockedCancel(queue, item);
                return (
                  <TableRow key={item.id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{item.createdAt.slice(0, 16).replace('T', ' ')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{item.invoiceNo}</TableCell>
                    <TableCell>{item.kind === 'sale' ? 'Sale' : 'Cancel'}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{item.unit.gtin}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{item.unit.serialNo}</TableCell>
                    <TableCell>{item.unit.batchNo}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{item.unit.expiryDate}</TableCell>
                    <TableCell>
                      <StatusChip status={item.status} />
                    </TableCell>
                    <TableCell sx={{ maxWidth: 320 }}>
                      {item.rc && (
                        <Typography variant="caption" sx={{ fontFamily: 'monospace', mr: 0.5 }}>
                          {item.rc}
                        </Typography>
                      )}
                      {item.message && (
                        <Typography variant="caption" color="text.secondary">
                          {item.message}
                        </Typography>
                      )}
                      {item.notificationId && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          notification {item.notificationId}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">{item.attempts}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {canRetry && (
                        <Tooltip title="Reopen this rejection on the server and send the same payload again">
                          <span>
                            <Button
                              size="small"
                              color="warning"
                              startIcon={<ReplayIcon />}
                              disabled={busyId !== null}
                              onClick={() => void retryItem(item)}
                            >
                              {busyId === item.id ? 'Sending…' : 'Retry'}
                            </Button>
                          </span>
                        </Tooltip>
                      )}
                      {item.status === 'pending' && (
                        <Button size="small" disabled={isFlushing} onClick={() => void flush()}>
                          Send now
                        </Button>
                      )}
                      {blocked && !canRetry && (
                        <Tooltip title="Retry the rejected sale for this unit first; a cancellation can only follow an accepted sale.">
                          <span>
                            <Button size="small" disabled>
                              Blocked
                            </Button>
                          </span>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {status && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Sale service: {status.saleUrl || '—'} · Cancel service: {status.cancelUrl || '—'} · Direct
            to-GLN: {status.directToGln}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Server ledger: {status.ledger.records} records · {status.ledger.salesSent} sales sent ·{' '}
            {status.ledger.cancelsSent} cancels sent · {status.ledger.pendingOrFailed} not accepted
          </Typography>
        </Box>
      )}
    </Box>
  );
}
