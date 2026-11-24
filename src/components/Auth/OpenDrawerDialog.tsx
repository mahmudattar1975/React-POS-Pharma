import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Typography, Alert } from '@mui/material';
import { useShiftStore } from '../../store/shiftStore';
import { useAuthStore } from '../../store/authStore';

// Blocks the whole app behind having an open drawer for the logged-in cashier - mirrors the
// backend rule (PosController/PosReturnController both reject a sale/return with no open shift).
// Not dismissible: there's no "skip" because every sale needs a shift to attach to.
export default function OpenDrawerDialog() {
  const [openingFloat, setOpeningFloat] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const open = useShiftStore((s) => s.open);
  const cashierName = useAuthStore((s) => s.session?.fullName);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  async function handleOpen() {
    const amount = Number(openingFloat);
    if (!Number.isFinite(amount) || amount < 0) {
      setError('Enter a valid opening float amount.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await open(amount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open drawer.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open fullWidth maxWidth="xs">
      <DialogTitle>Open Drawer</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {cashierName}, enter the starting cash float to begin your shift.
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField
          label="Opening Float (SAR)"
          type="number"
          value={openingFloat}
          onChange={(e) => setOpeningFloat(e.target.value)}
          fullWidth
          autoFocus
          disabled={submitting}
        />
      </DialogContent>
      <DialogActions sx={{ flexDirection: 'column', gap: 1, px: 3, pb: 2 }}>
        <Button variant="contained" onClick={handleOpen} disabled={submitting} fullWidth>
          {submitting ? 'Opening...' : 'Open Drawer'}
        </Button>
        {/* Without this, logging into the wrong account traps the cashier here - the dialog's
            backdrop blocks the sign-out button in the sidebar behind it. */}
        <Button
          size="small"
          color="inherit"
          disabled={submitting}
          onClick={() => {
            logout();
            navigate('/login', { replace: true });
          }}
        >
          Wrong account? Sign out
        </Button>
      </DialogActions>
    </Dialog>
  );
}
