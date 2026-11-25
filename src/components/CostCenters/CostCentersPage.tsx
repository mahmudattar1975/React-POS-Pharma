// Cost Centers - the master page for the expense-accounting dimension (Phase A, see
// costcenter.md §7.4). Shows the parent/child tree with kind/status badges and each node's own
// vs rolled-up expense totals, plus a create-only "add center" form. Editing/deactivation of
// existing centers is intentionally NOT here yet: posted documents reference centers by id, and
// a careless rename/re-parent needs the review flow of a later phase (the SQL mirror's
// rowversion conflict handling, §7.2) - creating is always safe, so that's what Phase A ships.
import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, MenuItem, Paper, Select, Stack, TextField, Typography, Chip,
} from '@mui/material';
import type { CostCenter, CostCenterKind } from '../../types/costCenters';
import { useCostCenterStore } from '../../store/costCenterStore';
import { expenseTotals, orderedCenters, todayISO } from '../../utils/costCenters';
import { formatMoney } from '../../utils/format';

import { T, useT } from '../../i18n';
const KIND_LABEL: Record<CostCenterKind, string> = {
  branch: 'Branch',
  activity: 'Activity',
  overhead: 'Overhead',
};

const KIND_COLOR: Record<CostCenterKind, 'primary' | 'warning' | 'secondary'> = {
  branch: 'primary',
  activity: 'warning',
  overhead: 'secondary',
};

// One row of the tree, recursively rendering children one indent level in. Plain nested divs
// (not MUI TreeView) keep this dependency-free and print-friendly.
function CenterNode({ center, depth, totals, centers, onAddChild, onEditDrivers }: {
  center: CostCenter;
  depth: number;
  totals: Map<string, { direct: number; subtree: number; allocatable: number }>;
  centers: CostCenter[];
  onAddChild: (parentId: string) => void;
  onEditDrivers: (center: CostCenter) => void;
}) {
  const tr = useT();
  const t = totals.get(center.id);
  const children = centers.filter((c) => c.parentId === center.id);
  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          pl: depth * 3,
          py: 0.5,
          flexWrap: 'wrap',
        }}
      >
        <Box sx={{ minWidth: 260, flex: '0 1 auto' }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>{center.nameEn}</Typography>
          <Typography variant="caption" color="text.secondary" dir="rtl">{center.nameAr}</Typography>
        </Box>
        <Chip size="small" variant="outlined" label={center.code} sx={{ fontFamily: 'monospace' }} />
        <Chip size="small" color={KIND_COLOR[center.kind]} label={tr(KIND_LABEL[center.kind])} />
        {!center.isActive && <Chip size="small" color="default" label={tr('Inactive')} />}
        {!center.IsPostingAllowed && <Chip size="small" variant="outlined" label={tr('No posting')} />}
        <Box sx={{ flex: 1, minWidth: 180, textAlign: 'right' }}>
          <Typography variant="body2">
            <T>own SAR</T> {formatMoney(t?.direct ?? 0)}
            {tr("· rolled-up SAR")}
            <strong>{formatMoney(t?.subtree ?? 0)}</strong>
          </Typography>
          {(t?.allocatable ?? 0) > 0 && (
            <Typography variant="caption" color="text.secondary">
              <T>of which allocatable SAR</T> {formatMoney(t?.allocatable ?? 0)}
            </Typography>
          )}
        </Box>
        <Button size="small" variant="text" onClick={() => onAddChild(center.id)}>
          <T>Add child</T>
        </Button>
        {/* Drivers exist only on centres that RECEIVE allocations (§10.4) - an overhead pool is a
            source, so asking it for floor area or headcount would invite meaningless numbers. */}
        {center.kind !== 'overhead' && (
          <Button size="small" variant="text" onClick={() => onEditDrivers(center)}>
            <T>Drivers</T>
          </Button>
        )}
        {center.kind !== 'overhead' && (center.spaceSqm !== undefined || center.headcount !== undefined) && (
          <Typography variant="caption" color="text.secondary">
            {center.spaceSqm !== undefined ? `${center.spaceSqm} m²` : ''}
            {center.spaceSqm !== undefined && center.headcount !== undefined ? ' · ' : ''}
            {center.headcount !== undefined ? `${center.headcount} staff` : ''}
          </Typography>
        )}
      </Box>
      {children.map((c) => (
        <CenterNode
          key={c.id}
          center={c}
          depth={depth + 1}
          totals={totals}
          centers={centers}
          onAddChild={onAddChild}
          onEditDrivers={onEditDrivers}
        />
      ))}
    </Box>
  );
}

