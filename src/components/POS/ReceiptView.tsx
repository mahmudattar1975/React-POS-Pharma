import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack, Typography, Divider, Box, Chip } from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import QRCode from 'qrcode';
import type { SaleHeader, SaleLine, ZatcaSubmissionStatus, CardNetwork, Payment } from '../../types/sales';
import { useSettingsStore } from '../../store/settingsStore';
import { groupVatByRate, round2 } from '../../utils/vat';
import { CONTROLLED_STATUS_LABEL } from '../../utils/controlledSubstances';

interface Props {
  open: boolean;
  invoice: SaleHeader | null;
  onClose: () => void;
}

const ROW_SX = { justifyContent: 'space-between' } as const;

interface PrintLineGroup {
  itemId: string;
  itemNameAr: string;
  itemNameEn: string;
  qty: number;
  totalInclVat: number;
  discountAmount: number;
  controlledStatus?: SaleLine['controlledStatus'];
}

// The printed receipt is per item, not per batch - a customer doesn't need to see that their 3
// units of an item came from two different batches, only that they bought 3 of it. The POS cart
// itself still tracks each batch as its own line (needed for stock decrement/FEFO/pricing), so
// this collapsing only happens here, at print time.
function groupLinesForPrint(lines: SaleLine[]): PrintLineGroup[] {
  const byItem = new Map<string, PrintLineGroup>();
  for (const l of lines) {
    const existing = byItem.get(l.itemId);
    if (existing) {
      existing.qty += l.qty;
      existing.totalInclVat = round2(existing.totalInclVat + l.totalInclVat);
      existing.discountAmount = round2(existing.discountAmount + l.discountAmount);
    } else {
      byItem.set(l.itemId, {
        itemId: l.itemId,
        itemNameAr: l.itemNameAr,
        itemNameEn: l.itemNameEn,
        qty: l.qty,
        totalInclVat: l.totalInclVat,
        discountAmount: l.discountAmount,
        controlledStatus: l.controlledStatus,
      });
    }
  }
  return Array.from(byItem.values());
}

const ZATCA_STATUS_LABEL: Record<ZatcaSubmissionStatus, { label: string; color: 'success' | 'info' | 'warning' | 'error' }> = {
  phase2_cleared: { label: 'ZATCA: Cleared', color: 'success' },
  phase2_reported: { label: 'ZATCA: Reported', color: 'success' },
  phase1_fallback: { label: 'ZATCA: Not sent (Phase 1 QR only)', color: 'warning' },
  submission_failed: { label: 'ZATCA: Submission failed', color: 'error' },
};

const CARD_NETWORK_LABEL: Record<CardNetwork, string> = {
  mada: 'mada', visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex',
};

function paymentLabel(p: Payment): string {
  if (p.method === 'card') return p.cardNetwork ? CARD_NETWORK_LABEL[p.cardNetwork] : 'Card';
  if (p.method === 'insurance') return p.insuranceCompany ? `Insurance (${p.insuranceCompany})` : 'Insurance';
  if (p.method === 'points') return 'Loyalty points';
  return 'Cash';
}

