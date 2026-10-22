import { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack, TextField, Select, MenuItem,
  FormControl, InputLabel, ToggleButtonGroup, ToggleButton, InputAdornment,
} from '@mui/material';
import type { Item, Offer, OfferType } from '../../types/catalog';

interface Props {
  open: boolean;
  items: Item[];
  offer: Offer | null; // null = creating a new offer
  onSave: (input: Omit<Offer, 'id'>) => void;
  onClose: () => void;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function OfferFormDialog({ open, items, offer, onSave, onClose }: Props) {
  const [itemId, setItemId] = useState('');
  const [type, setType] = useState<OfferType>('percent');
  const [percentInput, setPercentInput] = useState(''); // whole percentage points, e.g. "20"
  const [valueInput, setValueInput] = useState('');
  const [buyQtyInput, setBuyQtyInput] = useState('');
  const [freeQtyInput, setFreeQtyInput] = useState('');
  const [label, setLabel] = useState('');
  const [activeFrom, setActiveFrom] = useState(today());
  const [activeTo, setActiveTo] = useState(today());

  // Re-seed the form every time it opens - either from the offer being edited, or blank for a
  // new one. The dialog is mounted once and toggled via `open`, so a useState initializer alone
  // wouldn't pick up a different `offer` on the next open.
  useEffect(() => {
    if (!open) return;
    if (offer) {
      setItemId(offer.itemId);
      setType(offer.type);
      setPercentInput(offer.percent ? String(Math.round(offer.percent * 100)) : '');
      setValueInput(offer.value ? String(offer.value) : '');
      setBuyQtyInput(offer.buyQty ? String(offer.buyQty) : '');
      setFreeQtyInput(offer.freeQty ? String(offer.freeQty) : '');
      setLabel(offer.label);
      setActiveFrom(offer.activeFrom);
      setActiveTo(offer.activeTo);
    } else {
      setItemId('');
      setType('percent');
      setPercentInput('');
      setValueInput('');
      setBuyQtyInput('');
      setFreeQtyInput('');
      setLabel('');
      setActiveFrom(today());
      setActiveTo(today());
    }
  }, [open, offer]);

  const typeValid =
    (type === 'percent' && Number(percentInput) > 0 && Number(percentInput) <= 100) ||
    (type === 'value' && Number(valueInput) > 0) ||
    (type === 'bogo' && Number(buyQtyInput) > 0 && Number(freeQtyInput) > 0);
  const valid = !!itemId && typeValid && label.trim().length > 0 && !!activeFrom && !!activeTo && activeFrom <= activeTo;

  function save() {
    if (!valid) return;
    const input: Omit<Offer, 'id'> = {
      itemId,
      type,
      label: label.trim(),
      activeFrom,
      activeTo,
      percent: type === 'percent' ? Number(percentInput) / 100 : undefined,
      value: type === 'value' ? Number(valueInput) : undefined,
      buyQty: type === 'bogo' ? Number(buyQtyInput) : undefined,
      freeQty: type === 'bogo' ? Number(freeQtyInput) : undefined,
    };
    onSave(input);
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{offer ? 'Edit Offer' : 'New Offer'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <FormControl fullWidth>
            <InputLabel id="offer-item-label">Item</InputLabel>
            <Select labelId="offer-item-label" label="Item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
              {items.map((i) => (
                <MenuItem key={i.id} value={i.id}>{i.nameEn}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <ToggleButtonGroup exclusive fullWidth value={type} onChange={(_, v) => v && setType(v)}>
            <ToggleButton value="percent">% Off</ToggleButton>
            <ToggleButton value="value">SAR Off</ToggleButton>
            <ToggleButton value="bogo">Buy X Get Y</ToggleButton>
          </ToggleButtonGroup>

          {type === 'percent' && (
            <TextField
              label="Discount"
              type="number"
              value={percentInput}
              onChange={(e) => setPercentInput(e.target.value)}
              helperText="e.g. 20 for 20% off"
              slotProps={{ input: { endAdornment: <InputAdornment position="end">%</InputAdornment> }, htmlInput: { min: 0, max: 100, step: '1' } }}
              fullWidth
            />
          )}
          {type === 'value' && (
            <TextField
              label="Discount per unit"
              type="number"
              value={valueInput}
              onChange={(e) => setValueInput(e.target.value)}
              slotProps={{ input: { endAdornment: <InputAdornment position="end">SAR</InputAdornment> }, htmlInput: { min: 0, step: '0.01' } }}
              fullWidth
            />
          )}
          {type === 'bogo' && (
            <Stack direction="row" spacing={2}>
              <TextField
                label="Buy Qty"
                type="number"
                value={buyQtyInput}
                onChange={(e) => setBuyQtyInput(e.target.value)}
                slotProps={{ htmlInput: { min: 1, step: '1' } }}
                fullWidth
              />
              <TextField
                label="Free Qty"
                type="number"
                value={freeQtyInput}
                onChange={(e) => setFreeQtyInput(e.target.value)}
                slotProps={{ htmlInput: { min: 1, step: '1' } }}
                fullWidth
              />
            </Stack>
          )}

          <TextField
            label="Label shown to the cashier"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            helperText="e.g. Buy 2 Get 1 Free, 20% Off"
            fullWidth
          />

          <Stack direction="row" spacing={2}>
            <TextField
              label="Active From"
              type="date"
              value={activeFrom}
              onChange={(e) => setActiveFrom(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
            <TextField
              label="Active To"
              type="date"
              value={activeTo}
              onChange={(e) => setActiveTo(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!valid} onClick={save}>
          {offer ? 'Save Changes' : 'Create Offer'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
