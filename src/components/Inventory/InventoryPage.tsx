import { useMemo, useRef, useState } from 'react';
import { Box, Typography, TextField, Table, TableHead, TableRow, TableCell, TableBody, Paper, Chip, Select, MenuItem } from '@mui/material';
import { useCatalogStore } from '../../store/catalogStore';
import { useBranchBatches } from '../../store/branchSelectors';
import { isExpired, isNearExpiry, daysUntil } from '../../utils/fefo';
import { CONTROLLED_STATUS_LABEL, CONTROLLED_STATUS_OPTIONS } from '../../utils/controlledSubstances';
import type { ControlledStatus } from '../../types/catalog';
import { resolveSalePrice } from '../../utils/pricing';
import { formatPackShort, tabletsPerBox } from '../../utils/packUnits';
import { itemCodes } from '../../utils/itemMaster';
import { formatDiscountPercent } from '../../utils/purchasing';
import { formatQty, formatUnitPrice } from '../../utils/format';

import { T, useT } from '../../i18n';
export default function InventoryPage() {
  const tr = useT();
  const setControlledStatus = useCatalogStore((s) => s.setControlledStatus);
  const items = useCatalogStore((s) => s.items);
  const batches = useBranchBatches();
  const [filter, setFilter] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return batches
      .map((b) => ({ batch: b, item: items.find((i) => i.id === b.itemId)! }))
      .filter((r) => r.item && (!q || r.item.nameEn.toLowerCase().includes(q) || r.item.nameAr.includes(q) || itemCodes(r.item).some((code) => code.toLowerCase().includes(q))))
      .sort((a, b) => {
        if (a.batch.expiryDate === null && b.batch.expiryDate === null) return 0;
        if (a.batch.expiryDate === null) return 1;
        if (b.batch.expiryDate === null) return -1;
        return a.batch.expiryDate.localeCompare(b.batch.expiryDate);
      });
  }, [batches, items, filter]);

  const nearExpiryCount = rows.filter((r) => isNearExpiry(r.batch.expiryDate) && r.batch.qtyOnHand > 0).length;

  return (
    <Box>
      {nearExpiryCount > 0 && (
        <Chip
          color="warning"
          sx={{ mb: 2 }}
          label={`${nearExpiryCount}${tr(" batch(es) expiring within 60 days")}`}
        />
      )}
      <TextField
        inputRef={inputRef}
        autoFocus
        fullWidth
        label={tr('Scan barcode or type item name / SKU')}
        size="small"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        sx={{ mb: 2 }}
      />
      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell><T>Item</T></TableCell>
              <TableCell><T>Batch No.</T></TableCell>
              <TableCell><T>Expiry Date</T></TableCell>
              <TableCell align="right"><T>Qty on Hand</T></TableCell>
              <TableCell align="right"><T>Purchase Price</T></TableCell>
              <TableCell align="right"><T>Discount</T></TableCell>
              <TableCell align="right"><T>Cost Price</T></TableCell>
              <TableCell align="right"><T>Sales Price</T></TableCell>
              <TableCell><T>Controlled</T></TableCell>
              <TableCell><T>Status</T></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map(({ batch, item }) => (
              <TableRow key={batch.id} hover>
                <TableCell>
                  <Typography variant="body2">{item.nameEn}</Typography>
                  <Typography variant="caption" color="text.secondary">{item.nameAr} · {itemCodes(item).join(' / ')}</Typography>
                </TableCell>
                <TableCell>{batch.batchNo}</TableCell>
                <TableCell>{batch.expiryDate ?? '—'}</TableCell>
                <TableCell align="right">
                  {item.pack ? (
                    <>
                      <Typography variant="body2">{formatPackShort(item.pack, batch.qtyOnHand)}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatQty(batch.qtyOnHand)} <T>tablets</T>
                      </Typography>
                    </>
                  ) : (
                    batch.qtyOnHand
                  )}
                </TableCell>
                <TableCell align="right">{formatUnitPrice(batch.purchasePrice ?? 0)}</TableCell>
                <TableCell align="right">{batch.purchaseDiscountPercent ? formatDiscountPercent(batch.purchaseDiscountPercent) : '—'}</TableCell>
                <TableCell align="right">
                  {formatUnitPrice(batch.costPrice ?? 0)}
                  {item.pack && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      <T>per tablet</T>
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="right">
                  {formatUnitPrice(resolveSalePrice(item, batch))}
                  {item.pack && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      <T>box ·</T> {formatUnitPrice(item.basePrice / tabletsPerBox(item.pack))}<T>/tab</T>
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Select
                    size="small"
                    displayEmpty
                    inputProps={{ 'aria-label': `Controlled status for ${item.nameEn}` }}
                    value={item.controlledStatus ?? ''}
                    onChange={(e) => setControlledStatus(item.id, (e.target.value as ControlledStatus) || undefined)}
                    sx={{ minWidth: 160, fontSize: 13 }}
                  >
                    <MenuItem value=""><T>None</T></MenuItem>
                    {CONTROLLED_STATUS_OPTIONS.map((s) => (
                      <MenuItem key={s} value={s}>{tr(CONTROLLED_STATUS_LABEL[s])}</MenuItem>
                    ))}
                  </Select>
                </TableCell>
                <TableCell>
                  {isExpired(batch.expiryDate) ? (
                    <Chip size="small" color="error" label={tr('Expired')} />
                  ) : isNearExpiry(batch.expiryDate) ? (
                    <Chip size="small" color="warning" label={`${daysUntil(batch.expiryDate)}${tr("d left")}`} />
                  ) : batch.expiryDate === null ? (
                    <Chip size="small" variant="outlined" label={tr('No expiry')} />
                  ) : batch.qtyOnHand <= item.reorderLevel ? (
                    <Chip size="small" color="info" label={tr('Reorder soon')} />
                  ) : (
                    <Chip size="small" label={tr('OK')} />
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
