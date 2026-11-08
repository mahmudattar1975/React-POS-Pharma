// Wasfaty / NUPCO item mapping.
//
// This is the bridge between the local catalogue and NUPCO's approved Wasfaty item list. It is
// deliberately a separate screen from the Item Master: mapping is bulk pharmacy data (hundreds of
// rows) and needs its own coverage counts, search and immediate duplicate feedback. The same rules
// live in utils/wasfaty.ts and are re-checked by catalogStore.setWasfatyMapping, so no caller can
// bypass them.
import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, FormControlLabel, InputAdornment, MenuItem, Paper, Stack, Switch, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import LocalPharmacyOutlinedIcon from '@mui/icons-material/LocalPharmacyOutlined';
import SearchIcon from '@mui/icons-material/Search';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { useCatalogStore } from '../../store/catalogStore';
import type { Item } from '../../types/catalog';
import {
  isValidNupcoCode, nupcoCodeConflictMessage, wasfatyCoverage,
} from '../../utils/wasfaty';
import { itemNumberOf } from '../../utils/itemMaster';
import WasfatyImportDialog from './WasfatyImportDialog';
import WasfatyMappingHistory from './WasfatyMappingHistory';

type Filter = 'all' | 'mapped' | 'unmapped-eligible' | 'not-eligible';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All items' },
  { value: 'mapped', label: 'Mapped' },
  { value: 'unmapped-eligible', label: 'Eligible, not mapped' },
  { value: 'not-eligible', label: 'Not on Wasfaty list' },
];

