import { useState, useEffect, useMemo } from 'react';
import {
  Box, Typography, Button, Paper, Table, TableHead, TableRow, TableCell, TableBody, Chip,
  IconButton, Stack, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Select,
  MenuItem, FormControl, InputLabel, Checkbox, FormControlLabel,
  List, ListItem, ListItemButton, ListItemText,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { useCatalogStore } from '../../store/catalogStore';
import { useIncentiveStore } from '../../store/incentiveStore';
import type { IncentiveItem, IncentiveType } from '../../types/incentive';
import { formatMoney } from '../../utils/format';
import { discountInputToFraction, formatDiscountInput, formatDiscountPercent } from '../../utils/purchasing';
import { itemCodes } from '../../utils/itemMaster';
import DiscountInput from '../common/DiscountInput';

export default function IncentiveItemsPage() {
  const { items: catalogItems } = useCatalogStore();
  const { items, loading, error, refresh, addItem, updateItem, removeItem } = useIncentiveStore();
  const [dialog, setDialog] = useState<{ open: boolean; item: IncentiveItem | null }>({ open: false, item: null });

  useEffect(() => { refresh(); }, [refresh]);

  // The item picker searches the same catalog and the same fields as the POS sale scan field.
  const [itemQuery, setItemQuery] = useState('');
  // Percent is typed as whole points ("16.67") with the same masked field as POS discounts and
  // stored as a fraction (0.1667); a fixed amount is entered directly in SAR.
  const [percentInput, setPercentInput] = useState(formatDiscountInput(0.1));
  const [form, setForm] = useState({
    itemId: '',
    incentiveType: 'percent' as IncentiveType,
    rate: 0.1,
    activeFrom: new Date().toISOString().slice(0, 10),
    activeTo: '2026-12-31',
    active: true,
  });

  useEffect(() => {
    if (dialog.open) {
      const item = dialog.item;
      setForm(item ? {
        itemId: item.itemId,
        incentiveType: item.incentiveType,
        rate: item.rate,
        activeFrom: item.activeFrom,
        activeTo: item.activeTo,
        active: item.active,
      } : {
        itemId: '', incentiveType: 'percent', rate: 0.1,
        activeFrom: new Date().toISOString().slice(0, 10), activeTo: '2026-12-31', active: true,
      });
      setPercentInput(formatDiscountInput(item?.incentiveType === 'percent' ? item.rate : 0.1));
      const selected = catalogItems.find((i) => i.barcode === item?.itemId || i.id === item?.itemId);
      setItemQuery(selected ? `${selected.nameEn} (${itemCodes(selected).join(' / ')})` : '');
    }
  }, [dialog.open, dialog.item, catalogItems]);

  function save() {
    const payload = {
      itemId: form.itemId,
      incentiveType: form.incentiveType,
      rate: form.incentiveType === 'percent' ? discountInputToFraction(percentInput) : form.rate,
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

  // The dotnet_pos commission_item list is keyed by barcode (item.Code), so the picker stores
  // the barcode as the item id and resolves names from either the barcode or the local catalog id.
  const itemName = (id: string) => catalogItems.find((i) => i.barcode === id || i.id === id)?.nameEn ?? id;

  // Same substring match as POS: English/Arabic name or ANY scannable code, capped to a short list.
  const itemSuggestions = useMemo(() => {
    const q = itemQuery.trim().toLowerCase();
    if (!q) return [];
    // Ignore the label shown after a selection so it doesn't filter itself down to one row.
    const selected = catalogItems.find((i) => i.barcode === form.itemId || i.id === form.itemId);
    if (selected && q === `${selected.nameEn} (${itemCodes(selected).join(' / ')})`.toLowerCase()) return [];
    return catalogItems
      .filter(
        (i) =>
          i.nameEn.toLowerCase().includes(q) ||
          i.nameAr.includes(q) ||
          itemCodes(i).some((code) => code.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [catalogItems, itemQuery, form.itemId]);

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Incentive Items (حافز)</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({ open: true, item: null })}>
          Add Item
        </Button>
      </Stack>

      {error && <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>}
      {loading && <Typography color="text.secondary" sx={{ mb: 2 }}>Loading…</Typography>}

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Item</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Rate</TableCell>
              <TableCell>Active From</TableCell>
              <TableCell>Active To</TableCell>
              <TableCell>Status</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                    No incentive items yet — add one to start granting profit on sales.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {items.map((it) => {
              const st = status(it);
              return (
                <TableRow key={it.id} hover>
                  <TableCell>{itemName(it.itemId)}</TableCell>
                  <TableCell>{it.incentiveType}</TableCell>
                  <TableCell>{it.incentiveType === 'percent' ? formatDiscountPercent(it.rate) : formatMoney(it.rate)}</TableCell>
                  <TableCell>{it.activeFrom}</TableCell>
                  <TableCell>{it.activeTo}</TableCell>
                  <TableCell><Chip size="small" color={st.color} label={st.label} /></TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => setDialog({ open: true, item: it })}>
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={() => removeItem(it.id)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={dialog.open} onClose={() => setDialog({ open: false, item: null })} maxWidth="sm" fullWidth>
        <DialogTitle>{dialog.item ? 'Edit Incentive Item' : 'Add Incentive Item'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Search item (name or barcode)"
              value={itemQuery}
              onChange={(e) => {
                setItemQuery(e.target.value);
                setForm({ ...form, itemId: '' });
              }}
              placeholder="Type name, Arabic name, or barcode"
              size="small"
              fullWidth
            />
            {itemQuery.trim() !== '' && (
              <Paper variant="outlined" sx={{ maxHeight: 200, overflow: 'auto' }}>
                <List dense disablePadding>
                  {itemSuggestions.length === 0 && (
                    <ListItem><ListItemText primary="No matching items in the POS catalog" /></ListItem>
                  )}
                  {itemSuggestions.map((it) => (
                    <ListItemButton
                      key={it.id}
                      onClick={() => {
                        setForm({ ...form, itemId: it.barcode });
                        setItemQuery(`${it.nameEn} (${itemCodes(it).join(' / ')})`);
                      }}
                    >
                      <ListItemText
                        primary={it.nameEn}
                        secondary={`${it.nameAr} · ${itemCodes(it).join(' / ')}`}
                      />
                    </ListItemButton>
                  ))}
                </List>
              </Paper>
            )}
            <FormControl fullWidth size="small">
              <InputLabel>Type</InputLabel>
              <Select value={form.incentiveType} label="Type" onChange={(e) => setForm({ ...form, incentiveType: e.target.value as IncentiveType })}>
                <MenuItem value="percent">Percent of net sales (excl. VAT)</MenuItem>
                <MenuItem value="amount">Fixed amount per unit</MenuItem>
              </Select>
            </FormControl>
            {form.incentiveType === 'percent' ? (
              <DiscountInput
                label="Rate"
                value={percentInput}
                onChange={setPercentInput}
                size="small"
                fullWidth
              />
            ) : (
              <TextField
                label="Amount (SAR per unit)"
                type="number"
                value={form.rate}
                onChange={(e) => setForm({ ...form, rate: Number(e.target.value) })}
                size="small"
                fullWidth
              />
            )}
            <TextField label="Active From" type="date" value={form.activeFrom} onChange={(e) => setForm({ ...form, activeFrom: e.target.value })} size="small" fullWidth />
            <TextField label="Active To" type="date" value={form.activeTo} onChange={(e) => setForm({ ...form, activeTo: e.target.value })} size="small" fullWidth />
            <FormControlLabel control={<Checkbox checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />} label="Active" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog({ open: false, item: null })}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={!form.itemId}>Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
