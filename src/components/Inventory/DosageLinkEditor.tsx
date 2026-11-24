// Multi-select editor for an item's dosage instructions, embedded in the Item Master form.
//
// The link is by id into the shared DOS library, not a copy of the text: correcting a direction
// once updates every item that uses it. The owner can link as many directions as the product
// genuinely needs (a 5-day and a 3-day course, an adult and a paediatric version), and mark ONE as
// the suggestion the POS shows first. Marking it is optional, and the pharmacist still makes the
// final per-line choice at the till.
import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, FormControl, IconButton, InputLabel, MenuItem, Paper, Select, Stack,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import MedicationOutlinedIcon from '@mui/icons-material/MedicationOutlined';
import type { DosageInstructionInput } from '../../types/dosage';
import { useDosageStore } from '../../store/dosageStore';
import { buildDosageText } from '../../utils/dosages';
import DosageFormDialog from './DosageFormDialog';

interface Props {
  dosageIds: string[];
  defaultDosageId: string;
  onChange: (dosageIds: string[], defaultDosageId: string) => void;
}

export default function DosageLinkEditor({ dosageIds, defaultDosageId, onChange }: Props) {
  const dosages = useDosageStore((s) => s.dosages);
  const addDosage = useDosageStore((s) => s.addDosage);
  const [createOpen, setCreateOpen] = useState(false);

  const byId = useMemo(() => new Map(dosages.map((d) => [d.id, d])), [dosages]);
  const linked = dosageIds.map((id) => byId.get(id)).filter((d): d is NonNullable<typeof d> => !!d);
  const missingCount = dosageIds.length - linked.length;
  const available = useMemo(
    () =>
      dosages
        .filter((d) => d.isActive !== false && !dosageIds.includes(d.id))
        .sort((a, b) => a.code.localeCompare(b.code)),
    [dosages, dosageIds]
  );

  function addExisting(id: string) {
    if (!id) return;
    onChange([...dosageIds, id], defaultDosageId || id);
  }

  // Removing the suggested row promotes the next remaining direction (if any) so the POS keeps a
  // useful suggestion; removing the last row clears the default with it.
  function remove(id: string) {
    const remaining = dosageIds.filter((row) => row !== id);
    const nextDefault =
      defaultDosageId === id ? (remaining[0] ?? '') : defaultDosageId;
    onChange(remaining, nextDefault);
  }

  function toggleDefault(id: string) {
    onChange(dosageIds, defaultDosageId === id ? '' : id);
  }

  function create(input: DosageInstructionInput, isActive: boolean) {
    const created = addDosage(input, isActive);
    onChange([...dosageIds, created.id], defaultDosageId || created.id);
    setCreateOpen(false);
  }

  return (
    <Box>
      {linked.length === 0 && missingCount === 0 ? (
        <Paper
          variant="outlined"
          sx={{ p: 2, borderRadius: 2, borderStyle: 'dashed', textAlign: 'center', bgcolor: 'background.paper' }}
        >
          <MedicationOutlinedIcon sx={{ color: 'text.disabled', fontSize: 28 }} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            No directions linked yet. The POS will simply offer none for this item — linking is optional.
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={1}>
          {linked.map((dosage) => {
            const text = buildDosageText(dosage);
            const isDefault = dosage.id === defaultDosageId;
            return (
              <Paper
                key={dosage.id}
                variant="outlined"
                sx={(t) => ({
                  p: 1.25,
                  borderRadius: 2,
                  borderColor: isDefault ? t.palette.primary.main : 'divider',
                  bgcolor: isDefault ? 'rgba(21, 101, 192, 0.03)' : 'background.paper',
                })}
              >
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 0.5 }}>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={dosage.code}
                        sx={{ fontFamily: 'monospace', height: 22 }}
                      />
                      {dosage.isActive === false && <Chip size="small" label="Inactive" />}
                    </Stack>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {text.textEn}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" dir="rtl" sx={{ display: 'block', textAlign: 'left' }}>
                      {text.textAr}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexShrink: 0 }}>
                    <Chip
                      size="small"
                      clickable
                      icon={isDefault ? <StarIcon /> : <StarBorderIcon />}
                      label={isDefault ? 'Suggested' : 'Make suggested'}
                      color={isDefault ? 'primary' : 'default'}
                      variant={isDefault ? 'filled' : 'outlined'}
                      onClick={() => toggleDefault(dosage.id)}
                      title={isDefault ? 'Click to clear the suggestion' : 'Show this first at the POS'}
                    />
                    <IconButton
                      size="small"
                      title="Remove from this item"
                      aria-label={`Remove ${dosage.code} from this item`}
                      onClick={() => remove(dosage.id)}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                </Stack>
              </Paper>
            );
          })}
          {missingCount > 0 && (
            <Alert severity="warning">
              {missingCount} linked direction{missingCount === 1 ? ' has' : 's have'} been removed from
              the library. Remove the leftover link{missingCount === 1 ? '' : 's'} before saving.
            </Alert>
          )}
        </Stack>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1.5 }}>
        <FormControl size="small" sx={{ flex: 1 }}>
          {/* Shrunk explicitly: the select is always empty after a pick (displayEmpty), so MUI
              would otherwise leave the label sitting on top of the "Choose…" placeholder. */}
          <InputLabel id="dosage-link-select-label" shrink>Add a saved instruction</InputLabel>
          <Select
            labelId="dosage-link-select-label"
            label="Add a saved instruction"
            value=""
            onChange={(e) => addExisting(e.target.value)}
            displayEmpty
          >
            <MenuItem value="" disabled>
              {available.length === 0 ? 'Every active instruction is already linked' : 'Choose…'}
            </MenuItem>
            {available.map((dosage) => (
              <MenuItem key={dosage.id} value={dosage.id} sx={{ whiteSpace: 'normal', py: 1 }}>
                <Box>
                  <Typography variant="body2">{dosage.code} · {buildDosageText(dosage).textEn}</Typography>
                  <Typography variant="caption" color="text.secondary" dir="rtl" sx={{ display: 'block', textAlign: 'left' }}>
                    {buildDosageText(dosage).textAr}
                  </Typography>
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => setCreateOpen(true)}
          sx={{ flexShrink: 0, borderStyle: 'dashed' }}
        >
          New instruction
        </Button>
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        One reusable library row shared by every product. The pharmacist still chooses per sale line,
        and written directions are always optional.
      </Typography>

      {createOpen && (
        <DosageFormDialog
          open
          dosage={null}
          onSave={create}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </Box>
  );
}
