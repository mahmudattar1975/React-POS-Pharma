import { useMemo, useState } from 'react';
import {
  Box, Typography, TextField, Button, Paper, Stack, Table, TableHead, TableRow, TableCell, TableBody, Alert,
  List, ListItemButton, ListItemText, Chip,
} from '@mui/material';
import { useSalesStore } from '../../store/salesStore';
import { useCatalogStore } from '../../store/catalogStore';
import { useCustomerStore } from '../../store/customerStore';
import type { ReturnHeader, ReturnLine, SaleHeader } from '../../types/sales';
import { round2 } from '../../utils/vat';
import * as posApi from '../../api/posApi';

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
  const { invoiceByNo, recordReturn, returns, invoices } = useSalesStore();
  const { incrementBatch } = useCatalogStore();
  const customers = useCustomerStore((s) => s.customers);

  const [search, setSearch] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  // A phone number or a name can legitimately match several invoices, so the search has two
  // outcomes: jump straight to the only hit, or show the list for the cashier to choose from.
  const [results, setResults] = useState<SaleHeader[] | null>(null);
  const [qtyByLine, setQtyByLine] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const invoice = invoiceByNo(invoiceNo);

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

  async function submitReturn() {
    if (!invoice) return;
    const returnLines: ReturnLine[] = [];
    let totalRefund = 0;

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
        incrementBatch(l.batchId, Math.round(returnQty * basePerUnit));
      }
      return { ...l, returnedQty: l.returnedQty + returnQty };
    });

    if (returnLines.length === 0) {
      setMessage('Select at least one line quantity to return.');
      return;
    }

    const fullyReturned = updatedLines.every((l) => l.returnedQty >= l.qty);
    const ret: ReturnHeader = {
      id: crypto.randomUUID(),
      returnNo: `RET-${String(returns.length + 1).padStart(6, '0')}`,
      date: new Date().toISOString(),
      originalInvoiceId: invoice.id,
      originalInvoiceNo: invoice.invoiceNo,
      lines: returnLines,
      totalRefund: round2(totalRefund),
      reason: reason.trim(),
    };

    const pointsAdjustment = applyPointsForReturn(invoice, updatedLines);
    const pointsClawedBackThisReturn = pointsAdjustment.pointsEarnedClawedBack - (invoice.pointsEarnedClawedBack ?? 0);
    const pointsRefundedThisReturn = pointsAdjustment.pointsRedeemedRefunded - (invoice.pointsRedeemedRefunded ?? 0);

    recordReturn(ret, {
      ...invoice,
      lines: updatedLines,
      status: fullyReturned ? 'returned' : 'partially_returned',
      pointsEarnedClawedBack: pointsAdjustment.pointsEarnedClawedBack,
      pointsRedeemedRefunded: pointsAdjustment.pointsRedeemedRefunded,
    });

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

    let msg = `Refunded SAR ${totalRefund.toFixed(2)} — ${ret.returnNo}`;
    if (pointsClawedBackThisReturn > 0) msg += ` · ${pointsClawedBackThisReturn} points clawed back`;
    if (pointsRefundedThisReturn > 0) msg += ` · ${pointsRefundedThisReturn} points refunded`;
    setMessage(msg);
    setQtyByLine({});
    setReason('');
  }

  return (
    <Box sx={{ p: 3, maxWidth: 860 }}>
      <Stack direction="row" spacing={2} sx={{ mb: 1 }}>
        <TextField
          label="Invoice No. / phone / customer"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setResults(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && find()}
          helperText="Search by invoice number, customer phone, name, or “Walk-in Customer”."
          sx={{ flex: 1 }}
        />
        <Button variant="contained" onClick={find} sx={{ alignSelf: 'flex-start', height: 56 }}>Find</Button>
      </Stack>

      {results !== null && results.length === 0 && (
        <Alert severity="error" sx={{ mb: 2 }}>
          No invoice found for that number, phone or customer.
        </Alert>
      )}

      {results !== null && results.length > 0 && (
        <Paper variant="outlined" sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ px: 2, pt: 1.5 }}>
            {results.length} matching invoices — choose the one to refund
          </Typography>
          <List dense>
            {results.map((inv) => {
              const phone = (inv.customerId ? phoneById.get(inv.customerId) : '') ?? '';
              const name = inv.customerNameEn || inv.customerNameAr || 'Walk-in Customer';
              return (
                <ListItemButton key={inv.id} onClick={() => pick(inv)}>
                  <ListItemText
                    primary={`${inv.invoiceNo} · ${name}`}
                    secondary={`${new Date(inv.date).toLocaleString()}${phone ? ` · ${phone}` : ''} · SAR ${inv.totalInclVat.toFixed(2)}`}
                  />
                  {inv.status === 'returned' && <Chip size="small" label="Returned" />}
                  {inv.status === 'partially_returned' && <Chip size="small" color="warning" label="Part returned" />}
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
              {invoice.customerNameEn || invoice.customerNameAr || 'Walk-in Customer'}
            </Typography>
            {(invoice.customerId ? phoneById.get(invoice.customerId) : '') && (
              <Typography variant="caption" color="text.secondary">
                {phoneById.get(invoice.customerId!)}
              </Typography>
            )}
            {invoice.status === 'returned' && <Chip size="small" label="Returned" />}
            {invoice.status === 'partially_returned' && <Chip size="small" color="warning" label="Part returned" />}
          </Stack>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Item</TableCell>
                <TableCell align="right">Sold</TableCell>
                <TableCell align="right">Already Returned</TableCell>
                <TableCell align="right">Return Qty</TableCell>
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
                        batch {l.batchNo}
                        {l.unit ? ` · ${l.unit}` : ''}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{l.qty}</TableCell>
                    <TableCell align="right">{l.returnedQty}</TableCell>
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
          <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} fullWidth sx={{ mt: 2 }} />
          <Button variant="contained" sx={{ mt: 2 }} onClick={submitReturn}>Process Return</Button>
          {message && <Alert severity="success" sx={{ mt: 2 }}>{message}</Alert>}
        </Paper>
      )}
    </Box>
  );
}
