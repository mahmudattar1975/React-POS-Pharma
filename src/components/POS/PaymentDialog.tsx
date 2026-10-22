import { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, ToggleButtonGroup, ToggleButton,
  TextField, Stack, Typography, Alert, CircularProgress, IconButton, Paper,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import type { Payment, PaymentMethod, CardNetwork } from '../../types/sales';
import CardNetworkPicker from './CardNetworkPicker';
import { round2 } from '../../utils/vat';
import { pointsToSar, sarToPoints } from '../../utils/loyalty';

interface Props {
  open: boolean;
  totalDue: number;
  pointsBalance: number; // 0 for walk-in/no-phone customers - hides the Points tender option
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
export default function PaymentDialog({ open, totalDue, pointsBalance, isSubmitting, onCancel, onConfirm }: Props) {
  const [rows, setRows] = useState<PaymentRow[]>([newRow(totalDue)]);
  const pointsAvailableSar = round2(pointsToSar(pointsBalance));

  // The dialog is mounted once and toggled via `open`, so state has to be re-seeded from the
  // live total each time it opens - a useState initializer only runs on first mount, which
  // would otherwise freeze it at whatever the cart total was back then.
  useEffect(() => {
    if (open) setRows([newRow(totalDue)]);
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
      return `Only SAR ${pointsAvailableSar.toFixed(2)} in points available.`;
    }
    return null;
  });
  const hasRowErrors = rowErrors.some(Boolean);
  const confirmDisabled = hasRowErrors || stillOwing || !canGiveChange || isSubmitting;

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
      <DialogTitle>Payment</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            SAR {totalDue.toFixed(2)}
          </Typography>

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
                      <ToggleButton value="cash">Cash</ToggleButton>
                      <ToggleButton value="card">Card</ToggleButton>
                      <ToggleButton value="insurance">Insurance</ToggleButton>
                      <ToggleButton value="points" disabled={pointsAvailableSar <= EPSILON}>Points</ToggleButton>
                    </ToggleButtonGroup>
                    {rows.length > 1 && (
                      <IconButton size="small" onClick={() => removeRow(row.key)} aria-label="Remove payment method">
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Stack>

                  <TextField
                    label="Amount"
                    type="number"
                    size="small"
                    value={row.amount}
                    onChange={(e) => updateRow(row.key, { amount: e.target.value })}
                    fullWidth
                    helperText={
                      row.method === 'points'
                        ? `= ${sarToPoints(Number(row.amount) || 0)} points (balance worth SAR ${pointsAvailableSar.toFixed(2)})`
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
                        label="Insurance company"
                        size="small"
                        value={row.insuranceCompany}
                        onChange={(e) => updateRow(row.key, { insuranceCompany: e.target.value })}
                        fullWidth
                      />
                      <TextField
                        label="Approval / authorization code (optional)"
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

          <Button startIcon={<AddIcon />} onClick={addRow} size="small" sx={{ alignSelf: 'flex-start' }}>
            Add payment method
          </Button>

          {stillOwing ? (
            <Alert severity="warning">SAR {remaining.toFixed(2)} still due.</Alert>
          ) : changeDue > 0 ? (
            canGiveChange ? (
              <Typography variant="body2" color="text.secondary">
                Change due: SAR {changeDue.toFixed(2)}
              </Typography>
            ) : (
              <Alert severity="error">Change can only be given in cash - add a cash row or reduce the amount.</Alert>
            )
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onCancel} disabled={isSubmitting}>Cancel</Button>
        <Button
          variant="contained"
          disabled={confirmDisabled}
          startIcon={isSubmitting ? <CircularProgress size={16} color="inherit" /> : undefined}
          onClick={confirm}
        >
          {isSubmitting ? 'Submitting to ZATCA…' : 'Complete Sale'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
