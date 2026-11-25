// The patient direction LABEL: a small thermal label printed after the sales invoice.
//
// This is deliberately not a document. It carries no store header, invoice number, date, patient,
// quantity, price, VAT, QR or code - only what someone needs while standing at the medicine shelf:
// the item name and its directions. Both languages are kept, in very small type, because the label
// is physically small and the Arabic/English pair is what the patient takes away.
//
// Unlike the 80mm receipt, the preview is rendered at the label's true width, so the height that
// handlePrint() measures is the height that will actually be printed (a wider on-screen preview
// would under-measure and clip the wrapped text).
//
// Content comes from the SALE's frozen snapshots, so a reprint months later shows exactly what was
// dispensed even if the DOS library has changed since.
import { useEffect, useRef } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import type { SaleHeader } from '../../types/sales';
import { groupDosageLines, buildDosageLabel } from '../../utils/dosages';

import { T } from '../../i18n';
// Physical label width. 50mm is a common small pharmacy label; if the counter uses a different
// die-cut size, change this one constant (the preview, @page width and measurement all follow it).
const LABEL_WIDTH_MM = 50;

interface Props {
  open: boolean;
  invoice: SaleHeader | null;
  // True when this label was opened as the second half of the receipt print, so it sends itself to
  // the printer without another click. Left false for the manual preview button and for reprints
  // from the Sales/ZATCA screen, where the pharmacist may only want to look.
  autoPrint?: boolean;
  onClose: () => void;
}

export default function DosagePrintView({ open, invoice, autoPrint = false, onClose }: Props) {
  const printAreaRef = useRef<HTMLDivElement>(null);
  const pageSizeStyleRef = useRef<HTMLStyleElement>(null);
  // One automatic print per sale - a re-render (or React StrictMode's double effect in dev) must
  // not send the same label twice.
  const autoPrintedForRef = useRef<string | null>(null);
  const groups = invoice ? groupDosageLines(invoice.lines) : [];

  function handlePrint() {
    const el = printAreaRef.current;
    const styleEl = pageSizeStyleRef.current;
    if (el && styleEl) {
      // The element is already 50mm wide on screen, so this height is real and not an estimate for
      // a wider preview. +2mm covers sub-pixel rounding on the label pitch.
      const heightMm = (el.scrollHeight / 96) * 25.4 + 2;
      styleEl.textContent = `@page { size: ${LABEL_WIDTH_MM}mm ${heightMm.toFixed(1)}mm; margin: 0; }`;
    }
    window.print();
  }

  // Chained after the invoice: give the dialog one paint so scrollHeight reflects the real label
  // content, then print. The short delay also keeps this from racing the receipt's own
  // window.print() in the same click.
  useEffect(() => {
    if (!open || !autoPrint || !invoice || groups.length === 0) return;
    if (autoPrintedForRef.current === invoice.id) return;
    autoPrintedForRef.current = invoice.id;
    const timer = window.setTimeout(handlePrint, 250);
    return () => window.clearTimeout(timer);
    // handlePrint closes over the current invoice/refs; re-running on invoice identity is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoPrint, invoice?.id]);

  if (!invoice) return null;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #dosage-print-area, #dosage-print-area * { visibility: visible; }
          #dosage-print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: ${LABEL_WIDTH_MM}mm;
            padding: 2mm;
            background: #fff;
            color: #000;
          }
        }`}</style>
      <style ref={pageSizeStyleRef} />
      <DialogTitle>
        <T>Directions label</T>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {LABEL_WIDTH_MM}<T>mm label · invoice</T> {invoice.invoiceNo}
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ px: 2, py: 2, bgcolor: 'grey.100' }}>
        {/* True-size preview: item name + the two direction sentences, nothing else. */}
        <Box
          id="dosage-print-area"
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
          {groups.length === 0 && (
            <Typography sx={{ fontSize: 8, lineHeight: 1.3 }}>
              <T>No written directions recorded for this invoice.</T>
            </Typography>
          )}
          {groups.map((group, index) => {
            const label = buildDosageLabel(group.dosage);
            return (
              <Box key={group.key} sx={{ mb: index === groups.length - 1 ? 0 : '2mm' }}>
                <Typography sx={{ fontSize: 9, fontWeight: 700, lineHeight: 1.2 }}>
                  {group.itemNameEn || group.itemNameAr}
                </Typography>
                <Typography
                  dir="rtl"
                  sx={{ fontSize: 8, fontWeight: 600, lineHeight: 1.35, mt: '0.8mm', textAlign: 'right' }}
                >
                  {label.labelAr}
                </Typography>
                <Typography sx={{ fontSize: 8, fontWeight: 600, lineHeight: 1.25, mt: '0.4mm' }}>
                  {label.labelEn}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button variant="outlined" startIcon={<PrintIcon />} onClick={handlePrint} sx={{ whiteSpace: 'nowrap' }}>
          <T>Print label</T>
        </Button>
        <Button variant="contained" onClick={onClose} sx={{ flex: 1, minWidth: 120 }}>
          <T>Done</T>
        </Button>
      </DialogActions>
    </Dialog>
  );
}
