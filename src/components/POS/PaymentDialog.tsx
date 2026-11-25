import { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, ToggleButtonGroup, ToggleButton,
  TextField, Stack, Typography, Alert, CircularProgress, IconButton, Paper, Divider,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import LocalPharmacyOutlinedIcon from '@mui/icons-material/LocalPharmacyOutlined';
import type { Payment, PaymentMethod, CardNetwork } from '../../types/sales';
import type { WasfatySession } from '../../types/wasfaty';
import CardNetworkPicker from './CardNetworkPicker';
import { round2 } from '../../utils/vat';
import { maskNationalId } from '../../utils/wasfaty';
import { pointsToSar, sarToPoints } from '../../utils/loyalty';
import { formatMoney } from '../../utils/format';

import { T, useT } from '../../i18n';
interface Props {
  open: boolean;
  // What the PATIENT has to pay now. On a Wasfaty sale this is the non-covered part only; the
  // covered part is settled by the coverage tender that completeSale adds, and is shown below for
  // transparency. It is deliberately not part of the amount the cashier has to enter.
  totalDue: number;
  pointsBalance: number; // 0 for walk-in/no-phone customers - hides the Points tender option
  wasfaty?: {
    session: WasfatySession;
    coveredAmount: number;
    invoiceTotal: number;
  } | null;
  isSubmitting?: boolean;
  onCancel: () => void;
  onConfirm: (payments: Payment[]) => void;
}

interface PaymentRow {
  key: string;
  method: PaymentMethod;
  amount: string;
  cardNetwork: CardNetwork | null;
  insuranceCompany: string;
  insuranceApprovalCode: string;
}

function newRow(amount: number): PaymentRow {
  return {
    key: crypto.randomUUID(),
    method: 'cash',
    amount: amount > 0.005 ? amount.toFixed(2) : '',
    cardNetwork: null,
    insuranceCompany: '',
    insuranceApprovalCode: '',
  };
}

const EPSILON = 0.005;

// Split payments (e.g. part cash, part mada, part Visa, part insurance) all sum against one
// invoice total. Rather than a single exclusive method + a single amount, this is a list of
// tender rows that must add up to totalDue - overpayment is only meaningful on a cash row
// (that's where "change due" comes from; a card/insurance terminal can't hand back change).
export default function PaymentDialog({
  open, totalDue, pointsBalance, wasfaty, isSubmitting, onCancel, onConfirm,
}: Props) {
  const tr = useT();
  const fullyCovered = totalDue <= EPSILON;
  const [rows, setRows] = useState<PaymentRow[]>(fullyCovered ? [] : [newRow(totalDue)]);
  const pointsAvailableSar = round2(pointsToSar(pointsBalance));

  // The dialog is mounted once and toggled via `open`, so state has to be re-seeded from the
  // live total each time it opens - a useState initializer only runs on first mount, which
  // would otherwise freeze it at whatever the cart total was back then.
  useEffect(() => {
    if (open) setRows(totalDue <= EPSILON ? [] : [newRow(totalDue)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const sumEntered = round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const remaining = round2(totalDue - sumEntered);
  const stillOwing = remaining > EPSILON;
  const overpaid = remaining < -EPSILON;
  const changeDue = overpaid ? -remaining : 0;

  const lastCashRowIndex = rows.reduce((last, r, i) => (r.method === 'cash' ? i : last), -1);
  const canGiveChange = !overpaid || lastCashRowIndex >= 0;

  const totalPointsSarUsed = round2(
    rows.filter((r) => r.method === 'points').reduce((s, r) => s + (Number(r.amount) || 0), 0)
  );

  const rowErrors = rows.map((r) => {
    const amt = Number(r.amount) || 0;
    if (amt <= 0) return 'Enter an amount.';
    if (r.method === 'card' && !r.cardNetwork) return 'Select a card network.';
    if (r.method === 'insurance' && !r.insuranceCompany.trim()) return 'Enter the insurance company.';
    if (r.method === 'points' && totalPointsSarUsed > pointsAvailableSar + EPSILON) {
      return `Only SAR ${formatMoney(pointsAvailableSar)} in points available.`;
    }
    return null;
  });
  const hasRowErrors = rowErrors.some(Boolean);
  // With the patient share at zero there are no tender rows to validate - the coverage leg is
  // added by completeSale, not typed by the cashier.
  const confirmDisabled =
    hasRowErrors || (!fullyCovered && stillOwing) || !canGiveChange || isSubmitting;

  function updateRow(key: string, patch: Partial<PaymentRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeRow(key: string) {
    setRows((rs) => rs.filter((r) => r.key !== key));
  }

  function addRow() {
    setRows((rs) => [...rs, newRow(Math.max(0, remaining))]);
  }

  function confirm() {
    const payments: Payment[] = rows.map((r, i) => {
      let amount = round2(Number(r.amount) || 0);
      // Overpayment on the last cash row is change handed back to the customer, not part of
      // what's actually applied to the invoice - the recorded Payment.amount excludes it.
      if (i === lastCashRowIndex && changeDue > 0) amount = round2(amount - changeDue);
      const payment: Payment = { method: r.method, amount };
      if (r.method === 'card') payment.cardNetwork = r.cardNetwork!;
      if (r.method === 'insurance') {
        payment.insuranceCompany = r.insuranceCompany.trim();
        if (r.insuranceApprovalCode.trim()) payment.insuranceApprovalCode = r.insuranceApprovalCode.trim();
      }
      return payment;
    });
    onConfirm(payments);
  }

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="xs">
      <DialogTitle>{wasfaty ? tr("Wasfaty dispense - payment") : tr("Payment")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {wasfaty && (
            <Paper
              variant="outlined"
              sx={{ p: 1.5, bgcolor: 'rgba(21, 101, 192, 0.04)', borderColor: 'primary.main' }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                <LocalPharmacyOutlinedIcon fontSize="small" color="primary" />
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  <T>Wasfaty / وصفتي</T>
                </Typography>
              </Stack>
              <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                <Typography variant="caption" color="text.secondary"><T>Prescription</T></Typography>
                <Typography variant="caption">{wasfaty.session.prescriptionNo}</Typography>
              </Stack>
              <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                <Typography variant="caption" color="text.secondary"><T>Patient</T></Typography>
                <Typography variant="caption">{maskNationalId(wasfaty.session.patientNationalId)}</Typography>
              </Stack>
              <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                <Typography variant="caption" color="text.secondary"><T>NUPCO coverage</T></Typography>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  <T>SAR</T> {formatMoney(wasfaty.coveredAmount)}
                </Typography>
              </Stack>
              <Divider sx={{ my: 0.75 }} />
              <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}><T>Patient share</T></Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  <T>SAR</T> {formatMoney(totalDue)}
                </Typography>
              </Stack>
              {fullyCovered && (
                <Alert severity="success" icon={false} sx={{ mt: 1, py: 0 }}>
                  <T>Fully covered by Wasfaty - the patient pays 0.00.</T>
                </Alert>
              )}
            </Paper>
          )}
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            <T>SAR</T> {formatMoney(totalDue)}
          </Typography>
          {wasfaty && wasfaty.invoiceTotal > totalDue + EPSILON && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
              <T>Invoice total is SAR</T> {formatMoney(wasfaty.invoiceTotal)}<T>; the difference is the Wasfaty
              coverage tender, recorded on the invoice automatically.</T>
            </Typography>
          )}

          <Stack spacing={1.5}>
            {rows.map((row, i) => (
              <Paper key={row.key} variant="outlined" sx={{ p: 1.5 }}>
                <Stack spacing={1.25}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <ToggleButtonGroup
                      exclusive
                      fullWidth
                      size="small"
                      value={row.method}
                      onChange={(_, v: PaymentMethod | null) => {
                        if (!v) return;
                        // Picking "Points" one-click-fills the max redeemable amount (capped by
                        // balance and by what's still owed) - the gold-standard redemption UX is
                        // "select and go", not "select, then work out and type a number".
                        if (v === 'points') {
                          const currentAmt = Number(row.amount) || 0;
                          // currentAmt only overlaps totalPointsSarUsed if this row was ALREADY
                          // a points row - otherwise it's cash/card/insurance money that was
                          // never counted as points spend, and must not be credited back here.
                          const otherPointsUsed = row.method === 'points' ? totalPointsSarUsed - currentAmt : totalPointsSarUsed;
                          const maxByBalance = pointsAvailableSar - otherPointsUsed;
                          const maxByDue = remaining + currentAmt;
                          const use = round2(Math.max(0, Math.min(maxByBalance, maxByDue)));
                          updateRow(row.key, { method: v, amount: use > EPSILON ? use.toFixed(2) : '' });
                        } else {
                          updateRow(row.key, { method: v });
                        }
                      }}
                    >
                      <ToggleButton value="cash"><T>Cash</T></ToggleButton>
                      <ToggleButton value="card"><T>Card</T></ToggleButton>
                      <ToggleButton value="insurance"><T>Insurance</T></ToggleButton>
                      <ToggleButton value="points" disabled={pointsAvailableSar <= EPSILON}><T>Points</T></ToggleButton>
                      {/* Catch-all for a tender with no dedicated flow - store credit note, gift
                          certificate, etc. Behaves like cash for validation (plain amount); the
                          sale records it as method 'other' end to end. */}
                      <ToggleButton value="other"><T>Other</T></ToggleButton>
                    </ToggleButtonGroup>
                    {rows.length > 1 && (
                      <IconButton size="small" onClick={() => removeRow(row.key)} aria-label={tr('Remove payment method')}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Stack>

                  <TextField
                    label={tr('Amount')}
                    type="number"
                    size="small"
                    value={row.amount}
                    onChange={(e) => updateRow(row.key, { amount: e.target.value })}
                    fullWidth
                    helperText={
                      row.method === 'points'
                        ? `= ${sarToPoints(Number(row.amount) || 0)} points (balance worth SAR ${formatMoney(pointsAvailableSar)})`
                        : undefined
                    }
                  />

                  {row.method === 'card' && (
                    <CardNetworkPicker
                      value={row.cardNetwork}
                      onChange={(n) => updateRow(row.key, { cardNetwork: n })}
                    />
                  )}

                  {row.method === 'insurance' && (
                    <Stack spacing={1}>
                      <TextField
                        label={tr('Insurance company')}
                        size="small"
                        value={row.insuranceCompany}
                        onChange={(e) => updateRow(row.key, { insuranceCompany: e.target.value })}
                        fullWidth
                      />
                      <TextField
                        label={tr('Approval / authorization code (optional)')}
                        size="small"
                        value={row.insuranceApprovalCode}
                        onChange={(e) => updateRow(row.key, { insuranceApprovalCode: e.target.value })}
                        fullWidth
                      />
                    </Stack>
                  )}

                  {rowErrors[i] && (
                    <Typography variant="caption" color="error">{rowErrors[i]}</Typography>
                  )}
                </Stack>
              </Paper>
            ))}
          </Stack>

          {!fullyCovered && (
            <Button startIcon={<AddIcon />} onClick={addRow} size="small" sx={{ alignSelf: 'flex-start' }}>
              <T>Add payment method</T>
            </Button>
          )}

          {stillOwing ? (
            <Alert severity="warning"><T>SAR</T> {formatMoney(remaining)} <T>still due.</T></Alert>
          ) : changeDue > 0 ? (
            canGiveChange ? (
              <Typography variant="body2" color="text.secondary">
                <T>Change due: SAR</T> {formatMoney(changeDue)}
              </Typography>
            ) : (
              <Alert severity="error"><T>Change can only be given in cash - add a cash row or reduce the amount.</T></Alert>
            )
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onCancel} disabled={isSubmitting}><T>Cancel</T></Button>
        <Button
          variant="contained"
          disabled={confirmDisabled}
          startIcon={isSubmitting ? <CircularProgress size={16} color="inherit" /> : undefined}
          onClick={confirm}
        >
          {isSubmitting
            ? tr("Submitting to ZATCA…")
            : wasfaty
              ? tr("Dispense & complete")
              : tr("Complete Sale")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
