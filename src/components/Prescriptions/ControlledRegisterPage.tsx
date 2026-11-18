// Controlled-drug register (represcription.md §5 P1, §10 Phase 3).
//
// One screen for the three things the register has to answer: what moved (immutable entries), what
// the running balance should be (monthly reconciliation against Batch.qtyOnHand), and what the
// regulator gets (CSV). Write-offs (damage / expired stock) live here too because they are the only
// movement that has no sale or return document behind it.
import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl,
  InputLabel, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import DeleteSweepOutlinedIcon from '@mui/icons-material/DeleteSweepOutlined';
import DownloadIcon from '@mui/icons-material/Download';
import type { ControlledRegisterKind } from '../../types/controlledRegister';
import { useCatalogStore } from '../../store/catalogStore';
import { useControlledRegisterStore } from '../../store/controlledRegisterStore';
import { useCostCenterStore } from '../../store/costCenterStore';
import { useSettingsStore } from '../../store/settingsStore';
import {
  CONTROLLED_REGISTER_KIND_LABEL, controlledRegisterCsv, reconcileControlledRegister,
} from '../../utils/controlledRegister';
import { formatQty } from '../../utils/format';
import { maskNationalId } from '../../utils/wasfaty';

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
  const entries = useControlledRegisterStore((s) => s.entries);
  const recordMovement = useControlledRegisterStore((s) => s.recordMovement);
  const items = useCatalogStore((s) => s.items);
  const batches = useCatalogStore((s) => s.batches);
  const decrementBatch = useCatalogStore((s) => s.decrementBatch);
  const centers = useCostCenterStore((s) => s.centers);
  const settings = useSettingsStore((s) => s.settings);

  const [month, setMonth] = useState(currentMonth);
  const [branchFilter, setBranchFilter] = useState(settings.costCenterId ?? '');
  const [search, setSearch] = useState('');
  const [writeOffOpen, setWriteOffOpen] = useState(false);

  const branchNames = useMemo(
    () => Object.fromEntries(centers.map((center) => [center.id, `${center.code} — ${center.nameEn}`])),
    [centers],
  );

  const monthEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries
      .filter((entry) => entry.at.slice(0, 7) === month)
      .filter((entry) => !branchFilter || entry.branchId === branchFilter)
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
  }, [entries, month, branchFilter, search]);

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

  const reconciliation = useMemo(
    () =>
      reconcileControlledRegister(
        entries,
        month,
        branchFilter || undefined,
        branchFilter ? stockByItem : undefined,
      ),
    [entries, month, branchFilter, stockByItem],
  );

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

  return (
    <Box sx={{ p: 3, maxWidth: 1400 }}>
      <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 260 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>Controlled Drug Register</Typography>
          <Typography variant="caption" color="text.secondary">
            Immutable stock movements for controlled items, with a running balance per item and branch.
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<DownloadIcon />} onClick={exportCsv} disabled={monthEntries.length === 0}>
          Export CSV
        </Button>
        <Button variant="contained" color="warning" startIcon={<DeleteSweepOutlinedIcon />} onClick={() => setWriteOffOpen(true)}>
          Write off stock
        </Button>
      </Stack>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField
          label="Month"
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          size="small"
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ width: 180 }}
        />
        <FormControl size="small" sx={{ minWidth: 240 }}>
          <InputLabel id="register-branch-label">Branch</InputLabel>
          <Select
            labelId="register-branch-label"
            label="Branch"
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
          >
            <MenuItem value="">All branches</MenuItem>
            {centers.map((center) => (
              <MenuItem key={center.id} value={center.id}>
                {center.code} — {center.nameEn}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          label="Search item / Rx / invoice / batch / pharmacist"
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ flex: 1, minWidth: 260 }}
        />
      </Stack>

      <Paper variant="outlined" sx={{ mb: 2.5 }}>
        <Box sx={{ px: 2, pt: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Monthly reconciliation — {month}</Typography>
          <Typography variant="caption" color="text.secondary">
            Closing balance should match stock on hand for every controlled item.
          </Typography>
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Item</TableCell>
                {!branchFilter && <TableCell>Branch</TableCell>}
                <TableCell align="right">Opening</TableCell>
                <TableCell align="right">In</TableCell>
                <TableCell align="right">Out</TableCell>
                <TableCell align="right">Closing</TableCell>
                {branchFilter && <TableCell align="right">Stock on hand</TableCell>}
                {branchFilter && <TableCell>Status</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {reconciliation.length === 0 && (
                <TableRow>
                  <TableCell colSpan={branchFilter ? 8 : 6}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                      No controlled movements in this month.
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
                    <TableCell>{row.branchId ? branchNames[row.branchId] ?? row.branchId : 'Unassigned'}</TableCell>
                  )}
                  <TableCell align="right">{formatQty(row.opening)}</TableCell>
                  <TableCell align="right">{formatQty(row.inQty)}</TableCell>
                  <TableCell align="right">{formatQty(row.outQty)}</TableCell>
                  <TableCell align="right"><strong>{formatQty(row.closing)}</strong></TableCell>
                  {branchFilter && <TableCell align="right">{formatQty(row.stockOnHand ?? 0)}</TableCell>}
                  {branchFilter && (
                    <TableCell>
                      {row.variance === 0 ? (
                        <Chip size="small" color="success" label="Balanced" />
                      ) : (
                        <Chip size="small" color="error" label={`Variance ${formatQty(row.variance ?? 0)}`} />
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>Register entries</Typography>
      <Paper variant="outlined">
        <TableContainer sx={{ maxHeight: 560 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Date / time</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Item</TableCell>
                <TableCell>Batch · expiry</TableCell>
                <TableCell align="right">In</TableCell>
                <TableCell align="right">Out</TableCell>
                <TableCell align="right">Balance</TableCell>
                <TableCell>Rx / invoice / return</TableCell>
                <TableCell>Prescriber / patient</TableCell>
                <TableCell>Pharmacist / witness</TableCell>
                <TableCell>Reason</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {monthEntries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                      No register entries match this month, branch and search.
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
                      label={CONTROLLED_REGISTER_KIND_LABEL[entry.kind]}
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
                      <Typography variant="caption" color="text.secondary">reverses {entry.reversalOf.slice(-8)}</Typography>
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
      <DialogTitle>Write off controlled stock</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          <Alert severity="warning">
            This removes the quantity from the batch and writes an immutable register row. Use it for
            damaged or expired controlled stock — never to hide a dispensing error.
          </Alert>

          <FormControl fullWidth size="small">
            <InputLabel id="writeoff-item-label">Controlled item</InputLabel>
            <Select
              labelId="writeoff-item-label"
              label="Controlled item"
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
            <InputLabel id="writeoff-batch-label">Batch</InputLabel>
            <Select
              labelId="writeoff-batch-label"
              label="Batch"
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
            >
              {itemBatches.map((candidate) => (
                <MenuItem key={candidate.id} value={candidate.id}>
                  {candidate.batchNo} · {candidate.expiryDate ?? 'no expiry'} · {formatQty(candidate.qtyOnHand)} on hand
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <FormControl size="small" sx={{ minWidth: 170 }}>
              <InputLabel id="writeoff-kind-label">Write-off type</InputLabel>
              <Select
                labelId="writeoff-kind-label"
                label="Write-off type"
                value={kind}
                onChange={(e) => setKind(e.target.value as 'damage' | 'expiry')}
              >
                <MenuItem value="expiry">Expired stock</MenuItem>
                <MenuItem value="damage">Damaged / lost</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Quantity (base units)"
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
            <InputLabel id="writeoff-branch-label">Branch</InputLabel>
            <Select
              labelId="writeoff-branch-label"
              label="Branch"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
            >
              <MenuItem value="">Unassigned</MenuItem>
              {centers.map((center) => (
                <MenuItem key={center.id} value={center.id}>
                  {center.code} — {center.nameEn}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label="Reason (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            size="small"
            required
            fullWidth
          />
          <TextField
            label="Witness (optional)"
            value={witness}
            onChange={(e) => setWitness(e.target.value)}
            size="small"
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" color="warning" disabled={!valid} onClick={submit}>
          Write off
        </Button>
      </DialogActions>
    </Dialog>
  );
}
