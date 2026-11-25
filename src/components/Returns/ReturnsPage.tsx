import { useMemo, useState } from 'react';
import {
  Box, Typography, TextField, Button, Paper, Stack, Table, TableHead, TableRow, TableCell, TableBody, Alert,
  List, ListItemButton, ListItemText, Chip,
} from '@mui/material';
import { useSalesStore } from '../../store/salesStore';
import { useCatalogStore } from '../../store/catalogStore';
import { useCustomerStore } from '../../store/customerStore';
import { useControlledRegisterStore } from '../../store/controlledRegisterStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { ReturnHeader, ReturnLine, SaleHeader } from '../../types/sales';
import { round2 } from '../../utils/vat';
import { formatMoney, formatQty } from '../../utils/format';
import * as posApi from '../../api/posApi';
import * as zatcaApi from '../../api/zatcaApi';
import * as incentiveApi from '../../api/incentiveApi';
import {
  buildCreditNoteSubmitRequest, classifyZatcaCheckoutFailure, needsResubmission,
  zatcaPatchFromSubmission, zatcaStatusLabel,
} from '../../utils/zatcaInvoice';

import { T, useT } from '../../i18n';
// Loyalty points earned/redeemed on a sale are proportional to money, so a return claws back /
// refunds the same proportion. Uses the CUMULATIVE returned share of the invoice (not just this
// return's own lines) so a series of partial returns against the same invoice never re-applies
// an adjustment already made by an earlier partial return.
function applyPointsForReturn(invoice: SaleHeader, updatedLines: SaleHeader['lines']) {
  const { earnPoints, redeemPoints } = useCustomerStore.getState();
  const result = { pointsEarnedClawedBack: invoice.pointsEarnedClawedBack ?? 0, pointsRedeemedRefunded: invoice.pointsRedeemedRefunded ?? 0 };
  if (!invoice.customerId || invoice.totalInclVat <= 0) return result;
  if (!invoice.pointsEarned && !invoice.pointsRedeemed) return result;

  const cumulativeReturnedInclVat = updatedLines.reduce((s, l) => s + (l.returnedQty / l.qty) * l.totalInclVat, 0);
  const ratio = Math.min(1, cumulativeReturnedInclVat / invoice.totalInclVat);

  if (invoice.pointsEarned) {
    const targetClawback = Math.round(invoice.pointsEarned * ratio);
    const delta = targetClawback - result.pointsEarnedClawedBack;
    if (delta > 0) redeemPoints(invoice.customerId, delta);
    result.pointsEarnedClawedBack = targetClawback;
  }
  if (invoice.pointsRedeemed) {
    const targetRefund = Math.round(invoice.pointsRedeemed * ratio);
    const delta = targetRefund - result.pointsRedeemedRefunded;
    if (delta > 0) earnPoints(invoice.customerId, delta);
    result.pointsRedeemedRefunded = targetRefund;
  }
  return result;
}

