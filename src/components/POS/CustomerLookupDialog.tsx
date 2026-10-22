import { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Stack, Typography,
  List, ListItemButton, ListItemText, MenuItem, InputAdornment,
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { useCustomerStore } from '../../store/customerStore';
import type { Customer, CustomerTier } from '../../types/customer';
import { pointsToSar } from '../../utils/loyalty';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (customer: Customer) => void;
}

const TIER_LABEL: Record<CustomerTier, string> = { normal: 'Normal', special: 'Special', vip: 'VIP' };

// Phone-first customer lookup, matching the legacy patient screen's own flow (type a mobile
// number, see who it belongs to, points balance and all) rather than picking from an unbounded
// dropdown that doesn't scale past a handful of demo customers.
export default function CustomerLookupDialog({ open, onClose, onSelect }: Props) {
  const { customers, addCustomer, pointsBalanceFor } = useCustomerStore();
  const [phone, setPhone] = useState('');
  const [newNameAr, setNewNameAr] = useState('');
  const [newNameEn, setNewNameEn] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newNationalId, setNewNationalId] = useState('');
  const [newTier, setNewTier] = useState<CustomerTier>('normal');
  const [newMainAccountId, setNewMainAccountId] = useState('');

  useEffect(() => {
    if (open) {
      setPhone('');
      setNewNameAr('');
      setNewNameEn('');
      setNewEmail('');
      setNewNationalId('');
      setNewTier('normal');
      setNewMainAccountId('');
    }
  }, [open]);

  // Candidates for "link to a household account" - any real customer that isn't itself already
  // a sub-account (keeps the relationship one level deep, matching the legacy PATIENT_MAIN_NO).
  const householdCandidates = customers.filter((c) => c.phone && !c.mainAccountId);

  const query = phone.trim();
  const matches = query
    ? customers.filter((c) => c.phone && c.phone.includes(query))
    : customers.filter((c) => c.id !== 'cus-walkin');

  const exactMatch = customers.find((c) => c.phone === query);
  const canCreate = /^\d{9,10}$/.test(query) && !exactMatch;

  function selectWalkIn() {
    const walkIn = customers.find((c) => c.id === 'cus-walkin');
    if (walkIn) onSelect(walkIn);
    onClose();
  }

  function pick(c: Customer) {
    onSelect(c);
    onClose();
  }

  const nationalIdValid = !newNationalId.trim() || /^\d{10}$/.test(newNationalId.trim());
  const canSubmitNew = canCreate && (newNameAr.trim() || newNameEn.trim()) && nationalIdValid;

  function createAndPick() {
    if (!canSubmitNew) return;
    const c = addCustomer({
      nameAr: newNameAr.trim() || newNameEn.trim(),
      nameEn: newNameEn.trim() || newNameAr.trim(),
      phone: query,
      email: newEmail.trim() || undefined,
      nationalId: newNationalId.trim() || undefined,
      tier: newTier,
      mainAccountId: newMainAccountId || undefined,
    });
    pick(c);
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Find Customer</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField
            label="Mobile number"
            autoFocus
            fullWidth
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, ''))}
            slotProps={{ htmlInput: { maxLength: 10, inputMode: 'numeric' } }}
          />

          <List dense disablePadding sx={{ maxHeight: 260, overflow: 'auto' }}>
            {matches.map((c) => {
              const balance = pointsBalanceFor(c.id);
              const mainAccount = c.mainAccountId ? customers.find((m) => m.id === c.mainAccountId) : undefined;
              return (
                <ListItemButton key={c.id} onClick={() => pick(c)}>
                  <ListItemText
                    primary={`${c.nameEn}${c.nameAr ? ` · ${c.nameAr}` : ''} ${c.tier !== 'normal' ? `(${TIER_LABEL[c.tier]})` : ''}`}
                    secondary={
                      `${c.phone}${c.email ? ` · ${c.email}` : ''}${c.nationalId ? ` · ID ${c.nationalId}` : ''} · ` +
                      `${balance} points (SAR ${pointsToSar(balance).toFixed(2)})` +
                      (mainAccount ? ` · household of ${mainAccount.nameEn}` : '')
                    }
                  />
                </ListItemButton>
              );
            })}
            {matches.length === 0 && !canCreate && (
              <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                No match yet — keep typing the number.
              </Typography>
            )}
          </List>

          {canCreate && (
            <Stack spacing={1.5} sx={{ p: 1.5, border: '1px dashed', borderColor: 'divider', borderRadius: 1 }}>
              <Typography variant="body2" color="text.secondary">
                No customer with {query} yet — add one:
              </Typography>
              <TextField
                label="Name (English)"
                size="small"
                fullWidth
                value={newNameEn}
                onChange={(e) => setNewNameEn(e.target.value)}
                slotProps={{
                  input: { startAdornment: <InputAdornment position="start"><PersonAddIcon fontSize="small" /></InputAdornment> },
                }}
              />
              <TextField
                label="الاسم (عربي) / Name (Arabic)"
                size="small"
                fullWidth
                value={newNameAr}
                onChange={(e) => setNewNameAr(e.target.value)}
              />
              <TextField
                label="Email (optional)"
                size="small"
                type="email"
                fullWidth
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
              <TextField
                label="National ID / Iqama (optional)"
                size="small"
                fullWidth
                value={newNationalId}
                onChange={(e) => setNewNationalId(e.target.value.replace(/[^\d]/g, ''))}
                error={!nationalIdValid}
                helperText={!nationalIdValid ? 'Must be 10 digits.' : undefined}
                slotProps={{ htmlInput: { maxLength: 10, inputMode: 'numeric' } }}
              />
              <TextField
                label="Tier"
                size="small"
                select
                fullWidth
                value={newTier}
                onChange={(e) => setNewTier(e.target.value as CustomerTier)}
              >
                {(['normal', 'special', 'vip'] as CustomerTier[]).map((t) => (
                  <MenuItem key={t} value={t}>{TIER_LABEL[t]}</MenuItem>
                ))}
              </TextField>
              <TextField
                label="Household account (optional)"
                size="small"
                select
                fullWidth
                value={newMainAccountId}
                onChange={(e) => setNewMainAccountId(e.target.value)}
                helperText="Points earned/redeemed by this customer go to the linked account's balance instead."
              >
                <MenuItem value="">None — own account</MenuItem>
                {householdCandidates.map((c) => (
                  <MenuItem key={c.id} value={c.id}>{c.nameEn} · {c.phone}</MenuItem>
                ))}
              </TextField>
              <Button variant="contained" disabled={!canSubmitNew} onClick={createAndPick}>
                Create & Use
              </Button>
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={selectWalkIn}>Walk-in (no phone)</Button>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}
