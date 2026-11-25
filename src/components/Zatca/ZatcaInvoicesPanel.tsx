// The Fatoora/ZATCA Phase 2 control panel for SALES invoices - the third tab of Point of Sale
// (Sell / Returns / ZATCA Sales Invoices).
//
// It moved out of Settings because the invoice list belongs to the counter workflow, not to device
// setup: after ringing up or refunding a sale the cashier needs to reprint, retry or inspect the
// document without leaving the till. Settings keeps only identity and onboarding, which really are
// one-time configuration.
//
// Checkout already submits what it can (POSPage), but the outcome would otherwise be only a chip
// on the receipt: an invoice sold while the ZATCA server was down could never be sent, the signed
// XML was never retrievable, and nobody could answer "which invoices are not compliant yet?".
// This panel is that missing half of Phase 2:
//   - every sale with its submission state, and what that state actually means;
//   - resubmission for anything that was never accepted (the usual cause is onboarding/infra, not
//     the document);
//   - the signed UBL XML ZATCA accepted, pulled from the server's retention archive;
//   - the printable A4 tax invoice, rebuilt from the stored sale.
//
// Nothing here recomputes a sale. A retry re-sends the document as issued (utils/zatcaInvoice.ts
// buildSubmitRequest), so prices, VAT and the buyer cannot drift between the first attempt and the
// last.
import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem,
  Paper, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Typography,
} from '@mui/material';
import ReplayIcon from '@mui/icons-material/Replay';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import PrintIcon from '@mui/icons-material/Print';
import CodeIcon from '@mui/icons-material/Code';
import MedicationOutlinedIcon from '@mui/icons-material/MedicationOutlined';

import type { SaleHeader } from '../../types/sales';
import { useSalesStore } from '../../store/salesStore';
import { useRsdOutboxStore } from '../../store/rsdOutboxStore';
import * as zatcaApi from '../../api/zatcaApi';
import {
  buildSubmitRequest, classifyZatcaCheckoutFailure, needsResubmission, shortUuid,
  zatcaPatchFromSubmission, zatcaStatusLabel, zatcaSummary,
} from '../../utils/zatcaInvoice';
import { rsdInvoiceSummary } from '../../utils/rsdOutbox';
import { hasDosages } from '../../utils/dosages';
import { formatMoney } from '../../utils/format';
import TaxInvoiceDocument from './TaxInvoiceDocument';
import DosagePrintView from '../POS/DosagePrintView';
import ReceiptView from '../POS/ReceiptView';

type Filter = 'all' | 'needs' | 'failed' | 'accepted';

