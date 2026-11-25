// Global dosage-instruction (DOS/SIG) library, under Inventory beside the item, batch and company
// masters.
//
// The point of a library rather than free text on each item: "1 tablet twice daily after food for
// 5 days" is one controlled row, used by every product it suits. Correcting the route, timing or
// wording once updates every linked item, and the POS shows the same words the owner reviewed here.
//
// Deleting is allowed even while items are linked. Unlike a manufacturer number, the item link is
// just a suggestion: removing it cannot corrupt a master key, and every issued sale already carries
// its own frozen directions (SaleLine.dosage), so historical printouts are untouched. The dialog
// states that explicitly and lists the affected items before the owner confirms.
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
import MedicationOutlinedIcon from '@mui/icons-material/MedicationOutlined';
import { useCatalogStore } from '../../store/catalogStore';
import { useDosageStore } from '../../store/dosageStore';
import type { DosageInstruction, DosageInstructionInput } from '../../types/dosage';
import {
  buildDosageText, dosageDoseUnitLabel, dosageFrequencyLabel, dosageRouteLabel, dosageTimingLabel,
  maxDosageNumber, nextDosageCode,
} from '../../utils/dosages';
import DosageFormDialog from './DosageFormDialog';

import { T, useT } from '../../i18n';
type StatusFilter = 'all' | 'active' | 'inactive';

function scheduleSummary(dosage: DosageInstruction): string {
  const parts = [
    `${dosage.doseAmount} ${dosageDoseUnitLabel(dosage.doseUnit)}`,
    dosageRouteLabel(dosage.route),
    dosageFrequencyLabel(dosage.frequency),
    dosage.timing === 'none' ? '' : dosageTimingLabel(dosage.timing),
    dosage.durationDays ? `${dosage.durationDays} day${dosage.durationDays === 1 ? '' : 's'}` : '',
  ];
  return parts.filter(Boolean).join(' · ');
}

