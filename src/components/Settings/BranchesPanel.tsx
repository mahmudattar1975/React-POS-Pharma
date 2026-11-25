import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControl, FormControlLabel, FormHelperText, InputLabel, MenuItem, Paper, Select,
  Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { createBranch, getBranches, updateBranch, type BranchInput } from '../../api/branchApi';
import { useSettingsStore } from '../../store/settingsStore';
import { useCostCenterStore } from '../../store/costCenterStore';
import type { Branch } from '../../types/branch';

import { T, useT } from '../../i18n';
const EMPTY_FORM: BranchInput = {
  code: '',
  nameEn: '',
  nameAr: '',
  address: '',
  phone: '',
  vatNumber: '',
  crNumber: '',
  glnNo: '',
  costCenterId: '',
  isActive: true,
};

interface Errors {
  code?: string;
  nameEn?: string;
  nameAr?: string;
  vatNumber?: string;
  glnNo?: string;
}

function validate(form: BranchInput): Errors {
  const errors: Errors = {};
  if (!/^[A-Z0-9]{1,8}$/.test(form.code.trim().toUpperCase())) errors.code = '1-8 letters or digits, no spaces.';
  if (!form.nameEn.trim()) errors.nameEn = 'Required.';
  if (!form.nameAr.trim()) errors.nameAr = 'Required.';
  const vat = (form.vatNumber ?? '').replace(/\D/g, '');
  if (vat && vat.length !== 15) errors.vatNumber = 'VAT number must be exactly 15 digits.';
  const gln = (form.glnNo ?? '').replace(/\D/g, '');
  if (gln && gln.length !== 13) errors.glnNo = 'GLN must be exactly 13 digits.';
  return errors;
}

function toForm(branch: Branch): BranchInput {
  return {
    code: branch.code,
    nameEn: branch.nameEn,
    nameAr: branch.nameAr,
    address: branch.address ?? '',
    phone: branch.phone ?? '',
    vatNumber: branch.vatNumber ?? '',
    crNumber: branch.crNumber ?? '',
    glnNo: branch.glnNo ?? '',
    costCenterId: branch.costCenterId ?? '',
    isActive: branch.isActive,
  };
}

