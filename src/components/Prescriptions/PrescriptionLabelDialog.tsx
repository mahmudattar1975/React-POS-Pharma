// Printable prescription label (represcription.md Phase 2): the sticker that goes on the box the
// patient takes home - patient, drug, bilingual directions, quantity, refills left, batch/expiry,
// dispense date, prescriber and the pharmacy's contact line.
//
// It shares the physical constraints of the existing directions label (components/POS/DosagePrintView):
// a 50mm thermal label is small, so the preview is rendered at true width and the @page height is
// measured from the real content right before printing. Everything it prints comes from frozen
// snapshots (utils/prescriptionLabel.ts), so a reprint months later is the label that was issued.
import { useEffect, useRef } from 'react';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Stack, Typography,
} from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import type { PrescriptionLabel } from '../../utils/prescriptionLabel';

// Same die-cut size as DosagePrintView; change both constants together if the counter's roll changes.
const LABEL_WIDTH_MM = 50;

interface Props {
  open: boolean;
  labels: PrescriptionLabel[];
  onClose: () => void;
  // Send straight to the printer (used when the label is the tail of the post-sale print run).
  autoPrint?: boolean;
  // One identity per print batch, so React StrictMode's double effect cannot print twice.
  batchKey?: string;
}

export default function PrescriptionLabelDialog({ open, labels, onClose, autoPrint = false, batchKey }: Props) {
  const printAreaRef = useRef<HTMLDivElement>(null);
  const pageSizeStyleRef = useRef<HTMLStyleElement>(null);
  const autoPrintedForRef = useRef<string | null>(null);

  function handlePrint() {
    const el = printAreaRef.current;
    const styleEl = pageSizeStyleRef.current;
    if (el && styleEl) {
      const heightMm = (el.scrollHeight / 96) * 25.4 + 2;
      styleEl.textContent = `@page { size: ${LABEL_WIDTH_MM}mm ${heightMm.toFixed(1)}mm; margin: 0; }`;
    }
    window.print();
  }

  useEffect(() => {
    if (!open || !autoPrint || labels.length === 0) return;
    const key = batchKey ?? labels[0].key;
    if (autoPrintedForRef.current === key) return;
    autoPrintedForRef.current = key;
    const timer = window.setTimeout(handlePrint, 250);
    return () => window.clearTimeout(timer);
    // handlePrint only reads refs and the current render's labels; keying on the batch is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoPrint, batchKey, labels.length]);

  if (labels.length === 0) return null;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #rx-label-print-area, #rx-label-print-area * { visibility: visible; }
          #rx-label-print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: ${LABEL_WIDTH_MM}mm;
            padding: 2mm;
            background: #fff;
            color: #000;
          }
        }
      `}</style>
      <style ref={pageSizeStyleRef} />
      <DialogTitle>
        Prescription label
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {LABEL_WIDTH_MM}mm label · {labels[0].prescriptionNo} · {labels.length} item(s)
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ px: 2, py: 2, bgcolor: 'grey.100' }}>
        <Box
          id="rx-label-print-area"
          ref={printAreaRef}
          sx={{
            width: `${LABEL_WIDTH_MM}mm`,
            mx: 'auto',
            p: '2mm',
            bgcolor: '#fff',
            color: '#000',
            fontFamily: 'monospace',
            border: '1px solid',
            borderColor: 'divider',
            boxShadow: 1,
          }}
        >
          {labels.map((label, index) => (
            <Box
              key={label.key}
              sx={{
                pt: index === 0 ? 0 : '2mm',
                mt: index === 0 ? 0 : '2mm',
                borderTop: index === 0 ? undefined : '1px dashed',
                borderColor: 'grey.500',
              }}
            >
              <Typography sx={{ fontSize: 9, fontWeight: 700, lineHeight: 1.2, textAlign: 'right' }} dir="rtl">
                {label.storeNameAr}
              </Typography>
              <Typography sx={{ fontSize: 7.5, fontWeight: 600, lineHeight: 1.2 }}>{label.storeNameEn}</Typography>
              {label.contact && (
                <Typography sx={{ fontSize: 6.5, lineHeight: 1.25, color: 'grey.800' }}>{label.contact}</Typography>
              )}

              <Divider sx={{ my: '1mm', borderColor: 'grey.500' }} />

              <Typography sx={{ fontSize: 7.5, lineHeight: 1.25 }}>
                {label.patientName || 'Patient'} · {label.patientId}
              </Typography>
              <Typography sx={{ fontSize: 6.5, lineHeight: 1.25 }}>
                {label.prescriptionNo} · {label.sourceEn}
              </Typography>

              <Typography sx={{ fontSize: 9, fontWeight: 700, lineHeight: 1.2, mt: '1mm' }}>
                {label.itemNameEn}
              </Typography>
              <Typography sx={{ fontSize: 8, fontWeight: 600, lineHeight: 1.25, textAlign: 'right' }} dir="rtl">
                {label.itemNameAr}
              </Typography>

              <Typography
                sx={{ fontSize: 9, fontWeight: 700, lineHeight: 1.35, mt: '1mm', textAlign: 'right' }}
                dir="rtl"
              >
                {label.directionsAr}
                {label.durationAr ? ` ${label.durationAr}` : ''}
              </Typography>
              <Typography sx={{ fontSize: 8, fontWeight: 600, lineHeight: 1.3 }}>
                {label.directionsEn}
                {label.durationEn ? ` ${label.durationEn}` : ''}
              </Typography>

              {label.additionalAr && (
                <Typography sx={{ fontSize: 6.5, lineHeight: 1.3, mt: '0.5mm', textAlign: 'right' }} dir="rtl">
                  {label.additionalAr}
                </Typography>
              )}
              {label.additionalEn && (
                <Typography sx={{ fontSize: 6.5, lineHeight: 1.3 }}>{label.additionalEn}</Typography>
              )}

              <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1, mt: '1mm' }}>
                <Typography sx={{ fontSize: 7, fontWeight: 600 }}>{label.quantityEn}</Typography>
                <Typography sx={{ fontSize: 7 }}>{label.fillEn}</Typography>
              </Stack>
              <Typography sx={{ fontSize: 8, fontWeight: 700, mt: '0.5mm' }}>{label.refillsEn}</Typography>
              <Typography sx={{ fontSize: 7, fontWeight: 600, textAlign: 'right' }} dir="rtl">
                {label.refillsAr}
              </Typography>

              <Divider sx={{ my: '1mm', borderColor: 'grey.400' }} />
              <Typography sx={{ fontSize: 6.5, lineHeight: 1.3 }}>
                {[label.batchNo ? `Batch ${label.batchNo}` : null, label.expiryDate ? `Exp ${label.expiryDate}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Typography>
              <Typography sx={{ fontSize: 6.5, lineHeight: 1.3 }}>
                {label.dispensedDate} · {label.prescriberName}
              </Typography>
            </Box>
          ))}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button variant="outlined" startIcon={<PrintIcon />} onClick={handlePrint} sx={{ whiteSpace: 'nowrap' }}>
          Print label
        </Button>
        <Button variant="contained" onClick={onClose} sx={{ flex: 1, minWidth: 120 }}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
