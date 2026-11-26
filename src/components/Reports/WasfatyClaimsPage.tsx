// Wasfaty / NUPCO claim report.
//
// The rows are built from SAVED sales (utils/wasfaty.ts's buildWasfatyClaimRows), never from the
// item master, so re-mapping an item or changing a NUPCO price never rewrites an issued claim.
// The month/branch filters and the CSV are the pharmacy's own reporting; the lower card reads the
// app's server-side claim ledger (server/src/routes/wasfaty.ts), which is what a live NUPCO
// connection will eventually reconcile against.
import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import GridOnIcon from '@mui/icons-material/GridOn';
import PrintIcon from '@mui/icons-material/Print';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useBranchSales } from '../../store/branchSelectors';
import { useCostCenterStore } from '../../store/costCenterStore';
import {
  buildWasfatyClaimRows, claimMonths, claimsToAoa, claimsToCsv, summariseWasfatyClaims,
  summariseWasfatyClaimsByItem,
} from '../../utils/wasfaty';
import { formatMoney, formatQty } from '../../utils/format';
import type { WasfatyClaim } from '../../types/wasfaty';
import * as wasfatyApi from '../../api/wasfatyApi';
import WasfatyClaimsPrintDialog from './WasfatyClaimsPrintDialog';
import WasfatyClaimReconcileDialog, { type ReconcileInput } from './WasfatyClaimReconcileDialog';

