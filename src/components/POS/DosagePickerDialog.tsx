// Per-line directions picker at the till.
//
// The item master links the directions that suit the product; this dialog shows only those, with the
// item's suggested one first. Picking is ALWAYS optional and never gates checkout - some patients
// need no written directions, and the pharmacist can remove a selection just as easily.
//
// What is stored on the cart line is a snapshot (utils/dosages.ts snapshotDosage), not the id, so a
// later correction in the library cannot change what this patient was told.
import {
  Chip, Dialog, DialogContent, DialogTitle, List, ListItemButton, ListItemText, Stack, Typography,
} from '@mui/material';
import type { Item } from '../../types/catalog';
import type { DosageSnapshot } from '../../types/dosage';
import { useDosageStore } from '../../store/dosageStore';
import { buildDosageText, snapshotDosage } from '../../utils/dosages';

interface Props {
  open: boolean;
  item: Item | null;
  selectedCode?: string;
  onPick: (dosage: DosageSnapshot | undefined) => void;
  onClose: () => void;
}

export default function DosagePickerDialog({ open, item, selectedCode, onPick, onClose }: Props) {
  const dosages = useDosageStore((s) => s.dosages);

  const linked = (item?.dosageIds ?? [])
    .map((id) => dosages.find((d) => d.id === id))
    .filter((d): d is NonNullable<typeof d> => !!d && d.isActive !== false)
    .sort((a, b) => {
      const aSuggested = a.id === item?.defaultDosageId ? 0 : 1;
      const bSuggested = b.id === item?.defaultDosageId ? 0 : 1;
      return aSuggested - bSuggested || a.code.localeCompare(b.code);
    });

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        Directions for use
        {item && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {item.nameEn}{item.nameAr ? ` · ${item.nameAr}` : ''}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <List disablePadding>
          <ListItemButton selected={!selectedCode} onClick={() => onPick(undefined)} divider>
            <ListItemText
              primary="No written directions"
              secondary="The sale still completes normally — directions are optional."
            />
          </ListItemButton>

          {linked.length === 0 && (
            <ListItemButton disabled divider>
              <ListItemText
                primary="No instructions linked to this item"
                secondary="Link suitable directions from Inventory → Dosage Instructions, or leave the item without any."
              />
            </ListItemButton>
          )}

          {linked.map((dosage) => {
            const text = buildDosageText(dosage);
            const suggested = dosage.id === item?.defaultDosageId;
            return (
              <ListItemButton
                key={dosage.id}
                selected={dosage.code === selectedCode}
                onClick={() => onPick(snapshotDosage(dosage))}
                divider
                sx={{ alignItems: 'flex-start', py: 1.25 }}
              >
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 0.25 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{text.textEn}</Typography>
                      <Chip size="small" variant="outlined" label={dosage.code} sx={{ fontFamily: 'monospace', height: 21 }} />
                      {suggested && <Chip size="small" color="primary" label="Suggested" sx={{ height: 21 }} />}
                    </Stack>
                  }
                  secondary={
                    <Typography variant="caption" color="text.secondary" dir="rtl" sx={{ display: 'block', textAlign: 'left' }}>
                      {text.textAr}
                    </Typography>
                  }
                />
              </ListItemButton>
            );
          })}
        </List>
      </DialogContent>
    </Dialog>
  );
}
