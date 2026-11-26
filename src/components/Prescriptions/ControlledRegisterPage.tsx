// Controlled-drug register (represcription.md §5 P1, §10 Phase 3).
//
// One screen for the three things the register has to answer: what moved (immutable entries), what
// the running balance should be (monthly reconciliation against Batch.qtyOnHand), and what the
// regulator gets (CSV). Write-offs (damage / expired stock) live here too because they are the only
// movement that has no sale or return document behind it.
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl,
  InputLabel, List, ListItemButton, ListItemText, MenuItem, Paper, Select, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import DeleteSweepOutlinedIcon from '@mui/icons-material/DeleteSweepOutlined';
import DownloadIcon from '@mui/icons-material/Download';
import type { Item } from '../../types/catalog';
import type { ControlledRegisterKind } from '../../types/controlledRegister';
import { useCatalogStore } from '../../store/catalogStore';
import { useBranchBatches } from '../../store/branchSelectors';
import { useControlledRegisterStore } from '../../store/controlledRegisterStore';
import { useCostCenterStore } from '../../store/costCenterStore';
import { useSettingsStore } from '../../store/settingsStore';
import {
  CONTROLLED_REGISTER_KIND_LABEL, controlledRegisterCsv, reconcileControlledRegister,
} from '../../utils/controlledRegister';
import { CONTROLLED_STATUS_LABEL } from '../../utils/controlledSubstances';
import { formatQty } from '../../utils/format';
import { itemCodes } from '../../utils/itemMaster';
import { maskNationalId } from '../../utils/wasfaty';

import { T, useT } from '../../i18n';
const KIND_COLOR: Record<ControlledRegisterKind, 'default' | 'primary' | 'success' | 'warning' | 'error'> = {
  opening: 'default',
  dispense: 'primary',
  return: 'success',
  damage: 'error',
  expiry: 'warning',
};