export default function WasfatyMappingPage() {
  const items = useCatalogStore((s) => s.items);
  const setWasfatyMapping = useCatalogStore((s) => s.setWasfatyMapping);
  const applyWasfatyMappings = useCatalogStore((s) => s.applyWasfatyMappings);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [importOpen, setImportOpen] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  // Bumped after a bulk import so every row remounts with the newly stored mapping. Manual saves
  // do not bump it, so a row keeps its own "Saved" flash.
  const [generation, setGeneration] = useState(0);

  const coverage = useMemo(() => wasfatyCoverage(items), [items]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((item) => {
        if (filter === 'mapped' && !item.nupcoCode) return false;
        if (filter === 'unmapped-eligible' && !(item.wasfatyEligible && !item.nupcoCode)) return false;
        if (filter === 'not-eligible' && item.wasfatyEligible) return false;
        if (!q) return true;
        return [item.nameEn, item.nameAr, item.nupcoCode ?? '', item.barcode, String(itemNumberOf(item) ?? '')]
          .some((value) => value.toLowerCase().includes(q));
      })
      .sort((a, b) => a.nameEn.localeCompare(b.nameEn));
  }, [items, filter, search]);

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
        <Chip size="small" variant="outlined" icon={<LocalPharmacyOutlinedIcon />} label={`${coverage.total} active items`} />
        <Chip size="small" variant="outlined" color="success" label={`${coverage.mapped} mapped`} />
        <Chip size="small" variant="outlined" color="info" label={`${coverage.eligible} on the Wasfaty list`} />
        <Chip
          size="small"
          variant={coverage.unmappedEligible > 0 ? 'filled' : 'outlined'}
          color={coverage.unmappedEligible > 0 ? 'warning' : 'default'}
          label={`${coverage.unmappedEligible} need a NUPCO code`}
        />
        <Chip size="small" variant="outlined" color="primary" label={`${coverage.percent}% of active catalogue mapped`} />
        <Box sx={{ flexGrow: 1 }} />
        <Button
          size="small"
          variant="outlined"
          startIcon={<UploadFileIcon />}
          onClick={() => setImportOpen(true)}
        >
          Import NUPCO list
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
        A NUPCO code is 13 digits and belongs to exactly one local item. A covered line is invoiced at
        the approved price and settled by the Wasfaty tender; an eligible item without a code is
        blocked at checkout instead of being charged to the patient.
      </Typography>

      {importedCount > 0 && (
        <Alert severity="success" onClose={() => setImportedCount(0)} sx={{ mb: 2 }}>
          {importedCount} item(s) mapped from the NUPCO list.
        </Alert>
      )}

      {coverage.unmappedEligible > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {coverage.unmappedEligible} item(s) are marked as Wasfaty-eligible but have no NUPCO code.
          A Wasfaty basket containing them cannot be completed until they are mapped.
        </Alert>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField
          fullWidth
          size="small"
          label="Search item, item no, barcode or NUPCO code"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{
            input: { startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> },
          }}
        />
        <TextField
          select
          size="small"
          label="Show"
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          sx={{ minWidth: 210 }}
        >
          {FILTERS.map((option) => (
            <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
          ))}
        </TextField>
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Item</TableCell>
              <TableCell>NUPCO code</TableCell>
              <TableCell>NUPCO-approved price</TableCell>
              <TableCell align="center">On Wasfaty list</TableCell>
              <TableCell align="right">Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                    No items match this view.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {rows.map((item) => (
              <MappingRow
                // Re-mount after a bulk import so the local inputs cannot keep showing the
                // pre-import value. A manual save leaves the generation alone.
                key={`${item.id}:${generation}`}
                item={item}
                items={items}
                onSave={setWasfatyMapping}
              />
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <WasfatyMappingHistory />

      <WasfatyImportDialog
        open={importOpen}
        items={items}
        onClose={() => setImportOpen(false)}
        onApply={(updates) => {
          applyWasfatyMappings(updates, 'import');
          setImportedCount(updates.length);
          setGeneration((value) => value + 1);
          setImportOpen(false);
        }}
      />
    </Box>
  );
}

function MappingRow({
  item,
  items,
  onSave,
}: {
  item: Item;
  items: Item[];
  onSave: (itemId: string, input: { nupcoCode?: string; wasfatyPrice?: number; wasfatyEligible?: boolean }) => void;
}) {
  const [code, setCode] = useState(item.nupcoCode ?? '');
  const [price, setPrice] = useState(item.wasfatyPrice === undefined ? '' : String(item.wasfatyPrice));
  const [eligible, setEligible] = useState(item.wasfatyEligible === true || !!item.nupcoCode);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const trimmed = code.replace(/[\s-]/g, '');
  const shapeError = trimmed !== '' && !isValidNupcoCode(trimmed) ? 'A NUPCO code is 13 digits.' : undefined;
  const conflict = !shapeError && trimmed !== '' ? nupcoCodeConflictMessage(items, trimmed, item.id) : undefined;
  const priceError =
    price.trim() !== '' && (!Number.isFinite(Number(price)) || Number(price) < 0)
      ? 'Enter 0 or more, or leave blank.'
      : undefined;
  const rowError = error ?? shapeError ?? conflict ?? priceError;
  const dirty =
    trimmed !== (item.nupcoCode ?? '') ||
    price !== (item.wasfatyPrice === undefined ? '' : String(item.wasfatyPrice)) ||
    eligible !== (item.wasfatyEligible === true || !!item.nupcoCode);

  function save() {
    setError(null);
    setSaved(false);
    if (rowError) return;
    try {
      onSave(item.id, {
        nupcoCode: trimmed === '' ? undefined : trimmed,
        wasfatyPrice: price.trim() === '' ? undefined : Number(price),
        wasfatyEligible: eligible,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <TableRow hover>
      <TableCell sx={{ minWidth: 260 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{item.nameEn}</Typography>
        <Typography variant="caption" color="text.secondary">
          #{itemNumberOf(item) ?? '—'} · {item.nameAr || '—'} · {item.barcode}
        </Typography>
      </TableCell>
      <TableCell sx={{ minWidth: 180 }}>
        <TextField
          size="small"
          value={code}
          onChange={(e) => { setCode(e.target.value); setError(null); }}
          placeholder="13-digit NUPCO code"
          error={!!rowError}
          helperText={rowError ?? ' '}
          slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 18, style: { fontFamily: 'monospace' } } }}
          fullWidth
        />
      </TableCell>
      <TableCell sx={{ minWidth: 160 }}>
        <TextField
          size="small"
          type="number"
          value={price}
          onChange={(e) => { setPrice(e.target.value); setError(null); }}
          placeholder={item.basePrice.toFixed(2)}
          helperText="Blank = normal sale price"
          slotProps={{
            htmlInput: { min: 0, step: '0.01' },
            input: { endAdornment: <InputAdornment position="end">SAR</InputAdornment> },
          }}
          fullWidth
        />
      </TableCell>
      <TableCell align="center">
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={eligible}
              onChange={(e) => {
                setEligible(e.target.checked);
                // Keeping the two controls coherent avoids a save that would be refused: turning
                // eligibility off means the stale code has to go too.
                if (!e.target.checked) setCode('');
              }}
            />
          }
          label={<Typography variant="caption">{eligible ? 'Yes' : 'No'}</Typography>}
        />
      </TableCell>
      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
        {saved ? (
          <Chip size="small" color="success" label="Saved" />
        ) : item.nupcoCode ? (
          <Chip size="small" color="success" variant="outlined" label="Mapped" />
        ) : item.wasfatyEligible ? (
          <Chip size="small" color="warning" variant="outlined" label="Needs code" />
        ) : (
          <Chip size="small" variant="outlined" label="Private" />
        )}
        <Button size="small" onClick={save} disabled={!dirty || !!rowError} sx={{ ml: 1 }}>
          Save
        </Button>
      </TableCell>
    </TableRow>
  );
}