export default function DosagesPage() {
  const tr = useT();
  const dosages = useDosageStore((s) => s.dosages);
  const addDosage = useDosageStore((s) => s.addDosage);
  const updateDosage = useDosageStore((s) => s.updateDosage);
  const removeDosage = useDosageStore((s) => s.removeDosage);
  const items = useCatalogStore((s) => s.items);

  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dialog, setDialog] = useState<{ open: boolean; dosage: DosageInstruction | null }>({
    open: false,
    dosage: null,
  });
  const [deleteTarget, setDeleteTarget] = useState<DosageInstruction | null>(null);

  // Derived from the catalogue every render, so the list cannot claim a direction is unused while
  // an item still points at it.
  const itemsByDosage = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const item of items) {
      for (const id of item.dosageIds ?? []) {
        const list = map.get(id);
        if (list) list.push(item.nameEn);
        else map.set(id, [item.nameEn]);
      }
    }
    return map;
  }, [items]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return dosages
      .filter((dosage) => {
        if (statusFilter === 'active' && dosage.isActive === false) return false;
        if (statusFilter === 'inactive' && dosage.isActive !== false) return false;
        if (!q) return true;
        const text = buildDosageText(dosage);
        return [
          dosage.code,
          text.textEn,
          text.textAr,
          dosageRouteLabel(dosage.route),
          dosageFrequencyLabel(dosage.frequency),
          dosage.additionalInstructionsEn ?? '',
          dosage.additionalInstructionsAr ?? '',
        ].some((value) => value.toLowerCase().includes(q));
      })
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [dosages, filter, statusFilter]);

  const activeCount = dosages.filter((d) => d.isActive !== false).length;
  const lastNumber = maxDosageNumber(dosages);
  const nextCode = nextDosageCode(dosages);

  function openCreate() {
    setDialog({ open: true, dosage: null });
  }

  function openEdit(dosage: DosageInstruction) {
    setDialog({ open: true, dosage });
  }

  function save(input: DosageInstructionInput, isActive: boolean) {
    if (dialog.dosage) updateDosage(dialog.dosage.id, input, isActive);
    else addDosage(input, isActive);
    setDialog({ open: false, dosage: null });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    removeDosage(deleteTarget.id);
    setDeleteTarget(null);
  }

  const linkedToTarget = deleteTarget ? (itemsByDosage.get(deleteTarget.id) ?? []) : [];

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, gap: 2 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip
            size="small"
            variant="outlined"
            icon={<MedicationOutlinedIcon />}
            label={`${dosages.length} instructions`}
          />
          <Chip size="small" variant="outlined" color="success" label={`${activeCount} active`} />
          <Chip size="small" variant="outlined" label={`Last code ${lastNumber ? `DOS-${String(lastNumber).padStart(6, '0')}` : '—'}`} />
          <Chip size="small" variant="outlined" color="primary" label={`Next ${nextCode}`} />
        </Stack>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} sx={{ flexShrink: 0 }}>
          <T>Add Instruction</T>
        </Button>
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
        <T>Dosage instructions (إرشادات الاستخدام) — one reusable bilingual direction, linked to any
        number of items. The POS still lets the pharmacist choose per sale line.</T>
      </Typography>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField
          fullWidth
          size="small"
          label={tr('Search code / English / Arabic / route / frequency')}
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
          inputProps={{ 'aria-label': 'Filter dosage instructions' }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          sx={{ minWidth: 170 }}
        >
          <MenuItem value="all"><T>All instructions</T></MenuItem>
          <MenuItem value="active"><T>Active only</T></MenuItem>
          <MenuItem value="inactive"><T>Inactive only</T></MenuItem>
        </Select>
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 110 }}><T>Code</T></TableCell>
              <TableCell><T>Directions</T></TableCell>
              <TableCell sx={{ minWidth: 230 }}><T>Schedule</T></TableCell>
              <TableCell align="center"><T>Items</T></TableCell>
              <TableCell><T>Status</T></TableCell>
              <TableCell><T>Updated</T></TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                    <T>No dosage instructions match this search. Add one to start building the library.</T>
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {rows.map((dosage) => {
              const text = buildDosageText(dosage);
              const linkedCount = itemsByDosage.get(dosage.id)?.length ?? 0;
              return (
                <TableRow key={dosage.id} hover sx={{ cursor: 'pointer' }} onClick={() => openEdit(dosage)}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
                      {dosage.code}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ minWidth: 320, maxWidth: 520 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{text.textEn}</Typography>
                    <Typography variant="caption" color="text.secondary" dir="rtl" sx={{ display: 'block', textAlign: 'left' }}>
                      {text.textAr}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">{scheduleSummary(dosage)}</Typography>
                  </TableCell>
                  <TableCell align="center">
                    {linkedCount > 0 ? (
                      <Chip size="small" variant="outlined" label={linkedCount} />
                    ) : (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {dosage.isActive === false ? (
                      <Chip size="small" color="default" label={tr('Inactive')} />
                    ) : (
                      <Chip size="small" color="success" variant="outlined" label={tr('Active')} />
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {dosage.updatedAt ? new Date(dosage.updatedAt).toLocaleDateString() : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <IconButton
                      size="small"
                      title={tr('Edit instruction')}
                      onClick={(e) => { e.stopPropagation(); openEdit(dosage); }}
                    >
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      title={tr('Delete instruction')}
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(dosage); }}
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
        <DosageFormDialog
          // Remount per row so the form initialises from that instruction (no setState-in-effect).
          key={dialog.dosage?.id ?? tr("new-dosage")}
          open
          dosage={dialog.dosage}
          onSave={save}
          onClose={() => setDialog({ open: false, dosage: null })}
        />
      )}

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle><T>Delete dosage instruction?</T></DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            <DialogContentText>
              <T>This permanently removes</T> <strong>{deleteTarget?.code}</strong> — "
              {deleteTarget ? buildDosageText(deleteTarget).textEn : ''}<T>" — from the shared library.</T>
            </DialogContentText>
            {linkedToTarget.length > 0 ? (
              <>
                <Alert severity="warning">
                  <T>It is currently linked to</T> {linkedToTarget.length} <T>item</T>
                  {linkedToTarget.length === 1 ? '' : 's'}: {linkedToTarget.slice(0, 5).join(', ')}
                  {linkedToTarget.length > 5 ? ` and ${linkedToTarget.length - 5} more` : ''}<T>.
                  Those links will be removed too.</T>
                </Alert>
                <DialogContentText>
                  <T>Already-issued invoices keep the directions they were dispensed with, so historical
                  reprints do not change.</T>
                </DialogContentText>
              </>
            ) : (
              <DialogContentText><T>No item currently links to this instruction.</T></DialogContentText>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDeleteTarget(null)}><T>Cancel</T></Button>
          <Button color="error" variant="contained" onClick={confirmDelete}>
            {linkedToTarget.length > 0 ? tr("Delete & Unlink") : tr("Delete Instruction")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