export default function CostCentersPage() {
  const tr = useT();
  const { centers, expenses, addCenter } = useCostCenterStore();
  // Drivers are saved through the store (which validates) rather than with addCenter, because
  // they are editable on existing centres - Phase A deliberately keeps structural edits out.
  const setDrivers = useCostCenterStore((s) => s.setDrivers);
  const [driversCenter, setDriversCenter] = useState<CostCenter | null>(null);

  const totals = useMemo(() => expenseTotals(centers, expenses), [centers, expenses]);
  // id -> center map for the parent picker's indent walkthrough (depthOf).
  const centerIndex = useMemo(() => new Map(centers.map((c) => [c.id, c])), [centers]);

  // ---- new-center form state (create-only; see the file header for why no edit/delete)
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [code, setCode] = useState('');
  const [parentId, setParentId] = useState<string>('');
  const [kind, setKind] = useState<CostCenterKind>('branch');
  const [IsPostingAllowed, setIsPostingAllowed] = useState(true);
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [effectiveTo, setEffectiveTo] = useState('');
  const [created, setCreated] = useState<CostCenter | null>(null);

  const formValid = !!nameEn.trim() && !!code.trim() && !!effectiveFrom;

  function submit() {
    if (!formValid) return;
    try {
      const c = addCenter({
        code: code.trim(),
        nameEn: nameEn.trim(),
        nameAr: nameAr.trim() || nameEn.trim(),
        parentId: parentId || undefined,
        kind,
        isActive: true,
        IsPostingAllowed,
        effectiveFrom,
        effectiveTo: effectiveTo || undefined,
      });
      setCreated(c);
      setFormError(null);
      // Reset to an empty form for the next center, like the page's other create flows.
      setNameEn('');
      setNameAr('');
      setCode('');
      setKind('branch');
      setParentId('');
      setIsPostingAllowed(true);
      setEffectiveFrom(todayISO());
      setEffectiveTo('');
      setFormError(null);
    } catch (err) {
      // assertParentValid's messages (self-parent / cycle / missing parent) are user-directed -
      // surface them verbatim, nothing was saved.
      setFormError(String(err instanceof Error ? err.message : err));
      setCreated(null);
    }
  }

  return (
    <Box sx={{ maxWidth: 980 }}>
      <Stack spacing={2}>
        {/* ---- tree */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>
            <T>Center tree (</T>{centers.length} <T>centers ·</T> {centers.filter((c) => c.isActive).length} <T>active)</T>
          </Typography>
          <Stack spacing={0}>
            {centers
              .filter((c) => c.parentId === undefined)
              .map((root) => (
                <CenterNode
                  key={root.id}
                  center={root}
                  depth={0}
                  totals={totals}
                  centers={centers}
                  onAddChild={(pid) => {
                    setParentId(pid);
                    setOpen(true);
                    setCreated(null);
                  }}
                  onEditDrivers={setDriversCenter}
                />
              ))}
          </Stack>
        </Paper>

        {/* ---- create form */}
        {open ? (
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}><T>Add Cost Center</T></Typography>
            <Stack spacing={2}>
              {formError && <Alert severity="error" onClose={() => setFormError(null)}>{formError}</Alert>}
              {created && (
                <Alert severity="success" onClose={() => setCreated(null)}>
                  {created.code} — {created.nameEn} <T>saved as a child of</T>{' '}
                  {created.parentId ? centers.find((c) => c.id === created.parentId)?.nameEn : tr("(root)")}.
                </Alert>
              )}
              <Stack direction="row" spacing={1.5}>
                <TextField
                  label={tr('Code')}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  size="small"
                  helperText={tr('Short accountant-facing code (BR004-OPS style) - not the hierarchy key.')}
                  fullWidth
                />
                <Select
                  labelId="parent-label"
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  displayEmpty
                  size="small"
                  sx={{ maxWidth: 320 }}
                >
                  <MenuItem value="">
                    <em><T>(root - no parent)</T></em>
                  </MenuItem>
                  {orderedCenters(centers).map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {'\u2003'.repeat(depthOf(c, centerIndex))}{c.code} — {c.nameEn}
                    </MenuItem>
                  ))}
                </Select>
              </Stack>
              <Stack direction="row" spacing={1.5}>
                <TextField label={tr('Name (English)')} value={nameEn} onChange={(e) => setNameEn(e.target.value)} size="small" fullWidth />
                <TextField label={tr('Name (Arabic - عربي, optional)')} value={nameAr} onChange={(e) => setNameAr(e.target.value)} size="small" dir="rtl" fullWidth />
              </Stack>
              <Stack direction="row" spacing={1.5}>
                <Select
                  labelId="kind-label"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as CostCenterKind)}
                  size="small"
                  sx={{ maxWidth: 240 }}
                >
                  <MenuItem value="branch"><T>Branch (earns revenue)</T></MenuItem>
                  <MenuItem value="activity"><T>Activity / service desk</T></MenuItem>
                  <MenuItem value="overhead"><T>Overhead / shared pool</T></MenuItem>
                </Select>
                <TextField
                  label={tr('Effective from')}
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  size="small"
                  slotProps={{ inputLabel: { shrink: true } }}
                  fullWidth
                />
                <TextField
                  label={tr('Effective to (optional)')}
                  type="date"
                  value={effectiveTo}
                  onChange={(e) => setEffectiveTo(e.target.value)}
                  size="small"
                  slotProps={{ inputLabel: { shrink: true } }}
                  fullWidth
                />
              </Stack>
              <FormControlLabel
                control={<Checkbox checked={IsPostingAllowed} onChange={(e) => setIsPostingAllowed(e.target.checked)} />}
                label={tr('Allow posting (new expenses/documents may be booked on this center)')}
              />
              <Button variant="contained" size="small" disabled={!formValid} onClick={submit} sx={{ alignSelf: 'flex-start' }}>
                <T>Save cost center</T>
              </Button>
            </Stack>
          </Paper>
        ) : (
          <Button variant="outlined" size="small" onClick={() => { setOpen(true); setParentId(''); }} sx={{ alignSelf: 'flex-start' }}>
            <T>Add cost center</T>
          </Button>
        )}
      </Stack>

      {driversCenter && (
        <DriversDialog center={driversCenter} onSave={setDrivers} onClose={() => setDriversCenter(null)} />
      )}
    </Box>
  );
}

