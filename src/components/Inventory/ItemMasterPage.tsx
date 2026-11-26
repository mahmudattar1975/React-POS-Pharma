// Item Master - the catalogue maintenance screen that sits beside Inventory & Expiry. Modelled on
// the legacy PowerBuilder window `w_scrn_stock_data` (phstock.pbl, "بيانات المخزون"): add / modify /
// delete an item, search by number/name/barcode, and read the same stock figures (balance, order
// limit, max limit, purchase/sales movement totals) the old screen showed.
//
// Unlike the legacy screen, the balance and movement totals are never stored on the item - they are
// derived from Batch rows and the receiving/sales logs on every render, so the master page can't
// drift away from what is physically on the shelf.
import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  IconButton, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import SearchIcon from '@mui/icons-material/Search';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import { useCatalogStore } from '../../store/catalogStore';
import { useBranchBatches, useBranchReceivingLog, useBranchSales } from '../../store/branchSelectors';
import { usePurchasingStore } from '../../store/purchasingStore';
import { useManufacturerStore } from '../../store/manufacturerStore';
import { useDosageStore } from '../../store/dosageStore';
import type { Item } from '../../types/catalog';
import { itemCodes, itemMovementTotals, itemNumberOf, nextItemNumber } from '../../utils/itemMaster';
import { buildDosageText } from '../../utils/dosages';
import { manufacturerDisplayName } from '../../utils/manufacturers';
import { formatPackShort } from '../../utils/packUnits';
import { CONTROLLED_STATUS_LABEL } from '../../utils/controlledSubstances';
import { formatMoney, formatQty } from '../../utils/format';
import ItemMasterFormDialog from './ItemMasterFormDialog';

import { T, useT } from '../../i18n';
type StatusFilter = 'all' | 'active' | 'inactive';

