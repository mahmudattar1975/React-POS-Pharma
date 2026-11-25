import { useState } from 'react';
import { Box, TextField, Button, Paper, Stack, Select, MenuItem, FormControl, InputLabel, Alert, Typography } from '@mui/material';
import { useCatalogStore } from '../../store/catalogStore';
import { computeCostPrice } from '../../utils/pricing';
import { discountInputToFraction } from '../../utils/purchasing';
import DiscountInput from '../common/DiscountInput';
import type { PackLevel } from '../../types/catalog';
import { PACK_LEVEL_LABEL, PACK_LEVEL_LABEL_PLURAL, purchasePackLevels, tabletsPerUnit } from '../../utils/packUnits';
import { itemCodes, itemTracksExpiry } from '../../utils/itemMaster';
import { formatUnitPrice } from '../../utils/format';

import { T, useT } from '../../i18n';
export default function ReceivingPage() {
  const tr = useT();
  const { items, receiveStock, itemById } = useCatalogStore();
  const [itemId, setItemId] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [qty, setQty] = useState('');
  const [receiveUnit, setReceiveUnit] = useState<PackLevel>('box');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [discountPercent, setDiscountPercent] = useState(''); // whole percentage, e.g. "10" = 10%
  const [done, setDone] = useState(false);

  const item = itemById(itemId);
  const tracksExpiry = item ? itemTracksExpiry(item) : true;
  const pack = item?.pack;
  const perUnit = pack ? tabletsPerUnit(pack, receiveUnit) : 1;

  // e.g. purchase price 10, discount 10% -> cost 9.00 - computed live so the cashier sees the
  // actual net cost before submitting, not just the two raw inputs that produce it. For a packed
  // item this cost is per TABLET (the unit stock is kept in), converted from the invoice unit.
  const costPrice = computeCostPrice(
    (Number(purchasePrice) || 0) / perUnit,
    discountInputToFraction(discountPercent)
  );

  const valid =
    itemId && batchNo.trim() && (!tracksExpiry || expiryDate) && Number(qty) > 0 &&
    Number(purchasePrice) >= 0 &&
    Number(discountPercent) >= 0 && Number(discountPercent) <= 100;

  function submit() {
    if (!valid) return;
    receiveStock({
      itemId,
      batchNo: batchNo.trim(),
      expiryDate: tracksExpiry ? expiryDate : null,
      qty: Number(qty),
      purchasePrice: Number(purchasePrice),
      purchaseDiscountPercent: discountInputToFraction(discountPercent),
      source: 'vendor',
      packLevel: pack ? receiveUnit : undefined,
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
    <Box sx={{ maxWidth: 480 }}>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          <FormControl fullWidth>
            <InputLabel id="item-label"><T>Item</T></InputLabel>
            <Select labelId="item-label" label={tr('Item')} value={itemId} onChange={(e) => setItemId(e.target.value)}>
              {items.map((i) => (
                <MenuItem key={i.id} value={i.id}>{i.nameEn}{itemCodes(i).length > 1 ? ` (${itemCodes(i).length}${tr(" codes)")}` : ''}</MenuItem>
              ))}
            </Select>
          </FormControl>
          {pack && (
            <>
              <FormControl fullWidth>
                <InputLabel id="receive-unit-label"><T>Received as</T></InputLabel>
                <Select
                  labelId="receive-unit-label"
                  label={tr('Received as')}
                  value={receiveUnit}
                  onChange={(e) => setReceiveUnit(e.target.value as PackLevel)}
                >
                  {purchasePackLevels(pack).map((level) => (
                    <MenuItem key={level} value={level}>{PACK_LEVEL_LABEL_PLURAL[level]}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Typography variant="caption" color="text.secondary">
                1 {PACK_LEVEL_LABEL[receiveUnit].toLowerCase()} = {perUnit} <T>tablet</T>{perUnit === 1 ? '' : 's'} <T>· stock is counted in tablets</T>
              </Typography>
            </>
          )}
          <TextField label={tr('Batch / Lot No.')} value={batchNo} onChange={(e) => setBatchNo(e.target.value)} fullWidth />
          <TextField
            label={tracksExpiry ? 'Expiry Date' : 'Expiry Date (none)'}
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            disabled={!!item && !tracksExpiry}
            helperText={item && !tracksExpiry ? 'Item Master marks this item as having no expiry' : undefined}
            slotProps={{ inputLabel: { shrink: true } }}
            fullWidth
          />
          <TextField
            label={pack ? `Quantity Received (${PACK_LEVEL_LABEL_PLURAL[receiveUnit].toLowerCase()})` : 'Quantity Received'}
            type="number"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            helperText={pack && qty ? `= ${Number(qty) * perUnit} tablets` : undefined}
            fullWidth
          />
          <TextField
            label={pack ? `Purchase Price per ${PACK_LEVEL_LABEL[receiveUnit].toLowerCase()} (excl. VAT)` : 'Purchase Price (per unit, excl. VAT)'}
            type="number"
            value={purchasePrice}
            onChange={(e) => setPurchasePrice(e.target.value)}
            helperText={tr('The supplier\'s invoice price for the unit selected above, before any discount.')}
            slotProps={{ htmlInput: { step: '0.001' } }}
            fullWidth
          />
          <DiscountInput
            label={tr('Discount')}
            value={discountPercent}
            onChange={setDiscountPercent}
            fullWidth
          />
          <TextField
            label={tr('Cost Price (computed)')}
            value={costPrice.toFixed(3)}
            disabled
            helperText={
              pack
                ? `Cost per tablet after the discount above (${formatUnitPrice(Number(purchasePrice) / perUnit || 0)} SAR per ${PACK_LEVEL_LABEL[receiveUnit].toLowerCase()}) - recorded as the batch's cost.`
                : 'Purchase price after the discount above - this is what gets recorded as the batch\'s cost.'
            }
            fullWidth
          />
          {done && <Alert severity="success"><T>Stock received into inventory.</T></Alert>}
          <Button variant="contained" disabled={!valid} onClick={submit}><T>Receive Stock</T></Button>
        </Stack>
      </Paper>
    </Box>
  );
}
