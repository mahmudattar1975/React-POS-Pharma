import { useState, useEffect } from 'react';
import {
  Box, Typography, Button, Paper, Table, TableHead, TableRow, TableCell, TableBody, Chip,
  IconButton, Stack, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Select,
  MenuItem, FormControl, InputLabel, Checkbox, FormControlLabel,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import { useCatalogStore } from '../../store/catalogStore';
import { useIncentiveStore } from '../../store/incentiveStore';
import type { IncentiveItem, IncentiveType } from '../../types/incentive';
import { formatMoney } from '../../utils/format';

// Distinctive palette for this page — pharmacy ledger feel: deep teal + warm gold accent.
const C = {
  bg: '#f6f4ef',
  surface: '#ffffff',
  ink: '#1a1a1a',
  muted: '#6b6560',
  teal: '#0d5c63',
  gold: '#b8860b',
  border: '#e2ddd3',
  hover: '#f0ece3',
};

export default function IncentiveItemsPage() {
  const { items: catalogItems } = useCatalogStore();
  const { items, loading, error, refresh, addItem, updateItem, removeItem } = useIncentiveStore();
  const [dialog, setDialog] = useState<{ open: boolean; item: IncentiveItem | null }>({ open: false, item: null });

  const [form, setForm] = useState({
    itemId: '',
    incentiveType: 'percent' as IncentiveType,
    rate: 0.1,
    activeFrom: new Date().toISOString().slice(0, 10),
    activeTo: '2026-12-31',
    active: true,
  });

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (dialog.open) {
      if (dialog.item) {
        setForm({
          itemId: dialog.item.itemId,
          incentiveType: dialog.item.incentiveType,
          rate: dialog.item.rate,
          activeFrom: dialog.item.activeFrom,
          activeTo: dialog.item.activeTo,
          active: dialog.item.active,
        });
      } else {
        setForm({ itemId: '', incentiveType: 'percent', rate: 0.1, activeFrom: new Date().toISOString().slice(0, 10), activeTo: '2026-12-31', active: true });
      }
    }
  }, [dialog.open, dialog.item]);

  function save() {
    const payload = {
      itemId: form.itemId,
      incentiveType: form.incentiveType,
      rate: form.rate,
      activeFrom: form.activeFrom,
      activeTo: form.activeTo,
      active: form.active,
    };
    if (dialog.item) updateItem(dialog.item.id, payload);
    else addItem(payload);
    setDialog({ open: false, item: null });
  }

  const today = new Date().toISOString().slice(0, 10);
  function status(it: IncentiveItem) {
    if (!it.active) return { label: 'Disabled', color: 'default' as const };
    if (today > it.activeTo) return { label: 'Expired', color: 'default' as const };
    if (today < it.activeFrom) return { label: 'Upcoming', color: 'info' as const };
    return { label: 'Active', color: 'success' as const };
  }

  const itemName = (id: string) => catalogItems.find((i) => i.id === id)?.nameEn ?? id;
  const activeCount = items.filter((it) => it.active && it.activeFrom <= today && it.activeTo >= today).length;

  return (
    <Box sx={{ bgcolor: C.bg, minHeight: '100%', p: { xs: 2, md: 4 }, fontFamily: '"Tajawal", system-ui, sans-serif' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;800&display=swap');`}</style>

      {/* Hero header */}
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="overline" sx={{ color: C.muted, letterSpacing: 1.5, fontWeight: 500, display: 'block', mb: 0.5 }}>
            Point of Sale · Incentives
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 800, color: C.ink, lineHeight: 1.1, letterSpacing: -0.5 }}>
            Incentive Items
          </Typography>
          <Typography variant="body2" sx={{ color: C.muted, mt: 1, maxWidth: 520 }}>
            Curated list of items that grant a profit bonus to the cashier on sale. Internal cost — never a tax line.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setDialog({ open: true, item: null })}
          sx={{ bgcolor: C.teal, '&:hover': { bgcolor: '#0a4a50' }, textTransform: 'none', fontWeight: 600, px: 2.5 }}
        >
          Add item
        </Button>
      </Box>

      {/* Stat strip */}
      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        <Paper elevation={0} sx={{ flex: 1, p: 2, bgcolor: C.surface, border: `1px solid ${C.border}`, borderRadius: 1 }}>
          <Typography variant="caption" sx={{ color: C.muted, textTransform: 'none', letterSpacing: 0 }}>Total rules</Typography>
          <Typography variant="h5" sx={{ fontWeight: 800, color: C.ink, mt: 0.5 }}>{items.length}</Typography>
        </Paper>
        <Paper elevation={0} sx={{ flex: 1, p: 2, bgcolor: C.surface, border: `1px solid ${C.border}`, borderRadius: 1 }}>
          <Typography variant="caption" sx={{ color: C.muted, textTransform: 'none', letterSpacing: 0 }}>Active now</Typography>
          <Typography variant="h5" sx={{ fontWeight: 800, color: C.gold, mt: 0.5 }}>{activeCount}</Typography>
        </Paper>
      </Stack>

      {error && <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>}
      {loading && <Typography color="text.secondary" sx={{ mb: 2 }}>Loading…</Typography>}

      <Paper elevation={0} sx={{ bgcolor: C.surface, border: `1px solid ${C.border}`, borderRadius: 1, overflow: 'hidden' }}>
        <Table size="small">
          <TableHead sx={{ bgcolor: C.bg }}>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, color: C.ink, borderBottom: `2px solid ${C.border}` }}>Item</TableCell>
              <TableCell sx={{ fontWeight: 700, color: C.ink, borderBottom: `2px solid ${C.border}` }}>Type</TableCell>
              <TableCell sx={{ fontWeight: 700, color: C.ink, borderBottom: `2px solid ${C.border}` }}>Rate</TableCell>
              <TableCell sx={{ fontWeight: 700, color: C.ink, borderBottom: `2px solid ${C.border}` }}>Active From</TableCell>
              <TableCell sx={{ fontWeight: 700, color: C.ink, borderBottom: `2px solid ${C.border}` }}>Active To</TableCell>
              <TableCell sx={{ fontWeight: 700, color: C.ink, borderBottom: `2px solid ${C.border}` }}>Status</TableCell>
              <TableCell sx={{ borderBottom: `2px solid ${C.border}` }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
                    No incentive items yet — add one to start granting profit on sales.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {items.map((it) => {
              const st = status(it);
              return (
                <TableRow key={it.id} hover sx={{ '&:hover': { bgcolor: C.hover } }}>
                  <TableCell sx={{ color: C.ink }}>{itemName(it.itemId)}</TableCell>
                  <TableCell sx={{ color: C.muted }}>{it.incentiveType}</TableCell>
                  <TableCell sx={{ fontWeight: 600, color: C.gold }}>
                    {it.incentiveType === 'percent' ? `${(it.rate * 100).toFixed(2)}%` : formatMoney(it.rate)}
                  </TableCell>
                  <TableCell>{it.activeFrom}</TableCell>
                  <TableCell>{it.activeTo}</TableCell>
                  <TableCell><Chip size="small" color={st.color} label={st.label} sx={{ borderRadius: 0.5 }} /></TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => setDialog({ open: true, item: it })} sx={{ color: C.teal }}>
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={() => removeItem(it.id)} sx={{ color: C.muted }}>
                      <DeleteOutlinedIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={dialog.open} onClose={() => setDialog({ open: false, item: null })} maxWidth="sm" fullWidth
        sx={{ '& .MuiDialog-paper': { borderRadius: 1, bgcolor: C.surface } }}>
        <DialogTitle sx={{ fontWeight: 700, color: C.ink, borderBottom: `1px solid ${C.border}` }}>
          {dialog.item ? 'Edit Incentive Item' : 'Add Incentive Item'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Item</InputLabel>
              <Select value={form.itemId} label="Item" onChange={(e) => setForm({ ...form, itemId: e.target.value })}>
                {catalogItems.map((it) => (
                  <MenuItem key={it.id} value={it.id}>{it.nameEn} ({it.nameAr})</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>Type</InputLabel>
              <Select value={form.incentiveType} label="Type" onChange={(e) => setForm({ ...form, incentiveType: e.target.value as IncentiveType })}>
                <MenuItem value="percent">Percent of net sales (excl. VAT)</MenuItem>
                <MenuItem value="amount">Fixed amount per unit</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label={form.incentiveType === 'percent' ? 'Rate (0.10 = 10%)' : 'Amount (SAR per unit)'}
              type="number"
              value={form.rate}
              onChange={(e) => setForm({ ...form, rate: Number(e.target.value) })}
              size="small"
              fullWidth
            />
            <TextField label="Active From" type="date" value={form.activeFrom} onChange={(e) => setForm({ ...form, activeFrom: e.target.value })} size="small" fullWidth />
            <TextField label="Active To" type="date" value={form.activeTo} onChange={(e) => setForm({ ...form, activeTo: e.target.value })} size="small" fullWidth />
            <FormControlLabel control={<Checkbox checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />} label="Active" />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ borderTop: `1px solid ${C.border}` }}>
          <Button onClick={() => setDialog({ open: false, item: null })} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={!form.itemId} sx={{ bgcolor: C.teal, textTransform: 'none', '&:hover': { bgcolor: '#0a4a50' } }}>Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
