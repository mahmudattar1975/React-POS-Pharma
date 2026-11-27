// Second-level masters screen inside Item Master. The four tables behind the item form (Categories,
// Units, Brands, Locations) are managed here: add, edit and activate/disable. Delete is deliberately
// absent because existing items refer to these rows by id or label. Every write goes through the SQL
// master API first and only updates the offline copy after SQL accepts it, so a till cannot invent a
// code that another branch will never see.
import { useMemo, useState, type ReactElement } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl,
  FormHelperText, IconButton, InputLabel, MenuItem, Paper, Select, Stack, Switch, Tab, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tabs, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import SearchIcon from '@mui/icons-material/Search';
import CategoryOutlinedIcon from '@mui/icons-material/CategoryOutlined';
import StraightenOutlinedIcon from '@mui/icons-material/StraightenOutlined';
import LocalPharmacyOutlinedIcon from '@mui/icons-material/LocalPharmacyOutlined';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import {
  createCategory, updateCategory,
} from '../../api/itemCategoryApi';
import { createUnit, updateUnit } from '../../api/unitApi';
import { createLocation, updateLocation } from '../../api/locationApi';
import { createBrand, updateBrand } from '../../api/brandApi';
import type { MasterWritePayload } from '../../api/masterRequest';
import { useItemCategoryStore } from '../../store/itemCategoryStore';
import { useUnitStore } from '../../store/unitStore';
import { useBrandStore } from '../../store/brandStore';
import { useLocationStore } from '../../store/locationStore';
import { T, useT } from '../../i18n';

type MasterKind = 'categories' | 'units' | 'brands' | 'locations';
type StatusFilter = 'all' | 'active' | 'inactive';

interface MasterRow {
  id: number;
  code: string;
  nameEn: string;
  nameAr: string;
  isActive: boolean;
  parentCategoryId?: number | null;
}

interface Draft {
  code: string;
  nameEn: string;
  nameAr: string;
  isActive: boolean;
  parentCategoryId: string;
}

const EMPTY_DRAFT: Draft = { code: '', nameEn: '', nameAr: '', isActive: true, parentCategoryId: '' };

const KINDS: Array<{
  key: MasterKind;
  label: string;
  singular: string;
  icon: ReactElement;
  color: string;
  count: string;
}> = [
  { key: 'categories', label: 'Categories', singular: 'Category', icon: <CategoryOutlinedIcon fontSize="small" />, color: '#1565c0', count: 'categories' },
  { key: 'units', label: 'Units', singular: 'Unit', icon: <StraightenOutlinedIcon fontSize="small" />, color: '#00695c', count: 'units' },
  { key: 'brands', label: 'Brands', singular: 'Brand', icon: <LocalPharmacyOutlinedIcon fontSize="small" />, color: '#7b1fa2', count: 'brands' },
  { key: 'locations', label: 'Locations', singular: 'Location', icon: <PlaceOutlinedIcon fontSize="small" />, color: '#7d5714', count: 'locations' },
];

