import { useMemo, useRef, useState } from 'react';
import { Box, Typography, TextField, Table, TableHead, TableRow, TableCell, TableBody, Paper, Chip, Stack, Select, MenuItem } from '@mui/material';
import { useCatalogStore } from '../../store/catalogStore';
import { isExpired, isNearExpiry, daysUntil } from '../../utils/fefo';
import { CONTROLLED_STATUS_LABEL, CONTROLLED_STATUS_OPTIONS } from '../../utils/controlledSubstances';
import type { ControlledStatus } from '../../types/catalog';
import { resolveSalePrice } from '../../utils/pricing';

export default function InventoryPage() {
  const { items, batches, setControlledStatus } = useCatalogStore();
  const [filter, setFilter] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return batches
      .map((b) => ({ batch: b, item: items.find((i) => i.id === b.itemId)! }))
      .filter((r) => r.item && (!q || r.item.nameEn.toLowerCase().includes(q) || r.item.nameAr.includes(q) || r.item.barcode.includes(q)))
      .sort((a, b) => a.batch.expiryDate.localeCompare(b.batch.expiryDate));
  }, [batches, items, filter]);

  const nearExpiryCount = rows.filter((r) => isNearExpiry(r.batch.expiryDate) && r.batch.qtyOnHand > 0).length;

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Inventory &amp; Expiry</Typography>
        {nearExpiryCount > 0 && <Chip color="warning" label={`${nearExpiryCount} batch(es) expiring within 60 days`} />}
      </Stack>
      <TextField
        inputRef={inputRef}
        autoFocus
        fullWidth
        label="Scan barcode or type item name / SKU"
        size="small"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        sx={{ mb: 2 }}
      />
      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Item</TableCell>
              <TableCell>Batch No.</TableCell>
              <TableCell>Expiry Date</TableCell>
              <TableCell align="right">Qty on Hand</TableCell>
              <TableCell align="right">Purchase Price</TableCell>
              <TableCell align="right">Discount</TableCell>
              <TableCell align="right">Cost Price</TableCell>
              <TableCell align="right">Sales Price</TableCell>
              <TableCell>Controlled</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map(({ batch, item }) => (
              <TableRow key={batch.id} hover>
                <TableCell>
                  <Typography variant="body2">{item.nameEn}</Typography>
                  <Typography variant="caption" color="text.secondary">{item.nameAr} · {item.barcode}</Typography>
                </TableCell>
                <TableCell>{batch.batchNo}</TableCell>
                <TableCell>{batch.expiryDate}</TableCell>
                <TableCell align="right">{batch.qtyOnHand}</TableCell>
                <TableCell align="right">{(batch.purchasePrice ?? 0).toFixed(3)}</TableCell>
                <TableCell align="right">{batch.purchaseDiscountPercent ? `${(batch.purchaseDiscountPercent * 100).toFixed(2)}%` : '—'}</TableCell>
                <TableCell align="right">{(batch.costPrice ?? 0).toFixed(3)}</TableCell>
                <TableCell align="right">{resolveSalePrice(item, batch).toFixed(3)}</TableCell>
                <TableCell>
                  <Select
                    size="small"
                    displayEmpty
                    value={item.controlledStatus ?? ''}
                    onChange={(e) => setControlledStatus(item.id, (e.target.value as ControlledStatus) || undefined)}
                    sx={{ minWidth: 160, fontSize: 13 }}
                  >
                    <MenuItem value="">None</MenuItem>
                    {CONTROLLED_STATUS_OPTIONS.map((s) => (
                      <MenuItem key={s} value={s}>{CONTROLLED_STATUS_LABEL[s]}</MenuItem>
                    ))}
                  </Select>
                </TableCell>
                <TableCell>
                  {isExpired(batch.expiryDate) ? (
                    <Chip size="small" color="error" label="Expired" />
                  ) : isNearExpiry(batch.expiryDate) ? (
                    <Chip size="small" color="warning" label={`${daysUntil(batch.expiryDate)}d left`} />
                  ) : batch.qtyOnHand <= item.reorderLevel ? (
                    <Chip size="small" color="info" label="Reorder soon" />
                  ) : (
                    <Chip size="small" label="OK" />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}
