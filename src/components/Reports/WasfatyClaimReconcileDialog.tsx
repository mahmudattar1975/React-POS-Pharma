// Record what NUPCO reported and paid for one claim.
//
// Submitting a claim tells NUPCO what was dispensed; reconciling it records the money that came
// back. Both amounts are the pharmacy's evidence for the month, so this dialog shows the expected
// amount next to the inputs and flags a variance before the user confirms.
import { useState } from 'react';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, Stack,
  TextField, Typography,
} from '@mui/material';
import type { WasfatyClaim } from '../../types/wasfaty';
import { formatMoney } from '../../utils/format';

export interface ReconcileInput {
  reportedAmount: number;
  paidAmount?: number;
  varianceReason?: string;
}

interface Props {
  claim: WasfatyClaim;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (input: ReconcileInput) => void;
}

function amountError(value: string, required: boolean): string | undefined {
  if (value.trim() === '') return required ? 'Enter the reported amount.' : undefined;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return 'Enter 0 or more.';
  return undefined;
}

export default function WasfatyClaimReconcileDialog({ claim, busy, error, onClose, onConfirm }: Props) {
  const [reported, setReported] = useState(String(claim.reportedAmount ?? claim.expectedAmount));
  const [paid, setPaid] = useState(claim.paidAmount === undefined ? '' : String(claim.paidAmount));
  const [reason, setReason] = useState(claim.varianceReason ?? '');

  const reportedError = amountError(reported, true);
  const paidError = amountError(paid, false);
  const paidValue = paid.trim() === '' ? undefined : Number(paid);
  const variance =
    paidValue !== undefined && Math.abs(paidValue - claim.expectedAmount) > 0.01
      ? paidValue - claim.expectedAmount
      : undefined;

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        Reconcile claim
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {claim.invoiceNo ?? claim.id} · {claim.month} · expected SAR {formatMoney(claim.expectedAmount)}
        </Typography>
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Reported amount"
            type="number"
            value={reported}
            onChange={(e) => setReported(e.target.value)}
            error={!!reportedError}
            helperText={reportedError ?? 'What NUPCO reported for this claim.'}
            slotProps={{
              htmlInput: { min: 0, step: '0.01' },
              input: { endAdornment: <InputAdornment position="end">SAR</InputAdornment> },
            }}
            fullWidth
          />
          <TextField
            label="Paid amount"
            type="number"
            value={paid}
            onChange={(e) => setPaid(e.target.value)}
            error={!!paidError}
            helperText={paidError ?? 'Leave blank to record the reported amount as paid.'}
            slotProps={{
              htmlInput: { min: 0, step: '0.01' },
              input: { endAdornment: <InputAdornment position="end">SAR</InputAdornment> },
            }}
            fullWidth
          />
          {variance !== undefined && (
            <Alert severity="warning">
              Paid is {variance > 0 ? 'above' : 'below'} the expected amount by SAR{' '}
              {formatMoney(Math.abs(variance))}. The claim will be saved as a variance.
            </Alert>
          )}
          <TextField
            label="Variance reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            helperText="Optional, but recorded with the claim when the amounts differ."
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button
          variant="contained"
          disabled={busy || !!reportedError || !!paidError}
          onClick={() =>
            onConfirm({
              reportedAmount: Number(reported),
              paidAmount: paidValue,
              varianceReason: reason.trim() || undefined,
            })
          }
        >
          {busy ? 'Saving…' : 'Save reconciliation'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