export default function ItemMastersPage() {
  const tr = useT();
  const categories = useItemCategoryStore((s) => s.categories);
  const units = useUnitStore((s) => s.units);
  const brands = useBrandStore((s) => s.brands);
  const locations = useLocationStore((s) => s.locations);

  const [kind, setKind] = useState<MasterKind>('categories');
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dialog, setDialog] = useState<{ open: boolean; row: MasterRow | null }>({ open: false, row: null });
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = KINDS.find((entry) => entry.key === kind)!;
  const allRows = useMemo<MasterRow[]>(() => {
    switch (kind) {
      case 'categories':
        return categories.map((c) => ({
          id: c.categoryId, code: c.categoryCode, nameEn: c.nameEn, nameAr: c.nameAr,
          isActive: c.isActive !== false, parentCategoryId: c.parentCategoryId ?? null,
        }));
      case 'units':
        return units.map((u) => ({
          id: u.unitId, code: u.unitCode, nameEn: u.nameEn, nameAr: u.nameAr, isActive: u.isActive !== false,
        }));
      case 'brands':
        return brands.map((b) => ({
          id: b.brandId, code: b.brandCode, nameEn: b.nameEn, nameAr: b.nameAr, isActive: b.isActive !== false,
        }));
      case 'locations':
        return locations.map((l) => ({
          id: l.locationId, code: l.locationCode, nameEn: l.nameEn, nameAr: l.nameAr, isActive: l.isActive !== false,
        }));
    }
  }, [kind, categories, units, brands, locations]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return allRows
      .filter((row) => {
        if (statusFilter === 'active' && !row.isActive) return false;
        if (statusFilter === 'inactive' && row.isActive) return false;
        if (!q) return true;
        return [row.code, row.nameEn, row.nameAr].some((value) => value.toLowerCase().includes(q));
      })
      .sort((a, b) => a.id - b.id || a.nameEn.localeCompare(b.nameEn));
  }, [allRows, filter, statusFilter]);

  const activeCount = allRows.filter((row) => row.isActive).length;
  const parentLabel = (id: number | null | undefined) =>
    id ? categories.find((c) => c.categoryId === id)?.nameEn ?? `#${id}` : '—';

  function openCreate() {
    setError(null);
    setDraft(EMPTY_DRAFT);
    setDialog({ open: true, row: null });
  }

  function openEdit(row: MasterRow) {
    setError(null);
    setDraft({
      code: row.code,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      isActive: row.isActive,
      parentCategoryId: row.parentCategoryId ? String(row.parentCategoryId) : '',
    });
    setDialog({ open: true, row });
  }

  // SQL is authoritative: the offline store is updated only after the server accepts the row.
  async function persist(payload: MasterWritePayload, row: MasterRow | null): Promise<void> {
    switch (kind) {
      case 'categories': {
        const saved = row ? await updateCategory(row.id, payload) : await createCategory(payload);
        useItemCategoryStore.getState().upsertCategory(saved);
        break;
      }
      case 'units': {
        const saved = row ? await updateUnit(row.id, payload) : await createUnit(payload);
        useUnitStore.getState().upsertUnit(saved);
        break;
      }
      case 'brands': {
        const saved = row ? await updateBrand(row.id, payload) : await createBrand(payload);
        useBrandStore.getState().upsertBrand(saved);
        break;
      }
      case 'locations': {
        const saved = row ? await updateLocation(row.id, payload) : await createLocation(payload);
        useLocationStore.getState().upsertLocation(saved);
        break;
      }
    }
  }

  async function save() {
    if (!draft.nameEn.trim() || !draft.nameAr.trim()) {
      setError(tr('English name and Arabic name are both required.'));
      return;
    }
    setSaving(true);
    setError(null);
    const payload: MasterWritePayload = {
      code: draft.code.trim(),
      nameEn: draft.nameEn.trim(),
      nameAr: draft.nameAr.trim(),
      isActive: draft.isActive,
      ...(kind === 'categories'
        ? { parentCategoryId: draft.parentCategoryId ? Number(draft.parentCategoryId) : null }
        : {}),
    };
    try {
      await persist(payload, dialog.row);
      setDialog({ open: false, row: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(row: MasterRow) {
    setBusyId(row.id);
    setError(null);
    try {
      await persist({
        code: row.code,
        nameEn: row.nameEn,
        nameAr: row.nameAr,
        isActive: !row.isActive,
        ...(kind === 'categories' ? { parentCategoryId: row.parentCategoryId ?? null } : {}),
      }, row);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  const columns = kind === 'categories' ? 6 : 5;

  return (
    <Box sx={{ mt: 1 }}>
      <Tabs
        value={kind}
        onChange={(_, value: MasterKind) => { setKind(value); setFilter(''); setStatusFilter('all'); setError(null); }}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
      >
        {KINDS.map((entry) => (
          <Tab
            key={entry.key}
            value={entry.key}
            icon={entry.icon}
            iconPosition="start"
            label={`${tr(entry.label)} (${entry.key === 'categories' ? categories.length : entry.key === 'units' ? units.length : entry.key === 'brands' ? brands.length : locations.length})`}
            aria-label={tr(entry.label)}
          />
        ))}
      </Tabs>

      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, gap: 2 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip size="small" variant="outlined" label={`${allRows.length} ${tr(active.count)}`} />
          <Chip size="small" variant="outlined" color="success" label={`${activeCount} ${tr('active')}`} />
        </Stack>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} sx={{ flexShrink: 0 }}>
          {tr(`Add ${active.singular}`)}
        </Button>
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
        <T>Codes are assigned once by the SQL master and stay read-only on edit. Deactivate a row instead of deleting it, so existing items keep resolving.</T>
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField
          fullWidth
          size="small"
          label={tr(`Search ${active.label.toLowerCase()} code / English / Arabic`)}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          slotProps={{ input: { startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> } }}
        />
        <Select
          size="small"
          inputProps={{ 'aria-label': `Filter ${active.label}` }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          sx={{ minWidth: 170 }}
        >
          <MenuItem value="all"><T>All</T></MenuItem>
          <MenuItem value="active"><T>Active only</T></MenuItem>
          <MenuItem value="inactive"><T>Discontinued only</T></MenuItem>
        </Select>
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell><T>Code</T></TableCell>
              <TableCell><T>English name</T></TableCell>
              <TableCell><T>Arabic name</T></TableCell>
              {kind === 'categories' && <TableCell><T>Parent category</T></TableCell>}
              <TableCell align="center"><T>Status</T></TableCell>
              <TableCell align="right"><T>Actions</T></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={columns}>
                  <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                    <T>No master rows match this search.</T>
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => (
              <TableRow key={`${kind}-${row.id}`} hover>
                <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{row.code}</TableCell>
                <TableCell>{row.nameEn}</TableCell>
                <TableCell dir="rtl" sx={{ textAlign: 'right' }}>{row.nameAr}</TableCell>
                {kind === 'categories' && <TableCell>{parentLabel(row.parentCategoryId)}</TableCell>}
                <TableCell align="center">
                  <Switch
                    checked={row.isActive}
                    disabled={busyId === row.id}
                    onChange={() => void toggle(row)}
                    slotProps={{ input: { 'aria-label': `${row.isActive ? tr('Disable') : tr('Activate')} ${row.nameEn}` } }}
                  />
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <IconButton
                    size="small"
                    aria-label={`${tr('Edit')} ${row.nameEn}`}
                    onClick={() => openEdit(row)}
                  >
                    <EditOutlinedIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={dialog.open} onClose={() => setDialog({ open: false, row: null })} fullWidth maxWidth="sm">
        <DialogTitle>
          {dialog.row ? `${tr('Edit')} ${active.singular}` : `${tr('Add')} ${active.singular}`}
        </DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField
              label={tr('Code')}
              value={draft.code}
              onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
              size="small"
              disabled={!!dialog.row}
              helperText={dialog.row
                ? tr('Code is stable — it cannot be changed after the row is created.')
                : tr('Leave blank to assign the next code automatically.')}
              fullWidth
            />
            <TextField
              label={tr('English name')}
              value={draft.nameEn}
              onChange={(e) => setDraft((d) => ({ ...d, nameEn: e.target.value }))}
              size="small"
              required
              fullWidth
            />
            <TextField
              label={tr('Arabic name')}
              value={draft.nameAr}
              onChange={(e) => setDraft((d) => ({ ...d, nameAr: e.target.value }))}
              size="small"
              required
              fullWidth
              slotProps={{ htmlInput: { dir: 'rtl', style: { textAlign: 'right' } } }}
            />
            {kind === 'categories' && (
              <FormControl size="small" fullWidth>
                <InputLabel id="master-parent-category-label"><T>Parent category</T></InputLabel>
                <Select
                  labelId="master-parent-category-label"
                  label={tr('Parent category')}
                  value={draft.parentCategoryId}
                  onChange={(e) => setDraft((d) => ({ ...d, parentCategoryId: String(e.target.value ?? '') }))}
                >
                  <MenuItem value=""><em><T>Top level (no parent)</T></em></MenuItem>
                  {categories
                    .filter((c) => c.categoryId !== dialog.row?.id)
                    .map((c) => (
                      <MenuItem key={c.categoryId} value={String(c.categoryId)}>
                        #{c.categoryId} · {c.nameEn}
                      </MenuItem>
                    ))}
                </Select>
                <FormHelperText><T>Main → subcategory → item; leave empty for a main category.</T></FormHelperText>
              </FormControl>
            )}
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Switch
                checked={draft.isActive}
                onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))}
                slotProps={{ input: { 'aria-label': 'Active master row' } }}
              />
              <Typography variant="body2"><T>Active — available in the Item Master dropdowns</T></Typography>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDialog({ open: false, row: null })} disabled={saving}><T>Cancel</T></Button>
          <Button variant="contained" onClick={() => void save()} disabled={saving}>
            {dialog.row ? tr('Save Changes') : tr('Add')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
