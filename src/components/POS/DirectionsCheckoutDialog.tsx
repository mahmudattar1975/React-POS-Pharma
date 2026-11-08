// Post-payment directions screen: the step between "payment accepted" and "print the receipt".
//
// At the counter the cashier usually rings the sale up first and only then prepares the medicine
// bag, so directions are not always known while the cart is open. This screen exists for exactly
// that moment: the sale is already final and paid, and the pharmacist assigns the written
// instructions item by item before anything is printed. Every line is optional - Skip goes straight
// to the receipt - and the choices are written onto the recorded sale, so the separate direction
// label (printed after the invoice) shows exactly what was handed over.
//
// Only directions already linked to the item are offered. The Item Master curates the suitable
// ones per product, which is what keeps a tired pharmacist from picking a paediatric dose for an
// adult tablet at 11pm. A line whose item has no links points back to the Item Master instead of
// inventing a direction here.
import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl,
  InputLabel, MenuItem, Paper, Select, Stack, Typography,
} from '@mui/material';
import MedicationOutlinedIcon from '@mui/icons-material/MedicationOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import type { SaleHeader } from '../../types/sales';
import type { DosageInstruction, DosageSnapshot } from '../../types/dosage';
import { useCatalogStore } from '../../store/catalogStore';
import { useDosageStore } from '../../store/dosageStore';
import { buildDosageText, snapshotDosage } from '../../utils/dosages';

export interface DosagePatch {
  lineId: string;
  dosage?: DosageSnapshot;
}

interface Props {
  open: boolean;
  invoice: SaleHeader | null;
  onConfirm: (patches: DosagePatch[]) => void;
  onSkip: () => void;
}