// Allocation drivers editor (Phase B.1). Kept in a dialog rather than inline number cells so the
// tree stays a tree, and so the two values are saved together - Phase D reads them as a pair.
function DriversDialog({ center, onSave, onClose }: {
  center: CostCenter;
  onSave: (centerId: string, drivers: { spaceSqm?: number; headcount?: number }) => void;
  onClose: () => void;
}) {
  const tr = useT();
  const [space, setSpace] = useState(center.spaceSqm !== undefined ? String(center.spaceSqm) : '');
  const [staff, setStaff] = useState(center.headcount !== undefined ? String(center.headcount) : '');
  const [error, setError] = useState<string | null>(null);

  function save() {
    try {
      // Blank means "no value" (cleared), not zero - zero is a legitimate headcount for a kiosk.
      onSave(center.id, {
        spaceSqm: space.trim() === '' ? undefined : Number(space),
        headcount: staff.trim() === '' ? undefined : Number(staff),
      });
      onClose();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle><T>Allocation drivers —</T> {center.code}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
          <Typography variant="caption" color="text.secondary">
            <T>Used by the Phase-D allocation run when a shared pool is distributed on floor area or
            headcount. Informational until then.</T>
          </Typography>
          <TextField
            label={tr('Floor area (m²)')}
            type="number"
            value={space}
            onChange={(e) => setSpace(e.target.value)}
            size="small"
            fullWidth
          />
          <TextField
            label={tr('Headcount')}
            type="number"
            value={staff}
            onChange={(e) => setStaff(e.target.value)}
            size="small"
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose}><T>Cancel</T></Button>
        <Button size="small" variant="contained" onClick={save}><T>Save drivers</T></Button>
      </DialogActions>
    </Dialog>
  );
}

// Indent depth for the parent picker's flat-but-hierarchical menu (orderedCenters is DFS),
// walking parentId chains through a prebuilt id -> center lookup (no closures over a mutable
// cursor - TS/oxlint both flag that pattern when the variable may be undefined).
function depthOf(c: CostCenter, index: Map<string, CostCenter>): number {
  let depth = 0;
  let parentId = c.parentId;
  while (parentId !== undefined) {
    depth += 1;
    parentId = index.get(parentId)?.parentId;
  }
  return depth;
}