export default function ZatcaInvoicesPanel() {
  const invoices = useSalesStore((s) => s.invoices);
  const updateInvoiceZatca = useSalesStore((s) => s.updateInvoiceZatca);
  const rsdQueue = useRsdOutboxStore((s) => s.queue);

  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [printInvoice, setPrintInvoice] = useState<SaleHeader | null>(null);
  // Two different documents, two buttons: the A4 tax invoice the buyer files, and the 80mm till
  // receipt the customer walked out with. Reprinting either must never require rebuilding the sale.
  const [printReceipt, setPrintReceipt] = useState<SaleHeader | null>(null);
  // Historical directions reprint: the sale carries its own frozen snapshot, so this shows exactly
  // what was dispensed even after the DOS library has moved on.
  const [printDosages, setPrintDosages] = useState<SaleHeader | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [serverUp, setServerUp] = useState<boolean | null>(null);
  const [onboarding, setOnboarding] = useState<zatcaApi.OnboardingStatus | null>(null);

  const [xml, setXml] = useState<{ invoice: SaleHeader; text: string } | null>(null);
  const [xmlBusy, setXmlBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const up = await zatcaApi.isServerReachable();
      if (cancelled) return;
      setServerUp(up);
      if (up) {
        try {
          const status = await zatcaApi.getOnboardingStatus();
          if (!cancelled) setOnboarding(status);
        } catch {
          // Reachable but not answering the onboarding route - leave the status unknown rather
          // than claiming "not onboarded", which would send someone down the wrong path.
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const summary = useMemo(() => zatcaSummary(invoices), [invoices]);

  // The RSD side of the same invoice: how many of its serialised drug packs have been reported.
  // Invoices with no queued packs (no serialised drugs, or RSD was off) get no chip at all, which
  // is the honest answer - not a green "sent" for something that was never in scope.
  const rsdByInvoice = useMemo(() => {
    const grouped = new Map<string, typeof rsdQueue>();
    for (const item of rsdQueue) {
      const items = grouped.get(item.invoiceId);
      if (items) items.push(item);
      else grouped.set(item.invoiceId, [item]);
    }
    const result = new Map<string, ReturnType<typeof rsdInvoiceSummary>>();
    for (const [invoiceId, items] of grouped) result.set(invoiceId, rsdInvoiceSummary(items));
    return result;
  }, [rsdQueue]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return [...invoices]
      .filter((inv) => {
        if (filter === 'needs' && !needsResubmission(inv)) return false;
        if (filter === 'failed' && inv.zatcaStatus !== 'submission_failed') return false;
        if (filter === 'accepted' && (inv.zatcaStatus !== 'phase2_cleared' && inv.zatcaStatus !== 'phase2_reported')) return false;
        if (!needle) return true;
        return (
          inv.invoiceNo.toLowerCase().includes(needle) ||
          (inv.customerNameEn ?? '').toLowerCase().includes(needle) ||
          (inv.customerNameAr ?? '').toLowerCase().includes(needle) ||
          (inv.zatcaUuid ?? '').toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [invoices, filter, search]);

  async function retry(invoice: SaleHeader) {
    setBusyId(invoice.id);
    setError(null);
    setNotice(null);
    try {
      const result = await zatcaApi.submitInvoice(buildSubmitRequest(invoice));
      const patch = zatcaPatchFromSubmission(result, invoice.invoiceType, new Date().toISOString());
      updateInvoiceZatca(invoice.id, patch);
      if (result.status === 'failed') {
        setError(`${invoice.invoiceNo}: ${patch.zatcaFailureReason ?? 'ZATCA rejected the document.'} See the reason on the row.`);
      } else {
        setNotice(`${invoice.invoiceNo}: accepted by ZATCA (${result.status}).`);
      }
    } catch (err) {
      // Infrastructure/onboarding problems are NOT document rejections - record the reason but keep
      // the invoice in the retryable bucket instead of marking it as ZATCA-rejected.
      const reason = err instanceof Error ? err.message : String(err);
      updateInvoiceZatca(invoice.id, {
        zatcaStatus: classifyZatcaCheckoutFailure(err) === 'server_unavailable'
          ? 'phase1_fallback'
          : 'pending_submission',
        zatcaFailureReason: reason,
      });
      setError(`${invoice.invoiceNo}: ${reason}`);
    } finally {
      setBusyId(null);
    }
  }

  async function viewXml(invoice: SaleHeader) {
    if (!invoice.zatcaUuid) {
      setError(`${invoice.invoiceNo} was never accepted by ZATCA, so no signed XML exists for it.`);
      return;
    }
    setXmlBusy(true);
    setError(null);
    try {
      const archived = await zatcaApi.getArchivedInvoice(invoice.zatcaUuid);
      setXml({ invoice, text: archived.signedXml });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setXmlBusy(false);
    }
  }

  function downloadXml() {
    if (!xml) return;
    const blob = new Blob([xml.text], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${xml.invoice.invoiceNo}-${xml.invoice.zatcaUuid ?? 'unsigned'}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const serverLine = serverUp === null
    ? 'Checking the ZATCA server…'
    : serverUp
      ? `ZATCA server reachable · ${onboarding ? `environment ${onboarding.environment} · step ${onboarding.step}` : 'onboarding status unknown'}`
      : 'ZATCA server not reachable - sales are recorded, but nothing can be submitted until it is started.';

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Every sales invoice with the Fatoora state it was issued in. Standard invoices are cleared by
        ZATCA before issue; simplified ones are reported within 24 hours. An invoice that never got
        through stays here until it is accepted.
      </Typography>

      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Chip label={`${summary.total} invoices`} variant="outlined" />
        <Chip color="success" label={`${summary.cleared + summary.reported} accepted`} variant="outlined" />
        <Chip
          color={summary.needsSubmission ? 'warning' : 'default'}
          label={`${summary.needsSubmission} awaiting submission`}
          variant="outlined"
        />
        <Chip
          color={summary.failed ? 'error' : 'default'}
          label={`${summary.failed} rejected`}
          variant="outlined"
        />
        <Chip
          color={serverUp === false ? 'error' : serverUp ? 'success' : 'default'}
          label={serverLine}
          variant="outlined"
        />
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 1.5 }} onClose={() => setNotice(null)}>{notice}</Alert>}

      {summary.needsSubmission > 0 && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          {summary.needsSubmission} invoice{summary.needsSubmission === 1 ? '' : 's'} not yet accepted by
          ZATCA. These were sold while the signing server was unavailable or not onboarded - press
          Retry once it is running. Nothing was lost: the sale, the QR and the totals are all stored.
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={2} sx={{ mb: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            size="small"
            label="Search invoice / customer / UUID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: 280 }}
          />
          <Select
            size="small"
            inputProps={{ 'aria-label': 'Filter ZATCA invoices' }}
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="all">All invoices</MenuItem>
            <MenuItem value="needs">Awaiting submission</MenuItem>
            <MenuItem value="failed">Rejected</MenuItem>
            <MenuItem value="accepted">Accepted</MenuItem>
          </Select>
          <Typography variant="caption" color="text.secondary">
            {rows.length} shown
          </Typography>
        </Stack>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Invoice</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Customer</TableCell>
                <TableCell align="right">Total (SAR)</TableCell>
                <TableCell>ZATCA</TableCell>
                <TableCell>RSD</TableCell>
                <TableCell>UUID</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                      No invoices match this filter.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {rows.map((inv) => {
                const label = zatcaStatusLabel(inv.zatcaStatus);
                const canRetry = needsResubmission(inv);
                const rsd = rsdByInvoice.get(inv.id);
                const rsdColor =
                  rsd?.state === 'sent'
                    ? 'success'
                    : rsd?.state === 'queued'
                      ? 'info'
                      : rsd?.state === 'rejected'
                        ? 'error'
                        : 'default';
                return (
                  <TableRow key={inv.id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{inv.date.slice(0, 10)}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{inv.invoiceNo}</TableCell>
                    <TableCell>{inv.invoiceType === 'standard' ? 'Standard' : 'Simplified'}</TableCell>
                    <TableCell>{inv.customerNameEn || inv.customerNameAr || 'Walk-in'}</TableCell>
                    <TableCell align="right">{formatMoney(inv.totalInclVat)}</TableCell>
                    <TableCell>
                      <Chip size="small" color={label.color} label={label.label} title={label.help} />
                      {inv.zatcaFailureReason && canRetry && (
                        <Typography variant="caption" color="error" sx={{ display: 'block', maxWidth: 240 }}>
                          {inv.zatcaFailureReason}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      {rsd ? (
                        <Chip
                          size="small"
                          variant={rsd.state === 'sent' ? 'filled' : 'outlined'}
                          color={rsdColor}
                          label={`${rsd.sent}/${rsd.total}`}
                          title={`${rsd.sent} of ${rsd.total} RSD packs reported${rsd.rejected ? ` · ${rsd.rejected} need attention` : ''}${rsd.pending ? ` · ${rsd.pending} queued` : ''}`}
                        />
                      ) : (
                        <Typography variant="caption" color="text.secondary">—</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace' }} title={inv.zatcaUuid ?? ''}>
                        {shortUuid(inv.zatcaUuid)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <Button size="small" startIcon={<ReceiptLongIcon />} onClick={() => setPrintInvoice(inv)}>
                        Invoice
                      </Button>
                      <Button size="small" startIcon={<PrintIcon />} onClick={() => setPrintReceipt(inv)}>
                        Print Receipt
                      </Button>
                      {hasDosages(inv.lines) && (
                        <Button
                          size="small"
                          startIcon={<MedicationOutlinedIcon />}
                          onClick={() => setPrintDosages(inv)}
                        >
                          Directions
                        </Button>
                      )}
                      <Button
                        size="small"
                        startIcon={<CodeIcon />}
                        onClick={() => viewXml(inv)}
                        disabled={!inv.zatcaUuid || xmlBusy}
                      >
                        XML
                      </Button>
                      {canRetry && (
                        <Button
                          size="small"
                          color="warning"
                          startIcon={<ReplayIcon />}
                          onClick={() => retry(inv)}
                          disabled={busyId !== null}
                        >
                          {busyId === inv.id ? 'Sending…' : 'Retry'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <TaxInvoiceDocument
        open={printInvoice !== null}
        invoice={printInvoice}
        onPrintReceipt={() => {
          setPrintReceipt(printInvoice);
          setPrintInvoice(null);
        }}
        onClose={() => setPrintInvoice(null)}
      />

      <ReceiptView
        open={printReceipt !== null}
        invoice={printReceipt}
        closeLabel="Close"
        onClose={() => setPrintReceipt(null)}
      />

      <DosagePrintView
        open={printDosages !== null}
        invoice={printDosages}
        onClose={() => setPrintDosages(null)}
      />

      <Dialog open={xml !== null} onClose={() => setXml(null)} fullWidth maxWidth="md">
        <DialogTitle>
          Signed XML — {xml?.invoice.invoiceNo}
        </DialogTitle>
        <DialogContent>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            This is the exact signed UBL 2.1 document kept by the ZATCA server for this UUID. ZATCA
            requires the seller to retain it; it is not re-generated from the sale.
          </Typography>
          <Box
            component="pre"
            sx={{
              fontSize: 10.5, fontFamily: 'monospace', bgcolor: 'grey.50', p: 1.5,
              border: '1px solid', borderColor: 'divider', borderRadius: 1,
              maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}
          >
            {xml?.text}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={downloadXml}>Download .xml</Button>
          <Button onClick={() => setXml(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