export default function DirectionsCheckoutDialog({ open, invoice, onConfirm, onSkip }: Props) {
  const dosages = useDosageStore((s) => s.dosages);
  const itemById = useCatalogStore((s) => s.itemById);

  // Initialised once per sale (the caller remounts with a key): whatever was already chosen in the
  // cart is shown here for a final review, and nothing else is pre-selected. Directions are never
  // auto-applied - only the explicit "Use suggested" action below fills them in.
  const [selected, setSelected] = useState<Record<string, DosageSnapshot | undefined>>(() =>
    Object.fromEntries((invoice?.lines ?? []).map((line) => [line.id, line.dosage])),
  );

  const byId = useMemo(() => new Map(dosages.map((d) => [d.id, d])), [dosages]);

  function linkedFor(itemId: string): DosageInstruction[] {
    const item = itemById(itemId);
    return (item?.dosageIds ?? [])
      .map((id) => byId.get(id))
      .filter((d): d is DosageInstruction => !!d && d.isActive !== false)
      .sort((a, b) => {
        const aSuggested = a.id === item?.defaultDosageId ? 0 : 1;
        const bSuggested = b.id === item?.defaultDosageId ? 0 : 1;
        return aSuggested - bSuggested || a.code.localeCompare(b.code);
      });
  }

  function suggestedSnapshotFor(itemId: string): DosageSnapshot | undefined {
    const item = itemById(itemId);
    const suggestion = item?.defaultDosageId ? byId.get(item.defaultDosageId) : undefined;
    if (!suggestion || suggestion.isActive === false) return undefined;
    return snapshotDosage(suggestion);
  }

  const suggestedCount = invoice
    ? invoice.lines.filter((line) => !selected[line.id] && suggestedSnapshotFor(line.itemId)).length
    : 0;

  function pick(lineId: string, dosageId: string) {
    const dosage = dosageId ? byId.get(dosageId) : undefined;
    setSelected((current) => ({
      ...current,
      [lineId]: dosage ? snapshotDosage(dosage) : undefined,
    }));
  }

  function useSuggested() {
    if (!invoice) return;
    setSelected((current) => {
      const next = { ...current };
      for (const line of invoice.lines) {
        // Explicit choices win; the bulk action only fills lines the pharmacist left blank.
        if (next[line.id]) continue;
        const suggestion = suggestedSnapshotFor(line.itemId);
        if (suggestion) next[line.id] = suggestion;
      }
      return next;
    });
  }

  function confirm() {
    if (!invoice) return;
    onConfirm(invoice.lines.map((line) => ({ lineId: line.id, dosage: selected[line.id] })));
  }

  if (!invoice) return null;
  const chosenCount = invoice.lines.filter((line) => selected[line.id]).length;

  return (
    <Dialog open={open} onClose={onSkip} fullWidth maxWidth="md">
      <DialogTitle component="div" sx={{ pb: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
          <Box
            sx={{
              width: 40, height: 40, flexShrink: 0, borderRadius: 2, display: 'grid', placeItems: 'center',
              bgcolor: 'rgba(21, 101, 192, 0.1)', color: 'primary.main',
            }}
          >
            <MedicationOutlinedIcon />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
              Directions for this sale
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {invoice.invoiceNo} · {invoice.customerNameEn || invoice.customerNameAr} · payment complete
            </Typography>
          </Box>
        </Stack>
      </DialogTitle>

      <DialogContent sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
        <Stack spacing={1.5}>
          <Alert
            severity="success"
            icon={<CheckCircleOutlineIcon />}
            sx={{ '& .MuiAlert-message': { width: '100%' } }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Sale completed. Add the patient&apos;s directions before printing.
            </Typography>
            <Typography variant="caption">
              Optional — the separate direction label prints after the sales invoice.
            </Typography>
          </Alert>

          {invoice.lines.map((line) => {
            const linked = linkedFor(line.itemId);
            const chosen = selected[line.id];
            const suggested = line.itemId ? itemById(line.itemId)?.defaultDosageId : undefined;
            return (
              <Paper key={line.id} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' } }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {line.itemNameEn}
                      </Typography>
                      <Chip size="small" variant="outlined" label={`Qty ${line.qty}${line.unit ? ` ${line.unit}` : ''}`} />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {line.itemNameAr} · batch {line.batchNo}
                    </Typography>
                  </Box>

                  {linked.length === 0 ? (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ maxWidth: { md: 320 }, flexShrink: 0 }}
                    >
                      No instructions linked to this item. Link suitable ones in Inventory → Dosage
                      Instructions; the sale does not need any.
                    </Typography>
                  ) : (
                    <FormControl size="small" sx={{ minWidth: { md: 330 }, maxWidth: { md: 420 }, flexShrink: 0 }}>
                      <InputLabel id={`dosage-line-${line.id}`} shrink>
                        Directions
                      </InputLabel>
                      <Select
                        labelId={`dosage-line-${line.id}`}
                        label="Directions"
                        displayEmpty
                        notched
                        value={chosen?.dosageId ?? ''}
                        onChange={(e) => pick(line.id, e.target.value)}
                        renderValue={(value) => {
                          const id = value as string;
                          if (!id) {
                            return (
                              <Typography variant="body2" color="text.secondary">
                                No written directions
                              </Typography>
                            );
                          }
                          // The dropdown shows the whole sentence; the closed field shows the
                          // stable code, with the full bilingual text previewed underneath. That
                          // keeps a long direction from being clipped at the field's edge.
                          const fromLibrary = byId.get(id);
                          return (
                            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                {fromLibrary?.code ?? chosen?.code ?? id}
                              </Typography>
                              {id === suggested && (
                                <Chip size="small" color="primary" label="Suggested" sx={{ height: 20 }} />
                              )}
                            </Stack>
                          );
                        }}
                      >
                        <MenuItem value="">
                          <Typography variant="body2" color="text.secondary">
                            No written directions
                          </Typography>
                        </MenuItem>
                        {linked.map((dosage) => (
                          <MenuItem key={dosage.id} value={dosage.id} sx={{ whiteSpace: 'normal', py: 1 }}>
                            <Box>
                              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                  {dosage.code}
                                </Typography>
                                {dosage.id === suggested && (
                                  <Chip size="small" color="primary" label="Suggested" sx={{ height: 20 }} />
                                )}
                              </Stack>
                              <Typography variant="caption" color="text.secondary">
                                {buildDosageText(dosage).textEn}
                              </Typography>
                            </Box>
                          </MenuItem>
                        ))}
                        {/* A snapshot already on the line can reference a library row that has
                            since been deleted; keep it selectable rather than silently dropping
                            the directions that were already dispensed. */}
                        {chosen && !linked.some((dosage) => dosage.id === chosen.dosageId) && (
                          <MenuItem value={chosen.dosageId} sx={{ whiteSpace: 'normal', py: 1 }}>
                            <Box>
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                {chosen.code} · current
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {chosen.textEn}
                              </Typography>
                            </Box>
                          </MenuItem>
                        )}
                      </Select>
                    </FormControl>
                  )}
                </Stack>

                {chosen && (
                  <Box
                    sx={{
                      mt: 1.25, p: 1, borderRadius: 1.5, bgcolor: 'action.hover',
                      borderLeft: '3px solid', borderColor: 'primary.main',
                    }}
                  >
                    <Typography variant="caption" sx={{ display: 'block', fontWeight: 600 }}>
                      {chosen.textEn}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      dir="rtl"
                      sx={{ display: 'block', textAlign: 'left' }}
                    >
                      {chosen.textAr}
                    </Typography>
                  </Box>
                )}
              </Paper>
            );
          })}

          <Typography variant="caption" color="text.secondary">
            The invoice is already recorded and paid; this screen only adds patient guidance. Nothing
            here changes prices, VAT, payment or the ZATCA document.
          </Typography>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: { xs: 2, sm: 3 }, py: 1.75, gap: 1, flexWrap: 'wrap', borderTop: '1px solid', borderColor: 'divider' }}>
        <Button
          onClick={useSuggested}
          disabled={suggestedCount === 0}
          sx={{ mr: 'auto' }}
        >
          Use suggested ({suggestedCount})
        </Button>
        <Button color="inherit" onClick={onSkip}>
          Skip
        </Button>
        <Button variant="contained" onClick={confirm}>
          {chosenCount > 0 ? 'Continue to receipt' : 'Continue without directions'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