// The register opens on the month being reconciled. Module-level so the component body does not
// call Date() during render; useState treats it as the lazy initializer.
function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export default function ControlledRegisterPage() {
  const tr = useT();
  const entries = useControlledRegisterStore((s) => s.entries);
  const recordMovement = useControlledRegisterStore((s) => s.recordMovement);
  const items = useCatalogStore((s) => s.items);
  const batches = useBranchBatches();
  const decrementBatch = useCatalogStore((s) => s.decrementBatch);
  const centers = useCostCenterStore((s) => s.centers);
  const settings = useSettingsStore((s) => s.settings);

  const [month, setMonth] = useState(currentMonth);
  const [branchFilter, setBranchFilter] = useState(settings.costCenterId ?? '');
  const [search, setSearch] = useState('');
  // The item picked from the search dropdown. Distinct from the free-text query: the text also
  // matches Rx / invoice / batch / pharmacist, while a picked item scopes both panels to one item.
  const [itemFilter, setItemFilter] = useState<string | null>(null);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const [writeOffOpen, setWriteOffOpen] = useState(false);

  const branchNames = useMemo(
    () => Object.fromEntries(centers.map((center) => [center.id, `${center.code} — ${center.nameEn}`])),
    [centers],
  );

  const selectedItem = itemFilter ? items.find((item) => item.id === itemFilter) ?? null : null;

  // Same item search as the till and the purchase screen: type a name, an Arabic name or scan any
  // printed code. Controlled items are listed first because they are what this screen is about, but
  // every active item is searchable - a pharmacist checking whether a drug is in the register should
  // get an answer ("not controlled" / "no movements") instead of an empty dropdown.
  const suggestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return items
      .filter((item) => item.isActive !== false)
      .filter(
        (item) =>
          item.nameEn.toLowerCase().includes(q) ||
          item.nameAr.includes(q) ||
          itemCodes(item).some((code) => code.toLowerCase().includes(q)),
      )
      .sort((a, b) => Number(!!b.controlledStatus) - Number(!!a.controlledStatus))
      .slice(0, 8);
  }, [items, search]);
  const dropdownOpen = isSearchFocused && suggestions.length > 0;

  const monthEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries
      .filter((entry) => entry.at.slice(0, 7) === month)
      .filter((entry) => !branchFilter || entry.branchId === branchFilter)
      .filter((entry) => !itemFilter || entry.itemId === itemFilter)
      .filter(
        (entry) =>
          !q ||
          entry.itemNameEn.toLowerCase().includes(q) ||
          entry.itemNameAr.includes(q) ||
          (entry.prescriptionNo?.toLowerCase().includes(q) ?? false) ||
          (entry.invoiceNo?.toLowerCase().includes(q) ?? false) ||
          (entry.batchNo?.toLowerCase().includes(q) ?? false) ||
          entry.pharmacist.toLowerCase().includes(q),
      )
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [entries, month, branchFilter, itemFilter, search]);

  // Stock is only branch-taggable through the sales/register movements; Batch itself is global.
  // Reconciliation therefore compares against stock only when one branch is selected, and simply
  // reports in/out/closing when the owner is looking at all branches.
  const stockByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const batch of batches) {
      map.set(batch.itemId, (map.get(batch.itemId) ?? 0) + batch.qtyOnHand);
    }
    return map;
  }, [batches]);

  const reconciliation = useMemo(() => {
    const rows = reconcileControlledRegister(
      entries,
      month,
      branchFilter || undefined,
      branchFilter ? stockByItem : undefined,
    );
    return itemFilter ? rows.filter((row) => row.itemId === itemFilter) : rows;
  }, [entries, month, branchFilter, itemFilter, stockByItem]);

  function selectItem(item: Item) {
    setItemFilter(item.id);
    setSearch('');
    setHighlightedIndex(-1);
    setIsSearchFocused(false);
    searchRef.current?.focus();
  }

  function clearItemFilter() {
    setItemFilter(null);
    setSearch('');
    searchRef.current?.focus();
  }

  function submitSearch() {
    const q = search.trim().toLowerCase();
    if (!q) return;
    // An exact barcode/SKU/name wins outright (a scanner types the whole code instantly), otherwise
    // the highlighted suggestion, else the first one - the same "Enter selects" rule as the POS.
    const exact = items.find(
      (item) =>
        item.nameEn.toLowerCase() === q ||
        item.nameAr.trim().toLowerCase() === q ||
        itemCodes(item).some((code) => code.toLowerCase() === q),
    );
    const target = exact ?? (highlightedIndex >= 0 ? suggestions[highlightedIndex] : suggestions[0]);
    if (target) selectItem(target);
  }

  function handleSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (dropdownOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setHighlightedIndex((index) => {
        const next = e.key === 'ArrowDown' ? index + 1 : index - 1;
        if (next < 0) return suggestions.length - 1;
        if (next >= suggestions.length) return 0;
        return next;
      });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      submitSearch();
      return;
    }
    if (e.key === 'Escape') setIsSearchFocused(false);
  }

  function exportCsv() {
    // BOM so Excel opens the Arabic item names in the right encoding.
    const csv = `\ufeff${controlledRegisterCsv(monthEntries, branchNames)}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `controlled-register-${month}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const stockForSelected = itemFilter ? stockByItem.get(itemFilter) ?? 0 : undefined;
  // An empty result must say WHY it is empty: "nothing moved" is not the same answer as "this drug
  // is not controlled", and the owner searching a specific item needs that distinction.
  const emptyEntriesMessage = selectedItem
    ? selectedItem.controlledStatus
      ? `No register entries for ${selectedItem.nameEn} in ${month} for this branch. Stock on hand: ${formatQty(stockForSelected ?? 0)}.`
      : `${selectedItem.nameEn} is not a controlled item — the register only tracks controlled stock.`
    : 'No register entries match this month, branch and search.';
  const emptyReconciliationMessage = selectedItem
    ? `No controlled movements for ${selectedItem.nameEn} in ${month}.`
    : 'No controlled movements in this month.';

  return (
    <Box sx={{ p: 3, maxWidth: 1400 }}>
      <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 260 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}><T>Controlled Drug Register</T></Typography>
          <Typography variant="caption" color="text.secondary">
            <T>Immutable stock movements for controlled items, with a running balance per item and branch.</T>
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<DownloadIcon />} onClick={exportCsv} disabled={monthEntries.length === 0}>
          <T>Export CSV</T>
        </Button>
        <Button variant="contained" color="warning" startIcon={<DeleteSweepOutlinedIcon />} onClick={() => setWriteOffOpen(true)}>
          <T>Write off stock</T>
        </Button>
      </Stack>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField
          label={tr('Month')}
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          size="small"
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ width: 180 }}
        />
        <FormControl size="small" sx={{ minWidth: 240 }}>
          <InputLabel id="register-branch-label"><T>Branch</T></InputLabel>
          <Select
            labelId="register-branch-label"
            label={tr('Branch')}
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
          >
            <MenuItem value=""><T>All branches</T></MenuItem>
            {centers.map((center) => (
              <MenuItem key={center.id} value={center.id}>
                {center.code} — {center.nameEn}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box sx={{ flex: 1, minWidth: 260, position: 'relative' }}>
          <TextField
            inputRef={searchRef}
            fullWidth
            label={tr('Search item, Rx, invoice, batch or pharmacist')}
            size="small"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setHighlightedIndex(-1);
            }}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            onKeyDown={handleSearchKeyDown}
            helperText={
              selectedItem
                ? undefined
                : 'Type an item name, Arabic name or barcode and press Enter to filter to it'
            }
          />
          {dropdownOpen && (
            <Paper
              elevation={4}
              sx={{ position: 'absolute', top: '100%', insetInlineStart: 0, insetInlineEnd: 0, zIndex: 20, mt: 0.5, maxHeight: 320, overflow: 'auto' }}
            >
              <List dense disablePadding>
                {suggestions.map((item, index) => (
                  <ListItemButton
                    key={item.id}
                    selected={index === highlightedIndex}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectItem(item)}
                  >
                    <ListItemText
                      primary={item.nameEn}
                      secondary={`${item.nameAr} · ${itemCodes(item).join(' / ')}`}
                    />
                    <Chip
                      size="small"
                      variant="outlined"
                      color={item.controlledStatus ? 'warning' : 'default'}
                      label={
                        item.controlledStatus
                          ? CONTROLLED_STATUS_LABEL[item.controlledStatus]
                          : 'Not controlled'
                      }
                    />
                  </ListItemButton>
                ))}
              </List>
            </Paper>
          )}
        </Box>
      </Stack>

      {selectedItem && (
        <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip
            color="primary"
            variant="outlined"
            label={`${selectedItem.nameEn} · ${selectedItem.nameAr}`}
            onDelete={clearItemFilter}
          />
          <Typography variant="caption" color="text.secondary">
            {itemCodes(selectedItem).join(' / ')} ·{' '}
            {selectedItem.controlledStatus
              ? CONTROLLED_STATUS_LABEL[selectedItem.controlledStatus]
              : tr("Not controlled")}
          </Typography>
        </Stack>
      )}

      <Paper variant="outlined" sx={{ mb: 2.5 }}>
        <Box sx={{ px: 2, pt: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}><T>Monthly reconciliation —</T> {month}</Typography>
          <Typography variant="caption" color="text.secondary">
            <T>Closing balance should match stock on hand for every controlled item.</T>
          </Typography>
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell><T>Item</T></TableCell>
                {!branchFilter && <TableCell><T>Branch</T></TableCell>}
                <TableCell align="right"><T>Opening</T></TableCell>
                <TableCell align="right"><T>In</T></TableCell>
                <TableCell align="right"><T>Out</T></TableCell>
                <TableCell align="right"><T>Closing</T></TableCell>
                {branchFilter && <TableCell align="right"><T>Stock on hand</T></TableCell>}
                {branchFilter && <TableCell><T>Status</T></TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {reconciliation.length === 0 && (
                <TableRow>
                  <TableCell colSpan={branchFilter ? 8 : 6}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                      {emptyReconciliationMessage}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {reconciliation.map((row) => (
                <TableRow key={row.key} hover>
                  <TableCell>
                    <Typography variant="body2">{row.itemNameEn}</Typography>
                    <Typography variant="caption" color="text.secondary">{row.itemNameAr}</Typography>
                  </TableCell>
                  {!branchFilter && (
                    <TableCell>{row.branchId ? branchNames[row.branchId] ?? row.branchId : tr("Unassigned")}</TableCell>
                  )}
                  <TableCell align="right">{formatQty(row.opening)}</TableCell>
                  <TableCell align="right">{formatQty(row.inQty)}</TableCell>
                  <TableCell align="right">{formatQty(row.outQty)}</TableCell>
                  <TableCell align="right"><strong>{formatQty(row.closing)}</strong></TableCell>
                  {branchFilter && <TableCell align="right">{formatQty(row.stockOnHand ?? 0)}</TableCell>}
                  {branchFilter && (
                    <TableCell>
                      {row.variance === 0 ? (
                        <Chip size="small" color="success" label={tr('Balanced')} />
                      ) : (
                        <Chip size="small" color="error" label={`${tr("Variance ")}${formatQty(row.variance ?? 0)}`} />
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}><T>Register entries</T></Typography>
      <Paper variant="outlined">
        <TableContainer sx={{ maxHeight: 560 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell><T>Date / time</T></TableCell>
                <TableCell><T>Type</T></TableCell>
                <TableCell><T>Item</T></TableCell>
                <TableCell><T>Batch · expiry</T></TableCell>
                <TableCell align="right"><T>In</T></TableCell>
                <TableCell align="right"><T>Out</T></TableCell>
                <TableCell align="right"><T>Balance</T></TableCell>
                <TableCell><T>Rx / invoice / return</T></TableCell>
                <TableCell><T>Prescriber / patient</T></TableCell>
                <TableCell><T>Pharmacist / witness</T></TableCell>
                <TableCell><T>Reason</T></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {monthEntries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                      {emptyEntriesMessage}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {monthEntries.map((entry) => (
                <TableRow key={entry.id} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{new Date(entry.at).toLocaleString()}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={KIND_COLOR[entry.kind]}
                      variant={entry.kind === 'opening' ? 'outlined' : 'filled'}
                      label={tr(CONTROLLED_REGISTER_KIND_LABEL[entry.kind])}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{entry.itemNameEn}</Typography>
                    <Typography variant="caption" color="text.secondary">{entry.itemNameAr}</Typography>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {entry.batchNo ?? '—'} · {entry.expiryDate ?? '—'}
                  </TableCell>
                  <TableCell align="right">{entry.direction === 'in' ? formatQty(entry.baseQty) : ''}</TableCell>
                  <TableCell align="right">{entry.direction === 'out' ? formatQty(entry.baseQty) : ''}</TableCell>
                  <TableCell align="right"><strong>{formatQty(entry.balanceAfter)}</strong></TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ display: 'block' }}>
                      {[entry.prescriptionNo, entry.invoiceNo, entry.returnNo].filter(Boolean).join(' · ') || '—'}
                    </Typography>
                    {entry.reversalOf && (
                      <Typography variant="caption" color="text.secondary"><T>reverses</T> {entry.reversalOf.slice(-8)}</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ display: 'block' }}>{entry.prescriberName ?? '—'}</Typography>
                    <Typography variant="caption" color="text.secondary">{maskNationalId(entry.patientNationalId) || '—'}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ display: 'block' }}>{entry.pharmacist}</Typography>
                    <Typography variant="caption" color="text.secondary">{entry.witness ?? '—'}</Typography>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 220 }}>
                    <Typography variant="caption">{entry.reason ?? '—'}</Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <WriteOffDialog
        // Remounting on open lets the dialog start from the branch currently being reconciled
        // instead of a branch chosen before the filter changed.
        key={writeOffOpen ? 'open' : 'closed'}
        open={writeOffOpen}
        onClose={() => setWriteOffOpen(false)}
        items={items}
        batches={batches}
        centers={centers}
        defaultBranchId={branchFilter || settings.costCenterId}
        pharmacist={settings.cashierName}
        onConfirm={(input) => {
          recordMovement(input.movement);
          decrementBatch(input.batchId, input.movement.baseQty);
          setWriteOffOpen(false);
        }}
      />
    </Box>
  );
}

interface WriteOffProps {
  open: boolean;
  onClose: () => void;
  items: ReturnType<typeof useCatalogStore.getState>['items'];
  batches: ReturnType<typeof useCatalogStore.getState>['batches'];
  centers: ReturnType<typeof useCostCenterStore.getState>['centers'];
  defaultBranchId?: string;
  pharmacist: string;
  onConfirm: (input: {
    batchId: string;
    movement: Parameters<ReturnType<typeof useControlledRegisterStore.getState>['recordMovement']>[0];
  }) => void;
}

function WriteOffDialog({
  open, onClose, items, batches, centers, defaultBranchId, pharmacist, onConfirm,
}: WriteOffProps) {
  const tr = useT();
  const [itemId, setItemId] = useState('');
  const [batchId, setBatchId] = useState('');
  const [kind, setKind] = useState<'damage' | 'expiry'>('expiry');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [witness, setWitness] = useState('');
  const [branchId, setBranchId] = useState(defaultBranchId ?? '');

  const controlledItems = useMemo(
    () => items.filter((item) => item.controlledStatus && item.isActive !== false),
    [items],
  );
  const item = controlledItems.find((candidate) => candidate.id === itemId);
  const itemBatches = batches.filter((batch) => batch.itemId === itemId && batch.qtyOnHand > 0);
  const batch = itemBatches.find((candidate) => candidate.id === batchId);
  const qtyNumber = Number(qty);
  const valid = !!item && !!batch && qtyNumber > 0 && qtyNumber <= batch.qtyOnHand && !!reason.trim();

  function reset() {
    setItemId('');
    setBatchId('');
    setKind('expiry');
    setQty('');
    setReason('');
    setWitness('');
  }

  function submit() {
    if (!valid || !item || !batch) return;
    onConfirm({
      batchId: batch.id,
      movement: {
        kind,
        itemId: item.id,
        itemNameEn: item.nameEn,
        itemNameAr: item.nameAr,
        batchNo: batch.batchNo,
        expiryDate: batch.expiryDate,
        baseQty: qtyNumber,
        branchId: branchId || undefined,
        pharmacist,
        witness: witness.trim() || undefined,
        reason: reason.trim(),
      },
    });
    reset();
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle><T>Write off controlled stock</T></DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          <Alert severity="warning">
            <T>This removes the quantity from the batch and writes an immutable register row. Use it for
            damaged or expired controlled stock — never to hide a dispensing error.</T>
          </Alert>

          <FormControl fullWidth size="small">
            <InputLabel id="writeoff-item-label"><T>Controlled item</T></InputLabel>
            <Select
              labelId="writeoff-item-label"
              label={tr('Controlled item')}
              value={itemId}
              onChange={(e) => {
                setItemId(e.target.value);
                setBatchId('');
              }}
            >
              {controlledItems.map((candidate) => (
                <MenuItem key={candidate.id} value={candidate.id}>
                  {candidate.nameEn} · {candidate.nameAr}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth size="small" disabled={!item}>
            <InputLabel id="writeoff-batch-label"><T>Batch</T></InputLabel>
            <Select
              labelId="writeoff-batch-label"
              label={tr('Batch')}
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
            >
              {itemBatches.map((candidate) => (
                <MenuItem key={candidate.id} value={candidate.id}>
                  {candidate.batchNo} · {candidate.expiryDate ?? tr("no expiry")} · {formatQty(candidate.qtyOnHand)} <T>on hand</T>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <FormControl size="small" sx={{ minWidth: 170 }}>
              <InputLabel id="writeoff-kind-label"><T>Write-off type</T></InputLabel>
              <Select
                labelId="writeoff-kind-label"
                label={tr('Write-off type')}
                value={kind}
                onChange={(e) => setKind(e.target.value as 'damage' | 'expiry')}
              >
                <MenuItem value="expiry"><T>Expired stock</T></MenuItem>
                <MenuItem value="damage"><T>Damaged / lost</T></MenuItem>
              </Select>
            </FormControl>
            <TextField
              label={tr('Quantity (base units)')}
              type="number"
              size="small"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              helperText={batch ? `Max ${formatQty(batch.qtyOnHand)}${item?.pack ? ' tablets' : ''}` : 'Packed items are counted in tablets'}
              slotProps={{ htmlInput: { min: 0, max: batch?.qtyOnHand ?? undefined, step: '1' } }}
              fullWidth
            />
          </Stack>

          <FormControl fullWidth size="small">
            <InputLabel id="writeoff-branch-label"><T>Branch</T></InputLabel>
            <Select
              labelId="writeoff-branch-label"
              label={tr('Branch')}
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
            >
              <MenuItem value=""><T>Unassigned</T></MenuItem>
              {centers.map((center) => (
                <MenuItem key={center.id} value={center.id}>
                  {center.code} — {center.nameEn}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label={tr('Reason (required)')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            size="small"
            required
            fullWidth
          />
          <TextField
            label={tr('Witness (optional)')}
            value={witness}
            onChange={(e) => setWitness(e.target.value)}
            size="small"
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}><T>Cancel</T></Button>
        <Button variant="contained" color="warning" disabled={!valid} onClick={submit}>
          <T>Write off</T>
        </Button>
      </DialogActions>
    </Dialog>
  );
}