// The SHARED branch master. Adding/editing a branch here does not change which branch THIS
// terminal is - that is server/config/branch.json (see config/README.md). Deliberate: a cashier
// must never be able to redirect a sale to another pharmacy from the till.
export default function BranchesPanel() {
  const tr = useT();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [source, setSource] = useState<'database' | 'fallback'>('database');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [form, setForm] = useState<BranchInput>(EMPTY_FORM);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const branchId = useSettingsStore((s) => s.settings.branchId);
  const centers = useCostCenterStore((s) => s.centers);
  const branchCenters = useMemo(() => centers.filter((c) => c.kind === 'branch' && c.isActive), [centers]);
  const errors = validate(form);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getBranches();
      setBranches(result.branches);
      setSource(result.source);
      setLoadError(result.source === 'fallback' ? 'Branch list came from the offline fallback; changes cannot be saved until PharmaDB is reachable.' : null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function patch<K extends keyof BranchInput>(key: K, value: BranchInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setSaveError(null);
    setDialogOpen(true);
  }

  function openEdit(branch: Branch) {
    setEditing(branch);
    setForm(toForm(branch));
    setSaveError(null);
    setDialogOpen(true);
  }

  async function save() {
    if (Object.keys(errors).length) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload: BranchInput = {
        ...form,
        code: form.code.trim().toUpperCase(),
        nameEn: form.nameEn.trim(),
        nameAr: form.nameAr.trim(),
      };
      if (editing) await updateBranch(editing.id, payload);
      else await createBranch(payload);
      setDialogOpen(false);
      await load();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const digitsOnly = (value: string, max: number) => value.replace(/\D/g, '').slice(0, max);

  return (
    <Paper variant="outlined" sx={{ p: 3, mt: 3 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 1 }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}><T>Branches</T></Typography>
          <Typography variant="body2" color="text.secondary">
            <T>Shared across all pharmacies. This terminal is</T>{' '}
            <strong>{branches.find((b) => b.id === branchId)?.code ?? branchId ?? tr('not set')}</strong><T>.
            Change this PC's branch in</T> <code><T>server/config/branch.json</T></code><T>, not here.</T>
          </Typography>
        </Box>
        <Button variant="contained" onClick={openCreate}><T>Add Branch</T></Button>
      </Stack>

      {loadError && <Alert severity="warning" sx={{ mb: 2 }}>{loadError}</Alert>}
      {!loadError && source === 'fallback' && (
        <Alert severity="info" sx={{ mb: 2 }}><T>Showing the built-in branch list (offline fallback).</T></Alert>
      )}

      {loading ? (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 2 }}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary"><T>Loading branches…</T></Typography>
        </Stack>
      ) : (
        <Table size="small" aria-label={tr('Branches')}>
          <TableHead>
            <TableRow>
              <TableCell><T>Code</T></TableCell>
              <TableCell><T>Name</T></TableCell>
              <TableCell><T>VAT / GLN</T></TableCell>
              <TableCell><T>Cost center</T></TableCell>
              <TableCell><T>Status</T></TableCell>
              <TableCell align="right"><T>Action</T></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {branches.map((branch) => (
              <TableRow key={branch.id}>
                <TableCell>
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{branch.code}</Typography>
                    {branch.id === branchId && <Chip label={tr('This terminal')} size="small" color="primary" />}
                  </Stack>
                </TableCell>
                <TableCell>
                  {branch.nameEn}
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} dir="rtl">{branch.nameAr}</Typography>
                </TableCell>
                <TableCell>{branch.vatNumber || '—'} / {branch.glnNo || '—'}</TableCell>
                <TableCell>{centers.find((c) => c.id === branch.costCenterId)?.nameEn ?? '—'}</TableCell>
                <TableCell>
                  <Chip label={branch.isActive ? 'Active' : 'Inactive'} size="small" color={branch.isActive ? 'success' : 'default'} />
                </TableCell>
                <TableCell align="right">
                  <Button size="small" onClick={() => openEdit(branch)}><T>Edit</T></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editing ? `${tr('Edit branch')} ${editing.code}` : tr('Add branch')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label={tr('Code (invoice prefix)')}
              value={form.code}
              onChange={(e) => patch('code', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
              error={!!errors.code}
              helperText={errors.code ?? 'Short and unique, e.g. RIY. Cannot change once documents exist.'}
              required
              fullWidth
            />
            <TextField label={tr('Name (English)')} value={form.nameEn} onChange={(e) => patch('nameEn', e.target.value)} error={!!errors.nameEn} helperText={errors.nameEn} required fullWidth />
            <TextField label={tr('Name (Arabic)')} value={form.nameAr} onChange={(e) => patch('nameAr', e.target.value)} error={!!errors.nameAr} helperText={errors.nameAr} dir="rtl" required fullWidth />
            <TextField label={tr('Address')} value={form.address ?? ''} onChange={(e) => patch('address', e.target.value)} fullWidth />
            <TextField label={tr('Phone')} value={form.phone ?? ''} onChange={(e) => patch('phone', e.target.value)} fullWidth />
            <TextField
              label={tr('VAT number (optional)')}
              value={form.vatNumber ?? ''}
              onChange={(e) => patch('vatNumber', digitsOnly(e.target.value, 15))}
              error={!!errors.vatNumber}
              helperText={errors.vatNumber ?? '15 digits when present.'}
              fullWidth
            />
            <TextField label={tr('CR number (optional)')} value={form.crNumber ?? ''} onChange={(e) => patch('crNumber', e.target.value)} fullWidth />
            <TextField
              label={tr('GLN (optional)')}
              value={form.glnNo ?? ''}
              onChange={(e) => patch('glnNo', digitsOnly(e.target.value, 13))}
              error={!!errors.glnNo}
              helperText={errors.glnNo ?? '13-digit GS1 location number.'}
              fullWidth
            />
            <FormControl fullWidth>
              <InputLabel id="branch-cost-center-label"><T>Branch cost center</T></InputLabel>
              <Select
                labelId="branch-cost-center-label"
                label={tr('Branch cost center')}
                value={form.costCenterId ?? ''}
                onChange={(e) => patch('costCenterId', e.target.value)}
              >
                <MenuItem value=""><T>None</T></MenuItem>
                {branchCenters.map((center) => (
                  <MenuItem key={center.id} value={center.id}>{center.nameEn}</MenuItem>
                ))}
              </Select>
              <FormHelperText><T>Links this branch to branch-level expense and revenue reporting.</T></FormHelperText>
            </FormControl>
            <FormControlLabel
              control={<Checkbox checked={form.isActive} onChange={(e) => patch('isActive', e.target.checked)} />}
              label={tr('Active (can be selected as a terminal branch)')}
            />
            {saveError && <Alert severity="error">{saveError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialogOpen(false)}><T>Cancel</T></Button>
          <Button variant="contained" onClick={() => void save()} disabled={saving || Object.keys(errors).length > 0}>
            {saving ? tr('Saving…') : tr('Save branch')}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