export default function ReturnsPage() {
  const tr = useT();
  const { invoiceByNo, recordReturn, returns, invoices, updateReturnZatca } = useSalesStore();
  const { items: catalogItems, incrementBatch } = useCatalogStore();
  const recordControlledMovement = useControlledRegisterStore((s) => s.recordMovement);
  const pharmacist = useSettingsStore((s) => s.settings.cashierName);
  const customers = useCustomerStore((s) => s.customers);

  const [search, setSearch] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  // A phone number or a name can legitimately match several invoices, so the search has two
  // outcomes: jump straight to the only hit, or show the list for the cashier to choose from.
  const [results, setResults] = useState<SaleHeader[] | null>(null);
  const [qtyByLine, setQtyByLine] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [messageSeverity, setMessageSeverity] = useState<'success' | 'error'>('success');
  const [busyReturnId, setBusyReturnId] = useState<string | null>(null);

  const invoice = invoiceByNo(invoiceNo);
  const returnRows = invoice ? returns.filter((ret) => ret.originalInvoiceId === invoice.id) : [];

  // The sale stores the customer id and the name, not the phone (the phone belongs to the customer
  // master and can be corrected there). Resolve it once per customer-list change instead of doing
  // a store lookup per invoice row.
  const phoneById = useMemo(
    () => new Map(customers.map((c) => [c.id, c.phone])),
    [customers],
  );

  // A returning customer usually has neither the receipt nor the invoice number - they have the
  // phone that earned the loyalty points, or the name the cashier remembers. "Walk-in Customer" is
  // a real, searchable label rather than an absence, so a refund on a walk-in sale is not a dead
  // end.
  function find() {
    const query = search.trim();
    setQtyByLine({});
    setMessage(null);
    if (!query) {
      setResults(null);
      setInvoiceNo('');
      return;
    }
    const needle = query.toLowerCase();
    const digits = query.replace(/\D/g, '');
    const hits = invoices
      .filter((inv) => {
        const name = `${inv.customerNameEn ?? ''} ${inv.customerNameAr ?? ''}`.toLowerCase();
        if (inv.invoiceNo.toLowerCase().includes(needle)) return true;
        if (name.includes(needle) || (name.trim() === '' && 'walk-in customer'.includes(needle))) return true;
        const phone = (inv.customerId ? phoneById.get(inv.customerId) : '') ?? '';
        return digits.length >= 3 && phone.replace(/\D/g, '').includes(digits);
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    if (hits.length === 1) {
      setInvoiceNo(hits[0].invoiceNo);
      setResults(null);
      return;
    }
    setInvoiceNo('');
    setResults(hits);
  }

  function pick(inv: SaleHeader) {
    setInvoiceNo(inv.invoiceNo);
    setResults(null);
    setQtyByLine({});
    setMessage(null);
  }

  // The refund is final locally before this runs: a ZATCA outage must never stop a customer getting
  // their money back. The credit note is submitted best-effort and its outcome is stored on the
  // ReturnHeader, where the cashier can retry it from the list below.
  async function submitCreditNote(ret: ReturnHeader, source: SaleHeader): Promise<string> {
    setBusyReturnId(ret.id);
    try {
      const result = await zatcaApi.submitInvoice(buildCreditNoteSubmitRequest(source, ret));
      const patch = zatcaPatchFromSubmission(result, source.invoiceType, new Date().toISOString());
      updateReturnZatca(ret.id, patch);
      if (result.status === 'failed') {
        return `Credit note rejected: ${patch.zatcaFailureReason ?? 'see ZATCA status below'}`;
      }
      return `Credit note ${result.status === 'cleared' ? 'cleared' : 'reported'} by ZATCA`;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      updateReturnZatca(ret.id, {
        zatcaStatus: classifyZatcaCheckoutFailure(err) === 'server_unavailable'
          ? 'phase1_fallback'
          : 'pending_submission',
        zatcaFailureReason: reason,
      });
      return `Credit note not submitted: ${reason}`;
    } finally {
      setBusyReturnId(null);
    }
  }

  async function submitReturn() {
    if (!invoice) return;
    const returnLines: ReturnLine[] = [];
    let totalRefund = 0;

    // Controlled goods cannot go back on the shelf without a documented reason: the register row
    // is the audit trail, and "customer changed their mind" vs "damaged" matters to the regulator.
    const returning = invoice.lines.filter((line) => (qtyByLine[line.id] ?? 0) > 0);
    if (returning.some((line) => line.controlledStatus) && !reason.trim()) {
      setMessageSeverity('error');
      setMessage('A reason is required to return a controlled item.');
      return;
    }

    // Fixed before the lines are built so the stock movement and its register row quote the same
    // return number as the document created below.
    const returnNo = `RET-${String(returns.length + 1).padStart(6, '0')}`;

    const updatedLines = invoice.lines.map((l) => {
      const returnQty = Math.min(qtyByLine[l.id] ?? 0, l.qty - l.returnedQty);
      if (returnQty > 0) {
        const refund = round2((returnQty / l.qty) * l.totalInclVat);
        totalRefund += refund;
        returnLines.push({ saleLineId: l.id, itemNameEn: l.itemNameEn, qty: returnQty, refundAmount: refund });
        // Put back exactly what left the shelf, not the selling-unit count: one returned box is
        // twelve tablets. Using the stored baseQty means an item whose pack ladder was edited
        // after the sale still returns the right amount.
        const basePerUnit = l.baseQty && l.qty > 0 ? l.baseQty / l.qty : 1;
        const baseQty = Math.round(returnQty * basePerUnit);
        // Register first, then stock: the return row reverses the original dispense row and the
        // running balance must include the incoming quantity before the batch changes.
        if (l.controlledStatus) {
          recordControlledMovement({
            kind: 'return',
            itemId: l.itemId,
            itemNameEn: l.itemNameEn,
            itemNameAr: l.itemNameAr,
            batchNo: l.batchNo,
            expiryDate: l.expiryDate,
            baseQty,
            branchId: invoice.costCenterId,
            prescriptionId: invoice.prescription?.registryId,
            prescriptionNo: invoice.prescription?.prescriptionId,
            prescriberName: invoice.prescription?.prescriberName,
            patientNationalId: invoice.prescription?.patientNationalId,
            invoiceId: invoice.id,
            invoiceNo: invoice.invoiceNo,
            saleLineId: l.id,
            returnNo,
            pharmacist,
            reason: reason.trim(),
          });
        }
        incrementBatch(l.batchId, baseQty);
      }
      return { ...l, returnedQty: l.returnedQty + returnQty };
    });

    if (returnLines.length === 0) {
      setMessageSeverity('error');
      setMessage('Select at least one line quantity to return.');
      return;
    }

    const fullyReturned = updatedLines.every((l) => l.returnedQty >= l.qty);
    const ret: ReturnHeader = {
      id: crypto.randomUUID(),
      returnNo,
      date: new Date().toISOString(),
      originalInvoiceId: invoice.id,
      originalInvoiceNo: invoice.invoiceNo,
      lines: returnLines,
      totalRefund: round2(totalRefund),
      reason: reason.trim(),
      zatcaStatus: 'pending_submission',
    };

    const pointsAdjustment = applyPointsForReturn(invoice, updatedLines);
    const pointsClawedBackThisReturn = pointsAdjustment.pointsEarnedClawedBack - (invoice.pointsEarnedClawedBack ?? 0);
    const pointsRefundedThisReturn = pointsAdjustment.pointsRedeemedRefunded - (invoice.pointsRedeemedRefunded ?? 0);

    // Incentive / profit-bonus clawback (Phase E). Mirrors the points clawback: proportional to the
    // returned share of each incentivized line. Recorded as negative IncentiveRecords so the monthly
    // report nets out returns against the original sale.
    const incentiveClawbackLines = invoice.lines
      .map((l) => {
        const returnQty = Math.min(qtyByLine[l.id] ?? 0, l.qty - l.returnedQty);
        if (returnQty <= 0 || !(l.incentiveAmount && l.incentiveAmount > 0)) return null;
        const clawback = round2((returnQty / l.qty) * (l.incentiveAmount ?? 0));
        if (clawback <= 0) return null;
        return {
          itemId: l.itemId,
          barcode: catalogItems.find((i) => i.id === l.itemId)?.barcode,
          posItemId: l.posItemId,
          itemNameEn: l.itemNameEn,
          qty: returnQty,
          saleAmount: round2((returnQty / l.qty) * l.netExclVat),
          incentiveType: (l.incentiveType ?? 'percent') as 'percent' | 'amount',
          rate: l.incentiveRate ?? 0,
          incentiveAmount: -clawback,
          incentiveItemId: undefined,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const incentiveClawedBackThisReturn = round2(incentiveClawbackLines.reduce((s, l) => s + Math.abs(l.incentiveAmount), 0));
    const newTotalIncentiveClawedBack = round2((invoice.totalIncentiveClawedBack ?? 0) + incentiveClawedBackThisReturn);

    recordReturn(ret, {
      ...invoice,
      lines: updatedLines,
      status: fullyReturned ? 'returned' : 'partially_returned',
      pointsEarnedClawedBack: pointsAdjustment.pointsEarnedClawedBack,
      pointsRedeemedRefunded: pointsAdjustment.pointsRedeemedRefunded,
      totalIncentiveClawedBack: newTotalIncentiveClawedBack,
    });

    // Best-effort record of incentive clawback (negative IncentiveRecords). Never blocks the return.
    if (incentiveClawbackLines.length > 0) {
      incentiveApi
        .recordIncentive({
          saleId: invoice.id,
          posSaleId: invoice.posSaleId,
          invoiceNo: ret.returnNo,
          invoiceDate: ret.date,
          cashierName: pharmacist,
          lines: incentiveClawbackLines,
        })
        .catch((err) => console.warn('incentive clawback record failed (return still completed):', err));
    }

    // Best-effort mirror into dotnet-pos so the commission clawback lands on whichever cashier
    // originally made the sale (see PosReturnController.Create) - the return above is already
    // final locally regardless of whether this succeeds. Only possible if the original sale was
    // itself successfully mirrored at checkout time (posSaleId/posItemId present).
    if (invoice.posSaleId != null) {
      const mirrorItems = returnLines
        .map((rl) => {
          const posItemId = invoice.lines.find((l) => l.id === rl.saleLineId)?.posItemId;
          return posItemId != null ? { posItemId, qty: rl.qty } : null;
        })
        .filter((l): l is { posItemId: number; qty: number } => l !== null);
      if (mirrorItems.length > 0) {
        try {
          await posApi.createReturn({ originalPosId: invoice.posSaleId, reason: reason.trim(), items: mirrorItems });
        } catch (err) {
          console.warn('dotnet-pos return mirror failed (commission clawback not tracked for this return):', err);
        }
      }
    }

    // ZATCA sees a return as a credit note against the original tax document, not as a negative
    // sale. It is submitted after the refund is committed so a gateway failure cannot roll back
    // money already handed to the customer.
    const creditNoteStatus = await submitCreditNote(ret, invoice);

    let msg = `Refunded SAR ${formatMoney(totalRefund)} — ${ret.returnNo}`;
    if (pointsClawedBackThisReturn > 0) msg += ` · ${pointsClawedBackThisReturn} points clawed back`;
    if (pointsRefundedThisReturn > 0) msg += ` · ${pointsRefundedThisReturn} points refunded`;
    msg += ` · ${creditNoteStatus}`;
    setMessageSeverity('success');
    setMessage(msg);
    setQtyByLine({});
    setReason('');
  }

  return (
    <Box sx={{ p: 3, maxWidth: 860 }}>
      <Stack direction="row" spacing={2} sx={{ mb: 1 }}>
        <TextField
          label={tr('Invoice No. / phone / customer')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setResults(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && find()}
          helperText={tr('Search by invoice number, customer phone, name, or “Walk-in Customer”.')}
          sx={{ flex: 1 }}
        />
        <Button variant="contained" onClick={find} sx={{ alignSelf: 'flex-start', height: 56 }}><T>Find</T></Button>
      </Stack>

      {results !== null && results.length === 0 && (
        <Alert severity="error" sx={{ mb: 2 }}>
          <T>No invoice found for that number, phone or customer.</T>
        </Alert>
      )}

      {results !== null && results.length > 0 && (
        <Paper variant="outlined" sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ px: 2, pt: 1.5 }}>
            {results.length} <T>matching invoices — choose the one to refund</T>
          </Typography>
          <List dense>
            {results.map((inv) => {
              const phone = (inv.customerId ? phoneById.get(inv.customerId) : '') ?? '';
              const name = inv.customerNameEn || inv.customerNameAr || tr("Walk-in Customer");
              return (
                <ListItemButton key={inv.id} onClick={() => pick(inv)}>
                  <ListItemText
                    primary={`${inv.invoiceNo} · ${name}`}
                    secondary={`${new Date(inv.date).toLocaleString()}${phone ? ` · ${phone}` : ''} · SAR ${formatMoney(inv.totalInclVat)}`}
                  />
                  {inv.status === 'returned' && <Chip size="small" label={tr('Returned')} />}
                  {inv.status === 'partially_returned' && <Chip size="small" color="warning" label={tr('Part returned')} />}
                </ListItemButton>
              );
            })}
          </List>
        </Paper>
      )}

      {invoice && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="subtitle2">
              {invoice.invoiceNo} · {new Date(invoice.date).toLocaleString()} ·{' '}
              {invoice.customerNameEn || invoice.customerNameAr || tr("Walk-in Customer")}
            </Typography>
            {(invoice.customerId ? phoneById.get(invoice.customerId) : '') && (
              <Typography variant="caption" color="text.secondary">
                {phoneById.get(invoice.customerId!)}
              </Typography>
            )}
            {invoice.status === 'returned' && <Chip size="small" label={tr('Returned')} />}
            {invoice.status === 'partially_returned' && <Chip size="small" color="warning" label={tr('Part returned')} />}
          </Stack>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell><T>Item</T></TableCell>
                <TableCell align="right"><T>Sold</T></TableCell>
                <TableCell align="right"><T>Already Returned</T></TableCell>
                <TableCell align="right"><T>Return Qty</T></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {invoice.lines.map((l) => {
                const remaining = l.qty - l.returnedQty;
                return (
                  <TableRow key={l.id}>
                    <TableCell>
                      {l.itemNameEn}
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        <T>batch</T> {l.batchNo}
                        {l.unit ? ` · ${l.unit}` : ''}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{formatQty(l.qty)}</TableCell>
                    <TableCell align="right">{formatQty(l.returnedQty)}</TableCell>
                    <TableCell align="right">
                      <TextField
                        type="number"
                        size="small"
                        disabled={remaining === 0}
                        value={qtyByLine[l.id] ?? 0}
                        onChange={(e) => setQtyByLine((s) => ({ ...s, [l.id]: Math.max(0, Math.min(remaining, Number(e.target.value) || 0)) }))}
                        slotProps={{ htmlInput: { min: 0, max: remaining, style: { width: 60, textAlign: 'right' } } }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <TextField label={tr('Reason')} value={reason} onChange={(e) => setReason(e.target.value)} fullWidth sx={{ mt: 2 }} />
          <Button variant="contained" sx={{ mt: 2 }} onClick={submitReturn}><T>Process Return</T></Button>
          {message && <Alert severity={messageSeverity} sx={{ mt: 2 }}>{message}</Alert>}

          {invoice && returnRows.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                <T>ZATCA credit notes for this invoice</T>
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                <T>A refund is reported as a credit note referencing the original tax invoice. If the
                signing server was unavailable, the refund is still valid — retry the note here once
                it is back.</T>
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell><T>Credit note</T></TableCell>
                    <TableCell align="right"><T>Refund</T></TableCell>
                    <TableCell><T>ZATCA</T></TableCell>
                    <TableCell align="right"><T>Action</T></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {returnRows.map((ret) => {
                    const label = zatcaStatusLabel(ret.zatcaStatus);
                    return (
                      <TableRow key={ret.id}>
                        <TableCell>
                          {ret.returnNo}
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {new Date(ret.date).toLocaleString()}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">{formatMoney(ret.totalRefund)}</TableCell>
                        <TableCell>
                          <Chip size="small" color={label.color} label={label.label} title={label.help} />
                          {ret.zatcaFailureReason && needsResubmission(ret) && (
                            <Typography variant="caption" color="error" sx={{ display: 'block', maxWidth: 320 }}>
                              {ret.zatcaFailureReason}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            disabled={busyReturnId !== null || !needsResubmission(ret)}
                            onClick={() => void submitCreditNote(ret, invoice)}
                          >
                            {busyReturnId === ret.id ? tr("Sending…") : tr("Retry credit note")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          )}
        </Paper>
      )}
    </Box>
  );
}