export default function ReceiptView({ open, invoice, onClose }: Props) {
  const settings = useSettingsStore((s) => s.settings);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const printAreaRef = useRef<HTMLDivElement>(null);
  const pageSizeStyleRef = useRef<HTMLStyleElement>(null);

  useEffect(() => {
    if (invoice?.zatcaQrBase64) {
      QRCode.toDataURL(invoice.zatcaQrBase64, { margin: 1, width: 180 }).then(setQrDataUrl).catch(() => setQrDataUrl(''));
    }
  }, [invoice]);

  // A fixed @page height (the only option Chromium's print pipeline actually supports - see the
  // comment on the <style> block below) would either clip a long receipt or leave blank space
  // under a short one. Measuring the real rendered content height right before printing and
  // writing it into a SEPARATE <style> tag via a direct DOM write (not React state) avoids both:
  // this has to be synchronous and already in the DOM before window.print() runs in the same
  // click handler, and a setState-triggered re-render isn't guaranteed to flush in time for that.
  function handlePrint() {
    const el = printAreaRef.current;
    const styleEl = pageSizeStyleRef.current;
    if (el && styleEl) {
      const heightMm = (el.scrollHeight / 96) * 25.4 + 6; // 96px = 1in = 25.4mm; +6mm slack for rounding
      styleEl.textContent = `@page { size: 80mm ${heightMm.toFixed(1)}mm; margin: 0; }`;
    }
    window.print();
  }

  if (!invoice) return null;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      {/* Print only the receipt itself, full-width, not the dialog chrome/backdrop or the rest of
          the POS screen behind it - the standard "hide everything, then re-reveal one subtree"
          print trick. window.print() works fine here since this is a real page in the user's own
          browser, not a sandboxed preview - the browser's print dialog lets them pick "Save as
          PDF" as the destination same as any other page. */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #receipt-print-area, #receipt-print-area * { visibility: visible; }
          #receipt-print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 80mm;
            padding: 3mm;
            font-size: 11px;
          }
        }
      `}</style>
      {/* Sized for an 80mm thermal receipt roll (the standard POS width), not A4/Letter - height
          is computed and written into this tag by handlePrint() right before printing, from the
          receipt's actual rendered height, rather than a fixed guess (see handlePrint's comment
          for why a plain CSS "auto height" doesn't work here). Starts empty; harmless until then.
          Two things confirmed only by generating a real PDF and measuring it, not by trusting the
          live CSSOM (which looked fine in both broken cases below):
          1. `@page` has to sit OUTSIDE `@media print`, not nested inside it - nesting it silently
             dropped the whole `size` descriptor (kept `margin`, dropped `size`), producing a
             default Letter page (612x792pt) instead.
          2. `size: 80mm auto;` (width fixed, height auto-growing to content) is NOT valid CSS -
             `auto` can't combine with an explicit length in the same `size` value - and silently
             fell back to Letter again. `size: 80mm;` alone (single value = a square page) DID
             work, confirmed at exactly 80.1x80.1mm - hence computing an explicit height instead. */}
      <style ref={pageSizeStyleRef} />
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        Invoice {invoice.invoiceNo}
        <Chip size="small" color={ZATCA_STATUS_LABEL[invoice.zatcaStatus].color} label={ZATCA_STATUS_LABEL[invoice.zatcaStatus].label} />
      </DialogTitle>
      <DialogContent id="receipt-print-area" ref={printAreaRef}>
        <Stack spacing={0.5} sx={{ fontFamily: 'monospace', fontSize: 13 }}>
          <Typography sx={{ fontWeight: 700 }}>{settings.storeNameAr}</Typography>
          <Typography sx={{ fontWeight: 700 }} color="text.secondary">{settings.storeNameEn}</Typography>
          <Typography variant="caption" color="text.secondary">
            الرقم الضريبي VAT {settings.vatRegistrationNo} · السجل التجاري CR {settings.crNumber}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {new Date(invoice.date).toLocaleString()}
          </Typography>
          {/* ZATCA requires the Arabic invoice-type term on every tax invoice - this is a legal
              KSA document, not just an English receipt with Arabic as decoration. */}
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            {invoice.invoiceType === 'simplified' ? 'فاتورة ضريبية مبسطة (Simplified Tax Invoice)' : 'فاتورة ضريبية (Standard Tax Invoice)'}
          </Typography>
          {(invoice.customerNameAr || invoice.customerNameEn) && (
            <Typography variant="caption">
              العميل / Customer: {invoice.customerNameAr}{invoice.customerNameAr && invoice.customerNameEn ? ' / ' : ''}{invoice.customerNameEn}
            </Typography>
          )}

          <Divider sx={{ my: 1 }} />

          {groupLinesForPrint(invoice.lines).map((g) => (
            <Box key={g.itemId} sx={{ mb: 0.75 }}>
              <Typography variant="body2">{g.itemNameAr}</Typography>
              <Typography variant="body2" color="text.secondary">
                {g.itemNameEn}
                {g.controlledStatus ? ` ℞ (${CONTROLLED_STATUS_LABEL[g.controlledStatus]})` : ''}
              </Typography>
              <Stack direction="row" sx={ROW_SX}>
                <Typography variant="caption" color="text.secondary">
                  Qty {g.qty}
                  {g.discountAmount > 0 ? ` · discount -${g.discountAmount.toFixed(2)}` : ''}
                </Typography>
                <Typography variant="caption">{g.totalInclVat.toFixed(2)}</Typography>
              </Stack>
            </Box>
          ))}

          <Divider sx={{ my: 1 }} />

          <Stack direction="row" sx={ROW_SX}>
            <Typography variant="body2">الإجمالي قبل الضريبة / Subtotal (excl. VAT)</Typography>
            <Typography variant="body2">{invoice.subtotalExclVat.toFixed(2)}</Typography>
          </Stack>
          {invoice.totalDiscount > 0 && (
            <Stack direction="row" sx={ROW_SX}>
              <Typography variant="body2">الخصم / Discount</Typography>
              <Typography variant="body2">-{invoice.totalDiscount.toFixed(2)}</Typography>
            </Stack>
          )}
          {groupVatByRate(invoice.lines).map((b) => (
            <Stack key={b.rate} direction="row" sx={ROW_SX}>
              <Typography variant="body2">
                ضريبة القيمة المضافة / VAT {b.rate > 0 ? `(${(b.rate * 100).toFixed(0)}%)` : '(معفاة / zero-rated)'}
              </Typography>
              <Typography variant="body2">{b.vatAmount.toFixed(2)}</Typography>
            </Stack>
          ))}
          <Stack direction="row" sx={ROW_SX}>
            <Typography sx={{ fontWeight: 700 }}>الإجمالي / Total (SAR)</Typography>
            <Typography sx={{ fontWeight: 700 }}>{invoice.totalInclVat.toFixed(2)}</Typography>
          </Stack>

          <Divider sx={{ my: 1 }} />
          <Typography variant="body2">طريقة الدفع / Paid via</Typography>
          {invoice.payments.map((p, i) => (
            <Stack key={i} direction="row" sx={ROW_SX}>
              <Typography variant="body2" color="text.secondary">{paymentLabel(p)}</Typography>
              <Typography variant="body2">{p.amount.toFixed(2)}</Typography>
            </Stack>
          ))}

          {(invoice.pointsEarned || invoice.pointsRedeemed) && (
            <>
              <Divider sx={{ my: 1 }} />
              {invoice.pointsRedeemed ? (
                <Stack direction="row" sx={ROW_SX}>
                  <Typography variant="caption" color="text.secondary">Points redeemed</Typography>
                  <Typography variant="caption">-{invoice.pointsRedeemed}</Typography>
                </Stack>
              ) : null}
              {invoice.pointsEarned ? (
                <Stack direction="row" sx={ROW_SX}>
                  <Typography variant="caption" color="text.secondary">Points earned</Typography>
                  <Typography variant="caption">+{invoice.pointsEarned}</Typography>
                </Stack>
              ) : null}
            </>
          )}

          {invoice.prescription && (
            <>
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2">
                {invoice.prescription.source === 'wasfaty' ? 'وصفتي / Wasfaty Prescription' : 'وصفة طبية / Prescription Record'}
              </Typography>
              {invoice.prescription.wasfatyReferenceNo && (
                <Typography variant="caption" color="text.secondary">
                  Wasfaty Ref: {invoice.prescription.wasfatyReferenceNo}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary">
                Rx #{invoice.prescription.prescriptionId} · {invoice.prescription.prescriptionDate}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Prescriber: {invoice.prescription.prescriberName}
                {invoice.prescription.prescriberId ? ` (${invoice.prescription.prescriberId})` : ''}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Patient ID: {invoice.prescription.patientNationalId}
              </Typography>
            </>
          )}
        </Stack>

        {qrDataUrl && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
            <img src={qrDataUrl} width={160} height={160} alt="ZATCA invoice QR" />
          </Box>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 0.5 }}>
          {invoice.zatcaStatus === 'phase1_fallback'
            ? 'ZATCA QR (Phase 1 fields only - not yet cryptographically stamped/reported)'
            : 'ZATCA QR (Phase 2 - cryptographically stamped and submitted)'}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button variant="outlined" startIcon={<PrintIcon />} onClick={handlePrint}>
          Print
        </Button>
        <Button variant="contained" onClick={onClose} fullWidth>
          New Sale
        </Button>
      </DialogActions>
    </Dialog>
  );
}
