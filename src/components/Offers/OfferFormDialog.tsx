import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack, TextField, Alert, Paper,
  ToggleButtonGroup, ToggleButton, InputAdornment,
  List, ListItem, ListItemButton, ListItemText,
} from '@mui/material';
import type { Item, Offer, OfferType } from '../../types/catalog';
import { discountInputToFraction, formatDiscountInput, formatDiscountPercent } from '../../utils/purchasing';
import { itemCodes } from '../../utils/itemMaster';
import { formatMoney, formatQty } from '../../utils/format';
import DiscountInput from '../common/DiscountInput';

interface Props {
  open: boolean;
  items: Item[];
  offers: Offer[];
  offer: Offer | null; // null = creating a new offer
  onSave: (input: Omit<Offer, 'id'>) => void;
  onEditExisting: (offer: Offer) => void;
  onClose: () => void;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function OfferFormDialog({ open, items, offers, offer, onSave, onEditExisting, onClose }: Props) {
  const [itemId, setItemId] = useState('');
  const [itemQuery, setItemQuery] = useState('');
  const [type, setType] = useState<OfferType>('percent');
  const [percentInput, setPercentInput] = useState(''); // whole percentage, e.g. "20" = 20%
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
      setPercentInput(offer.percent ? formatDiscountInput(offer.percent) : '');
      setValueInput(offer.value ? String(offer.value) : '');
      setBuyQtyInput(offer.buyQty ? String(offer.buyQty) : '');
      setFreeQtyInput(offer.freeQty ? String(offer.freeQty) : '');
      setLabel(offer.label);
      setActiveFrom(offer.activeFrom);
      setActiveTo(offer.activeTo);
      const selected = items.find((i) => i.id === offer.itemId);
      setItemQuery(selected ? `${selected.nameEn} (${itemCodes(selected).join(' / ')})` : '');
    } else {
      setItemId('');
      setItemQuery('');
      setType('percent');
      setPercentInput('');
      setValueInput('');
      setBuyQtyInput('');
      setFreeQtyInput('');
      setLabel('');
      setActiveFrom(today());
      setActiveTo(today());
    }
  }, [open, offer, items]);

  // Same search as POS and Incentive Items: EN/AR name or any scannable code.
  const itemSuggestions = useMemo(() => {
    const q = itemQuery.trim().toLowerCase();
    if (!q) return [];
    const selected = items.find((i) => i.id === itemId);
    if (selected && q === `${selected.nameEn} (${itemCodes(selected).join(' / ')})`.toLowerCase()) return [];
    return items
      .filter(
        (i) =>
          i.nameEn.toLowerCase().includes(q) ||
          i.nameAr.includes(q) ||
          itemCodes(i).some((code) => code.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [items, itemQuery, itemId]);

  // One offer per item: a promoted item is offered only for Edit, never a second Add.
  const configuredIds = useMemo(() => new Set(offers.map((o) => o.itemId)), [offers]);
  const existingOffer = !offer && itemId && configuredIds.has(itemId)
    ? offers.find((o) => o.itemId === itemId)
    : undefined;
  const typeValid =
    (type === 'percent' && Number(percentInput) > 0 && Number(percentInput) <= 100) ||
    (type === 'value' && Number(valueInput) > 0) ||
    (type === 'bogo' && Number(buyQtyInput) > 0 && Number(freeQtyInput) > 0);
  const valid = !!itemId && !existingOffer && typeValid && label.trim().length > 0 && !!activeFrom && !!activeTo && activeFrom <= activeTo;

  function save() {
    if (!valid) return;
    const input: Omit<Offer, 'id'> = {
      itemId,
      type,
      label: label.trim(),
      activeFrom,
      activeTo,
      percent: type === 'percent' ? discountInputToFraction(percentInput) : undefined,
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
          <TextField
            label="Search item (name or barcode)"
            value={itemQuery}
            onChange={(e) => {
              setItemQuery(e.target.value);
              setItemId('');
            }}
            placeholder="Type name, Arabic name, or barcode"
            size="small"
            fullWidth
          />
          {itemQuery.trim() !== '' && (
            <Paper variant="outlined" sx={{ maxHeight: 200, overflow: 'auto' }}>
              <List dense disablePadding>
                {itemSuggestions.length === 0 && (
                  <ListItem><ListItemText primary="No matching items in the catalog" /></ListItem>
                )}
                {itemSuggestions.map((i) => {
                  const alreadyConfigured = !offer && configuredIds.has(i.id);
                  return (
                    <ListItemButton
                      key={i.id}
                      disabled={alreadyConfigured}
                      onClick={() => {
                        setItemId(i.id);
                        setItemQuery(`${i.nameEn} (${itemCodes(i).join(' / ')})`);
                      }}
                    >
                      <ListItemText
                        primary={i.nameEn}
                        secondary={`${i.nameAr} · ${itemCodes(i).join(' / ')}${alreadyConfigured ? ' · Already has an offer' : ''}`}
                      />
                    </ListItemButton>
                  );
                })}
              </List>
            </Paper>
          )}
          {existingOffer && (
            <Alert
              severity="warning"
              action={
                <Button size="small" onClick={() => onEditExisting(existingOffer)}>
                  Edit existing
                </Button>
              }
            >
              This item already has an offer ({existingOffer.type === 'percent'
                ? formatDiscountPercent(existingOffer.percent ?? 0)
                : existingOffer.type === 'value'
                  ? `SAR ${formatMoney(existingOffer.value ?? 0)}`
                  : `Buy ${formatQty(existingOffer.buyQty)} Get ${formatQty(existingOffer.freeQty)}`}). Only one offer per item is allowed.
            </Alert>
          )}

          <ToggleButtonGroup exclusive fullWidth value={type} onChange={(_, v) => v && setType(v)}>
            <ToggleButton value="percent">% Off</ToggleButton>
            <ToggleButton value="value">SAR Off</ToggleButton>
            <ToggleButton value="bogo">Buy X Get Y</ToggleButton>
          </ToggleButtonGroup>

          {type === 'percent' && (
            <DiscountInput
              label="Discount"
              value={percentInput}
              onChange={setPercentInput}
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
