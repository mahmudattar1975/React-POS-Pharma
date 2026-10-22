import { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Alert, Stack, Typography, Divider } from '@mui/material';
import { useShiftStore } from '../../store/shiftStore';

export default function CloseDrawerDialog({ onClose }: { onClose: () => void }) {
  const [closingAmount, setClosingAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const close = useShiftStore((s) => s.close);
  const lastClose = useShiftStore((s) => s.lastClose);
  const clearLastClose = useShiftStore((s) => s.clearLastClose);

  async function handleClose() {
    const amount = Number(closingAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      setError('Enter the cash counted in the drawer.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await close(amount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close drawer.');
      setSubmitting(false);
    }
  }

  // After a successful close, show the shift summary (commission earned, cash variance) instead
  // of the amount-entry form, until the cashier acknowledges it.
  if (lastClose) {
    const variance = lastClose.cashVariance ?? 0;
    return (
      <Dialog open fullWidth maxWidth="xs">
        <DialogTitle>Shift Closed</DialogTitle>
        <DialogContent>
          <Stack spacing={1}>
            <Row label="Total Sales" value={`${lastClose.totalSales.toFixed(2)} SAR`} />
            <Row label="Total Returns" value={`${lastClose.totalReturns.toFixed(2)} SAR`} />
            <Divider />
            <Row label="Commission Earned" value={`${lastClose.commissionEarned.toFixed(2)} SAR`} bold />
            <Divider />
            <Row label="Expected Cash" value={`${lastClose.expectedCash.toFixed(2)} SAR`} />
            <Row label="Counted Cash" value={`${(lastClose.closingAmount ?? 0).toFixed(2)} SAR`} />
            <Row
              label="Cash Variance"
              value={`${variance >= 0 ? '+' : ''}${variance.toFixed(2)} SAR`}
              color={variance === 0 ? 'text.primary' : variance > 0 ? 'success.main' : 'error.main'}
              bold
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            variant="contained"
            fullWidth
            onClick={() => {
              clearLastClose();
              onClose();
            }}
          >
            OK
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <Dialog open fullWidth maxWidth="xs" onClose={onClose}>
      <DialogTitle>Close Drawer</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField
          label="Cash Counted (SAR)"
          type="number"
          value={closingAmount}
          onChange={(e) => setClosingAmount(e.target.value)}
          fullWidth
          autoFocus
          disabled={submitting}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button variant="contained" onClick={handleClose} disabled={submitting}>
          {submitting ? 'Closing...' : 'Close Drawer'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function Row({ label, value, bold, color }: { label: string; value: string; bold?: boolean; color?: string }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: bold ? 700 : 400 }} color={color}>{value}</Typography>
    </Stack>
  );
}