import { T, useT } from '../../i18n';
export default function WasfatyClaimsPage() {
  const tr = useT();
  const invoices = useBranchSales();
  const centers = useCostCenterStore((s) => s.centers);
  const [month, setMonth] = useState('');
  const [branchId, setBranchId] = useState('');
  const [printOpen, setPrintOpen] = useState(false);
  const [printStamp, setPrintStamp] = useState('');

  const branchNames = useMemo(
    () => Object.fromEntries(centers.map((c) => [c.id, c.nameEn || c.nameAr])),
    [centers],
  );
  const months = useMemo(() => claimMonths(invoices), [invoices]);
  const rows = useMemo(
    () => buildWasfatyClaimRows(invoices, { month: month || undefined, branchId: branchId || undefined, branchNames }),
    [invoices, month, branchId, branchNames],
  );
  const summary = useMemo(() => summariseWasfatyClaims(rows), [rows]);
  const branchLabel = branchId
    ? centers.find((center) => center.id === branchId)?.nameEn ||
      centers.find((center) => center.id === branchId)?.nameAr ||
      branchId
    : 'All branches';

  const [serverClaims, setServerClaims] = useState<{
    loading: boolean;
    error?: string;
    claims: WasfatyClaim[];
  }>({ loading: false, claims: [] });
  // Submit/reconcile are server operations. Manual mode (the Phase 0 default) records dispenses but
  // has no NUPCO connection, so the buttons are disabled and explained rather than left to fail
  // with a 503. Unknown means the health call has not answered yet; allow the action and let the
  // API decide.
  const [canSubmitClaims, setCanSubmitClaims] = useState(true);
  const [claimAction, setClaimAction] = useState<{ claimId: string; kind: 'submit' | 'reconcile' } | null>(null);
  const [claimActionError, setClaimActionError] = useState<string | undefined>();
  const [claimActionNotice, setClaimActionNotice] = useState('');
  const [reconcileTarget, setReconcileTarget] = useState<WasfatyClaim | null>(null);

  async function loadServerClaims() {
    setServerClaims((s) => ({ ...s, loading: true, error: undefined }));
    try {
      const result = await wasfatyApi.listWasfatyClaims({ month: month || undefined });
      setServerClaims({ loading: false, claims: result.claims });
    } catch (err) {
      setServerClaims({
        loading: false,
        claims: [],
        error: `${err instanceof Error ? err.message : String(err)} — the local report above is complete; only the server ledger is unavailable.`,
      });
    }
  }

  // Reload when the month filter changes, so the server ledger matches the local report above. The
  // refresh button covers a dispense mirrored while the page is open.
  useEffect(() => {
    loadServerClaims();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  useEffect(() => {
    let cancelled = false;
    wasfatyApi.getWasfatyHealth()
      .then((health) => {
        if (!cancelled) setCanSubmitClaims(health.capabilities.submitClaim);
      })
      .catch(() => {
        // No health endpoint (server down): the ledger load already explains it. Leave the action
        // buttons enabled so a transient health failure does not hide a working submit endpoint.
        if (!cancelled) setCanSubmitClaims(true);
      });
    return () => { cancelled = true; };
  }, []);

  function replaceClaim(claim: WasfatyClaim) {
    setServerClaims((s) => ({
      ...s,
      claims: s.claims.map((existing) => (existing.id === claim.id ? claim : existing)),
    }));
  }

  async function submitClaim(claim: WasfatyClaim) {
    setClaimAction({ claimId: claim.id, kind: 'submit' });
    setClaimActionError(undefined);
    setClaimActionNotice('');
    try {
      const result = await wasfatyApi.submitWasfatyClaim(claim.id);
      replaceClaim(result.claim);
      setClaimActionNotice(`Claim ${claim.id} submitted — status ${result.claim.status}.`);
    } catch (err) {
      setClaimActionError(`${claim.id}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setClaimAction(null);
    }
  }

  async function reconcileClaim(input: ReconcileInput) {
    if (!reconcileTarget) return;
    const id = reconcileTarget.id;
    setClaimAction({ claimId: id, kind: 'reconcile' });
    setClaimActionError(undefined);
    try {
      const result = await wasfatyApi.reconcileWasfatyClaim(id, input);
      replaceClaim(result.claim);
      setClaimActionNotice(`Claim ${id} reconciled — status ${result.claim.status}.`);
      setReconcileTarget(null);
    } catch (err) {
      setClaimActionError(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setClaimAction(null);
    }
  }

  function downloadCsv() {
    const csv = claimsToCsv(rows);
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `wasfaty-claims-${month || 'all'}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function downloadExcel() {
    const XLSX = await import('xlsx');
    const workbook = XLSX.utils.book_new();

    const detail = XLSX.utils.aoa_to_sheet(claimsToAoa(rows));
    detail['!cols'] = [
      { wch: 14 }, { wch: 20 }, { wch: 18 }, { wch: 10 }, { wch: 18 }, { wch: 16 }, { wch: 16 },
      { wch: 16 }, { wch: 15 }, { wch: 30 }, { wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 6 },
      { wch: 8 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 18 },
      { wch: 28 },
    ];
    XLSX.utils.book_append_sheet(workbook, detail, 'Claim lines');

    const byItem = summariseWasfatyClaimsByItem(rows);
    const itemSheet = XLSX.utils.aoa_to_sheet([
      ['NUPCO Code', 'Item Name EN', 'Item Name AR', 'Lines', 'Qty', 'Line Total', 'Patient Share', 'Claim Amount'],
      ...byItem.map((entry) => [
        entry.nupcoCode,
        entry.itemNameEn,
        entry.itemNameAr,
        entry.lines,
        entry.qty,
        entry.lineTotal,
        entry.patientShare,
        entry.claimAmount,
      ]),
    ]);
    itemSheet['!cols'] = [
      { wch: 15 }, { wch: 32 }, { wch: 30 }, { wch: 7 }, { wch: 8 }, { wch: 12 }, { wch: 13 }, { wch: 13 },
    ];
    XLSX.utils.book_append_sheet(workbook, itemSheet, 'By item');

    const exceptionSheet = XLSX.utils.aoa_to_sheet([
      ['Exception', 'Lines'],
      ...Object.entries(summary.byException).sort((a, b) => b[1] - a[1]),
    ]);
    exceptionSheet['!cols'] = [{ wch: 32 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(workbook, exceptionSheet, 'Exceptions');

    XLSX.writeFile(workbook, `wasfaty-claims-${month || 'all'}.xlsx`);
  }

  function openPrint() {
    setPrintStamp(new Date().toISOString());
    setPrintOpen(true);
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1.5, mb: 1 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}><T>Wasfaty / NUPCO claims</T></Typography>
          <Typography variant="caption" color="text.secondary">
            <T>One row per covered sale line, from the issued invoice — never recomputed from today’s item master</T>
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={downloadCsv} disabled={rows.length === 0}>
            <T>CSV</T>
          </Button>
          <Button variant="outlined" startIcon={<GridOnIcon />} onClick={downloadExcel} disabled={rows.length === 0}>
            <T>Excel</T>
          </Button>
          <Button variant="outlined" startIcon={<PrintIcon />} onClick={openPrint} disabled={rows.length === 0}>
            <T>Print</T>
          </Button>
        </Stack>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 2 }}>
        <Chip size="small" variant="outlined" label={`${summary.rows} lines`} />
        <Chip size="small" variant="outlined" color="primary" label={`${summary.invoices} invoices`} />
        <Chip size="small" variant="outlined" color="success" label={`Claim SAR ${formatMoney(summary.claimAmount)}`} />
        <Chip size="small" variant="outlined" label={`Patient share SAR ${formatMoney(summary.patientShare)}`} />
        <Chip
          size="small"
          variant={summary.exceptions > 0 ? 'filled' : 'outlined'}
          color={summary.exceptions > 0 ? 'warning' : 'default'}
          label={`${summary.exceptions} exception line(s)`}
        />
      </Stack>

      {summary.exceptions > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <T>Exceptions are exported as rows, not silently zeroed:</T>{' '}
          {Object.entries(summary.byException).map(([reason, count]) => `${reason} (${count})`).join(' · ')}
        </Alert>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField
          select
          size="small"
          label={tr('Claim month')}
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value=""><T>All months</T></MenuItem>
          {months.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
        </TextField>
        <TextField
          select
          size="small"
          label={tr('Branch')}
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value=""><T>All branches</T></MenuItem>
          {centers.map((c) => <MenuItem key={c.id} value={c.id}>{c.nameEn || c.nameAr}</MenuItem>)}
        </TextField>
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell><T>Invoice / date</T></TableCell>
              <TableCell><T>Prescription / auth</T></TableCell>
              <TableCell><T>Item</T></TableCell>
              <TableCell><T>NUPCO code</T></TableCell>
              <TableCell align="right"><T>Qty</T></TableCell>
              <TableCell align="right"><T>Claim</T></TableCell>
              <TableCell align="right"><T>Patient share</T></TableCell>
              <TableCell><T>Status</T></TableCell>
              <TableCell><T>Exception</T></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={9}>
                  <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                    <T>No Wasfaty sales in this view yet. Complete a dispense from the POS to see it here.</T>
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {rows.map((row, index) => (
              <TableRow key={`${row.invoiceNo}-${row.nupcoCode}-${index}`} hover>
                <TableCell>
                  <Typography variant="body2">{row.invoiceNo}</Typography>
                  <Typography variant="caption" color="text.secondary">{row.invoiceDate.slice(0, 10)}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{row.prescriptionNo || '—'}</Typography>
                  <Typography variant="caption" color="text.secondary">{row.authorizationNo || tr("No authorization")}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{row.itemNameEn}</Typography>
                  <Typography variant="caption" color="text.secondary">{row.itemNameAr} <T>· batch</T> {row.batchNo}</Typography>
                </TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{row.nupcoCode || '—'}</TableCell>
                <TableCell align="right">{formatQty(row.qty)} {row.unit}</TableCell>
                <TableCell align="right">{formatMoney(row.claimAmount)}</TableCell>
                <TableCell align="right">{formatMoney(row.patientShare)}</TableCell>
                <TableCell><Chip size="small" variant="outlined" label={row.status} /></TableCell>
                <TableCell>
                  {row.exception ? <Chip size="small" color="warning" label={row.exception} /> : <Typography variant="caption" color="text.secondary">—</Typography>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={{ mt: 3 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}><T>Server claim ledger</T></Typography>
          <Button size="small" startIcon={<RefreshIcon />} onClick={loadServerClaims} disabled={serverClaims.loading}>
            {serverClaims.loading ? tr("Loading…") : tr("Refresh")}
          </Button>
        </Stack>
        {claimActionNotice && (
          <Alert severity="success" onClose={() => setClaimActionNotice('')} sx={{ mb: 1 }}>
            {claimActionNotice}
          </Alert>
        )}
        {claimActionError && !reconcileTarget && (
          <Alert severity="error" onClose={() => setClaimActionError(undefined)} sx={{ mb: 1 }}>
            {claimActionError}
          </Alert>
        )}
        {!canSubmitClaims && (
          <Alert severity="info" sx={{ mb: 1 }}>
            <T>Manual Wasfaty mode: dispenses are recorded locally, but claims cannot be submitted to
            NUPCO until a live provider is configured in Settings.</T>
          </Alert>
        )}
        {serverClaims.error ? (
          <Alert severity="info">{serverClaims.error}</Alert>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell><T>Claim</T></TableCell>
                  <TableCell><T>Dispense</T></TableCell>
                  <TableCell><T>Invoice</T></TableCell>
                  <TableCell><T>Month</T></TableCell>
                  <TableCell align="right"><T>Expected</T></TableCell>
                  <TableCell align="right"><T>Reported</T></TableCell>
                  <TableCell align="right"><T>Paid</T></TableCell>
                  <TableCell><T>Status</T></TableCell>
                  <TableCell align="right"><T>Actions</T></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {serverClaims.claims.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9}>
                      <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                        <T>No claims recorded on the server yet. A dispense is mirrored there automatically after checkout.</T>
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {serverClaims.claims.map((claim) => {
                  const busy = claimAction?.claimId === claim.id;
                  const canReconcile = claim.status !== 'cancelled' && claim.status !== 'reconciled';
                  return (
                    <TableRow key={claim.id} hover>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{claim.id}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{claim.dispenseId}</TableCell>
                      <TableCell>{claim.invoiceNo ?? '—'}</TableCell>
                      <TableCell>{claim.month}</TableCell>
                      <TableCell align="right">{formatMoney(claim.expectedAmount)}</TableCell>
                      <TableCell align="right">{claim.reportedAmount == null ? '—' : formatMoney(claim.reportedAmount)}</TableCell>
                      <TableCell align="right">{claim.paidAmount == null ? '—' : formatMoney(claim.paidAmount)}</TableCell>
                      <TableCell>
                        <Chip size="small" variant="outlined" label={claim.status} />
                        {claim.varianceReason && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {claim.varianceReason}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        {claim.status === 'pending' ? (
                          <Button
                            size="small"
                            disabled={!canSubmitClaims || !!claimAction}
                            onClick={() => submitClaim(claim)}
                          >
                            {busy ? tr("Submitting…") : tr("Submit")}
                          </Button>
                        ) : canReconcile ? (
                          <Button
                            size="small"
                            disabled={!canSubmitClaims || !!claimAction}
                            onClick={() => {
                              setClaimActionError(undefined);
                              setReconcileTarget(claim);
                            }}
                          >
                            <T>Reconcile</T>
                          </Button>
                        ) : (
                          <Typography variant="caption" color="text.secondary">—</Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>

      <WasfatyClaimsPrintDialog
        open={printOpen}
        rows={rows}
        summary={summary}
        month={month}
        branchLabel={branchLabel}
        generatedAt={printStamp}
        onClose={() => setPrintOpen(false)}
      />

      {reconcileTarget && (
        <WasfatyClaimReconcileDialog
          key={reconcileTarget.id}
          claim={reconcileTarget}
          busy={claimAction?.kind === 'reconcile'}
          error={claimActionError}
          onClose={() => {
            if (claimAction?.kind === 'reconcile') return;
            setReconcileTarget(null);
            setClaimActionError(undefined);
          }}
          onConfirm={reconcileClaim}
        />
      )}
    </Box>
  );
}
