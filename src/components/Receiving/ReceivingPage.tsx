import { useState } from 'react';
import { Box, Typography, TextField, Button, Paper, Stack, Select, MenuItem, FormControl, InputLabel, Alert, InputAdornment } from '@mui/material';
import { useCatalogStore } from '../../store/catalogStore';
import { computeCostPrice } from '../../utils/pricing';

export default function ReceivingPage() {
  const { items, receiveStock } = useCatalogStore();
  const [itemId, setItemId] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [qty, setQty] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [discountPercent, setDiscountPercent] = useState(''); // whole percentage points, e.g. "10"
  const [done, setDone] = useState(false);

  // e.g. purchase price 10, discount 10% -> cost 9.00 - computed live so the cashier sees the
  // actual net cost before submitting, not just the two raw inputs that produce it.
  const costPrice = computeCostPrice(Number(purchasePrice) || 0, (Number(discountPercent) || 0) / 100);

  const valid =
    itemId && batchNo.trim() && expiryDate && Number(qty) > 0 &&
    Number(purchasePrice) >= 0 &&
    Number(discountPercent) >= 0 && Number(discountPercent) <= 100;

  function submit() {
    if (!valid) return;
    receiveStock({
      itemId,
      batchNo: batchNo.trim(),
      expiryDate,
      qty: Number(qty),
      purchasePrice: Number(purchasePrice),
      purchaseDiscountPercent: Number(discountPercent) / 100,
      source: 'vendor',
    });
    setBatchNo('');
    setExpiryDate('');
    setQty('');
    setPurchasePrice('');
    setDiscountPercent('');
    setDone(true);
    setTimeout(() => setDone(false), 2500);
  }

  return (
    <Box sx={{ p: 3, maxWidth: 480 }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>Stock Receiving</Typography>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          <FormControl fullWidth>
            <InputLabel id="item-label">Item</InputLabel>
            <Select labelId="item-label" label="Item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
              {items.map((i) => (
                <MenuItem key={i.id} value={i.id}>{i.nameEn}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField label="Batch / Lot No." value={batchNo} onChange={(e) => setBatchNo(e.target.value)} fullWidth />
          <TextField
            label="Expiry Date"
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            fullWidth
          />
          <TextField label="Quantity Received" type="number" value={qty} onChange={(e) => setQty(e.target.value)} fullWidth />
          <TextField
            label="Purchase Price (per unit, excl. VAT)"
            type="number"
            value={purchasePrice}
            onChange={(e) => setPurchasePrice(e.target.value)}
            helperText="The supplier's box/invoice price, before any discount."
            slotProps={{ htmlInput: { step: '0.001' } }}
            fullWidth
          />
          <TextField
            label="Discount"
            type="number"
            value={discountPercent}
            onChange={(e) => setDiscountPercent(e.target.value)}
            slotProps={{ input: { endAdornment: <InputAdornment position="end">%</InputAdornment> }, htmlInput: { min: 0, max: 100, step: '0.1' } }}
            fullWidth
          />
          <TextField
            label="Cost Price (computed)"
            value={costPrice.toFixed(3)}
            disabled
            helperText="Purchase price after the discount above - this is what gets recorded as the batch's cost."
            fullWidth
          />
          {done && <Alert severity="success">Stock received into inventory.</Alert>}
          <Button variant="contained" disabled={!valid} onClick={submit}>Receive Stock</Button>
        </Stack>
      </Paper>
    </Box>
  );
}
