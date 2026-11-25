// Manufacturer / company master ("بيانات الشركات الصانعة"). Modelled on the legacy company-data
// screen (FCODCORP / fcodcorp-list): a numbered list of the companies whose products the pharmacy
// stocks, with the Arabic + English names and the free-text detailed-data block. The "last number"
// ("اخر رقم") is the highest company number in use; a new company continues from it.
//
// The number is the key Item.manufacturerNo stores, so editing a name or the details never touches
// the item master. Deleting a company that still has items is refused for the same reason - the
// owner can mark it inactive instead, and old items keep resolving.
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
import FactoryOutlinedIcon from '@mui/icons-material/FactoryOutlined';
import { useCatalogStore } from '../../store/catalogStore';
import { useManufacturerStore, type ManufacturerInput } from '../../store/manufacturerStore';
import type { Manufacturer } from '../../types/manufacturer';
import { maxCompanyNumber, nextCompanyNumber } from '../../utils/manufacturers';
import ManufacturerFormDialog from './ManufacturerFormDialog';

import { T, useT } from '../../i18n';
type StatusFilter = 'all' | 'active' | 'inactive';

export default function ManufacturersPage() {
  const tr = useT();
  const manufacturers = useManufacturerStore((s) => s.manufacturers);
  const addManufacturer = useManufacturerStore((s) => s.addManufacturer);
  const updateManufacturer = useManufacturerStore((s) => s.updateManufacturer);
  const removeManufacturer = useManufacturerStore((s) => s.removeManufacturer);
  const items = useCatalogStore((s) => s.items);

  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dialog, setDialog] = useState<{ open: boolean; manufacturer: Manufacturer | null }>({
    open: false,
    manufacturer: null,
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Manufacturer | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // How many item-master rows point at each company number. Derived on every render from the
  // catalogue, so the list can never claim a company is unused when an item still references it.
  const itemCountByCompany = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const key = (item.manufacturerNo ?? '').trim();
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return manufacturers
      .filter((company) => {
        if (statusFilter === 'active' && company.isActive === false) return false;
        if (statusFilter === 'inactive' && company.isActive !== false) return false;
        if (!q) return true;
        return [
          String(company.companyNo),
          company.nameAr,
          company.nameEn,
          company.details ?? '',
        ].some((value) => value.toLowerCase().includes(q));
      })
      .sort((a, b) => Number(a.companyNo) - Number(b.companyNo) || a.nameEn.localeCompare(b.nameEn));
  }, [manufacturers, filter, statusFilter]);

  const lastNumber = maxCompanyNumber(manufacturers);
  const nextNumber = nextCompanyNumber(manufacturers);
  const activeCount = manufacturers.filter((c) => c.isActive !== false).length;

  function openCreate() {
    setSaveError(null);
    setDialog({ open: true, manufacturer: null });
  }

  function openEdit(company: Manufacturer) {
    setSaveError(null);
    setDialog({ open: true, manufacturer: company });
  }

  function save(input: ManufacturerInput) {
    try {
      if (dialog.manufacturer) {
        const { companyNo: _ignored, ...rest } = input;
        updateManufacturer(dialog.manufacturer.id, rest);
      } else {
        addManufacturer(input);
      }
      setDialog({ open: false, manufacturer: null });
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const linked = itemCountByCompany.get(String(deleteTarget.companyNo)) ?? 0;
    if (linked > 0) {
      setDeleteError(
        `${linked} item(s) still use company ${deleteTarget.companyNo}. ` +
        'Mark it inactive instead so those items keep resolving.'
      );
      return;
    }
    removeManufacturer(deleteTarget.id);
    setDeleteTarget(null);
    setDeleteError(null);
  }

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, gap: 2 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip
            size="small"
            variant="outlined"
            icon={<FactoryOutlinedIcon />}
            label={`${manufacturers.length} companies`}
          />
          <Chip size="small" variant="outlined" color="success" label={`${activeCount} active`} />
          <Chip size="small" variant="outlined" label={`Last number ${lastNumber || '—'}`} />
          <Chip size="small" variant="outlined" color="primary" label={`Next number ${nextNumber}`} />
        </Stack>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} sx={{ flexShrink: 0 }}>
          <T>Add Company</T>
        </Button>
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
        <T>بيانات الشركات الصانعة — company number, Arabic/English name and detailed data</T>
      </Typography>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField
          fullWidth
          size="small"
          label={tr('Search company no / Arabic name / English name / details')}
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
          inputProps={{ 'aria-label': 'Filter companies' }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          sx={{ minWidth: 170 }}
        >
          <MenuItem value="all"><T>All companies</T></MenuItem>
          <MenuItem value="active"><T>Active only</T></MenuItem>
          <MenuItem value="inactive"><T>Inactive only</T></MenuItem>
        </Select>
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 90 }}><T>Company No</T></TableCell>
              <TableCell><T>Company name</T></TableCell>
              <TableCell><T>Detailed data</T></TableCell>
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
                    <T>No companies match this search. Add a company to start building the manufacturer file.</T>
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {rows.map((company) => {
              const linked = itemCountByCompany.get(String(company.companyNo)) ?? 0;
              return (
                <TableRow
                  key={company.id}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => openEdit(company)}
                >
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {company.companyNo}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ minWidth: 240 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{company.nameEn}</Typography>
                    <Typography variant="caption" color="text.secondary" dir="rtl" sx={{ display: 'block', textAlign: 'left' }}>
                      {company.nameAr}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 360 }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        whiteSpace: 'pre-line',
                      }}
                    >
                      {company.details || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    {linked > 0 ? (
                      <Chip size="small" variant="outlined" label={linked} />
                    ) : (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {company.isActive === false ? (
                      <Chip size="small" color="default" label={tr('Inactive')} />
                    ) : (
                      <Chip size="small" color="success" variant="outlined" label={tr('Active')} />
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {company.updatedAt ? new Date(company.updatedAt).toLocaleDateString() : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <IconButton
                      size="small"
                      title={tr('Edit company')}
                      onClick={(e) => { e.stopPropagation(); openEdit(company); }}
                    >
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      title={tr('Delete company')}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteError(null);
                        setDeleteTarget(company);
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
        <ManufacturerFormDialog
          // Remount per row so the form initialises from that company (no setState-in-effect reset).
          key={dialog.manufacturer?.id ?? tr("new-company")}
          open
          manufacturer={dialog.manufacturer}
          manufacturers={manufacturers}
          onSave={save}
          onClose={() => setDialog({ open: false, manufacturer: null })}
          error={saveError}
        />
      )}

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle><T>Delete company?</T></DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            {deleteError && <Alert severity="error" onClose={() => setDeleteError(null)}>{deleteError}</Alert>}
            <DialogContentText>
              <T>This permanently removes</T> <strong>{deleteTarget?.nameEn}</strong>{' '}
              ({deleteTarget ? `no ${deleteTarget.companyNo}` : ''}<T>) from the company master.</T>
            </DialogContentText>
            <DialogContentText>
              <T>A company still linked to items cannot be deleted - mark it inactive instead so those
              items keep their manufacturer reference.</T>
            </DialogContentText>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDeleteTarget(null)}><T>Cancel</T></Button>
          <Button color="error" variant="contained" onClick={confirmDelete}><T>Delete Company</T></Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