export default function ItemMasterPage() {
  const tr = useT();
  const items = useCatalogStore((s) => s.items);
  const batches = useBranchBatches();
  const receivingLog = useBranchReceivingLog();
  const addItem = useCatalogStore((s) => s.addItem);
  const updateItem = useCatalogStore((s) => s.updateItem);
  const convertStockToBase = useCatalogStore((s) => s.convertStockToBase);
  const deleteItem = useCatalogStore((s) => s.deleteItem);
  const invoices = useBranchSales();
  const vendors = usePurchasingStore((s) => s.vendors);
  const manufacturers = useManufacturerStore((s) => s.manufacturers);
  const dosages = useDosageStore((s) => s.dosages);

  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dialog, setDialog] = useState<{ open: boolean; item: Item | null }>({ open: false, item: null });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const saleLines = useMemo(() => invoices.flatMap((inv) => inv.lines), [invoices]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return items
      .filter((i) => {
        if (statusFilter === 'active' && i.isActive === false) return false;
        if (statusFilter === 'inactive' && i.isActive !== false) return false;
        if (!q) return true;
        const number = String(itemNumberOf(i) ?? '');
        // Directions are searchable too: "after food", "5 days" or an Arabic phrase should find the
        // products whose linked instructions say it.
        const dosageText = (i.dosageIds ?? [])
          .map((id) => {
            const dosage = dosages.find((d) => d.id === id);
            if (!dosage) return '';
            const text = buildDosageText(dosage);
            return `${text.textEn} ${text.textAr}`;
          })
          .join(' ');
        return [
          i.nameEn, i.nameAr, ...itemCodes(i), i.scientificName ?? '', i.category,
          i.manufacturerNo ?? '', manufacturerDisplayName(manufacturers, i.manufacturerNo) ?? '', number,
          vendors.find((v) => v.vendorNo === i.vendorNo)?.nameEn ?? '', dosageText,
        ]
          .some((value) => value.toLowerCase().includes(q));
      })
      .map((item) => ({
        item,
        itemNo: itemNumberOf(item),
        totals: itemMovementTotals(item, batches, receivingLog, saleLines),
      }))
      .sort(
        (a, b) =>
          (a.itemNo ?? Number.MAX_SAFE_INTEGER) - (b.itemNo ?? Number.MAX_SAFE_INTEGER) ||
          a.item.nameEn.localeCompare(b.item.nameEn)
      );
  }, [items, batches, receivingLog, saleLines, filter, statusFilter, manufacturers, vendors, dosages]);

  const activeCount = items.filter((i) => i.isActive !== false).length;
  // Same header as the company master: the last local item number in use and the number a new
  // item will receive. ERP imports keep their own XPH key (e.g. 101682) and are deliberately
  // excluded here, matching nextItemNumber() so the two numbers always continue one sequence.
  const nextNumber = nextItemNumber(items);
  const lastNumber = items.reduce(
    (max, item) => (item.id.startsWith('erp-') ? max : Math.max(max, itemNumberOf(item) ?? 0)),
    0
  );
  const lowStockCount = useMemo(
    () => rows.filter((r) => r.totals.onHandQty <= r.item.reorderLevel).length,
    [rows]
  );

  function openCreate() {
    setSaveError(null);
    setDialog({ open: true, item: null });
  }

  function openEdit(item: Item) {
    setSaveError(null);
    setDialog({ open: true, item });
  }

  function save(input: Omit<Item, 'id' | 'itemNo'>, stockFactor?: number) {
    try {
      if (dialog.item) {
        updateItem(dialog.item.id, input);
        // Enabling a ladder converts the item to tablet stock: the batches must follow, otherwise
        // "138 strips" would be re-read as 138 tablets. Runs after the item row exists with its pack.
        if (stockFactor && stockFactor > 1) convertStockToBase(dialog.item.id, stockFactor, input.pack);
      } else {
        addItem(input);
      }
      setDialog({ open: false, item: null });
      setSaveError(null);
    } catch (err) {
      // Store-level guards (duplicate barcode/GTIN) surface here; the dialog stays open so the
      // user can correct the value rather than losing the rest of the form.
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    try {
      deleteItem(deleteTarget.id);
      setDeleteTarget(null);
      setDeleteError(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, gap: 2 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip
            size="small"
            variant="outlined"
            icon={<Inventory2OutlinedIcon />}
            label={`${items.length} items`}
          />
          <Chip size="small" variant="outlined" color="success" label={`${activeCount} active`} />
          <Chip size="small" variant="outlined" label={`Last number ${lastNumber || '—'}`} />
          <Chip size="small" variant="outlined" color="primary" label={`Next number ${nextNumber}`} />
        </Stack>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} sx={{ flexShrink: 0 }}>
          <T>Add Item</T>
        </Button>
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
        <T>بيانات المخزون — item number, names, price, pack, stock and movements</T>
      </Typography>

      {lowStockCount > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {lowStockCount} <T>item(s) at or below their reorder level in the current view.</T>
        </Alert>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField
          fullWidth
          size="small"
          label={tr('Scan barcode or search item no / name / category / manufacturer / vendor')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          slotProps={{
            input: {
              startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />,
            },
          }}
        />
        <Select
          size="small"
          inputProps={{ 'aria-label': 'Filter items' }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          sx={{ minWidth: 170 }}
        >
          <MenuItem value="all"><T>All items</T></MenuItem>
          <MenuItem value="active"><T>Active only</T></MenuItem>
          <MenuItem value="inactive"><T>Discontinued only</T></MenuItem>
        </Select>
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell><T>Item</T></TableCell>
              <TableCell><T>Barcode / GTIN</T></TableCell>
              <TableCell><T>Category / Unit</T></TableCell>
              <TableCell><T>Location</T></TableCell>
              <TableCell align="center"><T>VAT</T></TableCell>
              <TableCell align="right"><T>Sale Price</T></TableCell>
              <TableCell align="right"><T>Balance</T></TableCell>
              <TableCell align="right"><T>Min / Max</T></TableCell>
              <TableCell><T>Status</T></TableCell>
              <TableCell align="right"><T>Actions</T></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={10}>
                  <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                    <T>No items match this search. Add an item to start building the master file.</T>
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {rows.map(({ item, itemNo, totals }) => {
              const low = totals.onHandQty <= item.reorderLevel;
              return (
                <TableRow key={item.id} hover sx={{ cursor: 'pointer' }} onClick={() => openEdit(item)}>
                  <TableCell sx={{ minWidth: 240 }}>
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{item.nameEn}</Typography>
                      {item.controlledStatus && (
                        <Chip
                          size="small"
                          color="error"
                          variant="outlined"
                          label={tr(CONTROLLED_STATUS_LABEL[item.controlledStatus])}
                        />
                      )}
                      {(item.dosageIds?.length ?? 0) > 0 && (
                        <Chip
                          size="small"
                          color="primary"
                          variant="outlined"
                          label={`${item.dosageIds!.length} direction${item.dosageIds!.length === 1 ? '' : 's'}`}
                        />
                      )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      #{itemNo ?? '—'} · {item.nameAr || '—'}
                      {item.scientificName ? ` · ${item.scientificName}` : ''}
                      {item.manufacturerNo
                        ? `${tr(" · Mfr ")}${manufacturerDisplayName(manufacturers, item.manufacturerNo)}`
                        : ''}
                      {item.vendorNo
                        ? `${tr(" · Vendor ")}${vendors.find((v) => v.vendorNo === item.vendorNo)?.nameEn ?? item.vendorNo}`
                        : ''}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {(() => {
  const tr = useT();
                      const codes = itemCodes(item);
                      // Every code is listed, not just a "+N more" hint: the owner asked for several
                      // barcodes/GTINs per item, so they must be able to see them at a glance.
                      return codes.map((code, idx) => (
                        <Typography
                          key={code}
                          variant={idx === 0 ? 'body2' : 'caption'}
                          color={idx === 0 ? 'text.primary' : 'text.secondary'}
                          sx={{ fontFamily: 'monospace', display: 'block', lineHeight: 1.3 }}
                        >
                          {code}
                          {idx === 0 && codes.length > 1 ? tr("(main)") : ''}
                        </Typography>
                      ));
                    })()}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{item.category || '—'}</Typography>
                    <Typography variant="caption" color="text.secondary">{item.unit || '—'}</Typography>
                  </TableCell>
                  <TableCell>{item.location || '—'}</TableCell>
                  <TableCell align="center">
                    <Chip size="small" variant="outlined" label={`${Math.round(item.vatRate * 100)}%`} />
                  </TableCell>
                  <TableCell align="right">{formatMoney(item.basePrice)}</TableCell>
                  <TableCell align="right">
                    {item.pack ? (
                      <>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {formatPackShort(item.pack, totals.onHandQty)}
                        </Typography>
                        {low && <Chip size="small" color="warning" label={tr('Reorder')} sx={{ mt: 0.25 }} />}
                      </>
                    ) : (
                      <>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatQty(totals.onHandQty)}</Typography>
                        {low && <Chip size="small" color="warning" label={tr('Reorder')} sx={{ mt: 0.25 }} />}
                      </>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2">
                      {item.reorderLevel} / {item.maxLevel ?? '—'}
                    </Typography>
                    {item.pack && (
                      <Typography variant="caption" color="text.secondary">
                        {formatPackShort(item.pack, item.reorderLevel)}
                        {item.maxLevel !== undefined ? ` / ${formatPackShort(item.pack, item.maxLevel)}` : ''}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {item.isActive === false ? (
                      <Chip size="small" color="default" label={tr('Discontinued')} />
                    ) : (
                      <Chip size="small" color="success" variant="outlined" label={tr('Active')} />
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <IconButton
                      size="small"
                      title={tr('Edit item')}
                      onClick={(e) => { e.stopPropagation(); openEdit(item); }}
                    >
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      title={tr('Delete item')}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteError(null);
                        setDeleteTarget(item);
                      }}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {dialog.open && (
        <ItemMasterFormDialog
          // Remount per row so the form initialises from that item (no setState-in-effect reset).
          key={dialog.item?.id ?? tr("new-item")}
          open
          item={dialog.item}
          items={items}
          vendors={vendors}
          manufacturers={manufacturers}
          batches={batches}
          receivingLog={receivingLog}
          saleLines={saleLines}
          onSave={save}
          onClose={() => setDialog({ open: false, item: null })}
          error={saveError}
        />
      )}

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle><T>Delete item?</T></DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            {deleteError && <Alert severity="error" onClose={() => setDeleteError(null)}>{deleteError}</Alert>}
            <DialogContentText>
              <T>This permanently removes</T> <strong>{deleteTarget?.nameEn}</strong>{' '}
              (#{deleteTarget ? (itemNumberOf(deleteTarget) ?? '—') : '—'}<T>) and its zero-quantity
              batches from the local catalogue. Receiving history and issued invoices keep their own
              snapshots and are not changed.</T>
            </DialogContentText>
            <DialogContentText>
              <T>Items with stock on hand cannot be deleted - mark them discontinued instead so they
              stop being reordered without breaking existing stock.</T>
            </DialogContentText>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDeleteTarget(null)}><T>Cancel</T></Button>
          <Button color="error" variant="contained" onClick={confirmDelete}><T>Delete Item</T></Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
