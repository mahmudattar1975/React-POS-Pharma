// The A4 tax-invoice document for a sales invoice (Fatoora/ZATCA Phase 2).
//
// Why this exists next to ReceiptView: an 80mm thermal receipt is a till slip, not the tax invoice a
// B2B buyer files. A standard invoice must show both parties' VAT numbers, the invoice's UUID, the
// ICV, the per-rate VAT breakdown and the cryptographic QR - on A4, in Arabic and English, as one
// document. This is that document, rebuilt from the SALE data so it can be reprinted at any time
// (ZATCA requires the seller to be able to produce the invoice, and a reprinted slip is not it).
//
// The QR is whatever the invoice was stamped with. If the invoice was never submitted (Phase 1
// fallback / pending), the page still prints - but the footer says so explicitly rather than
// pretending a 5-field QR is a Phase 2 stamp. That distinction is the whole point of the status
// field, and silently papering over it would misrepresent a legal document.
import { useEffect, useRef, useState } from 'react';
import {
  Box, Button, Dialog, DialogActions, DialogContent, Divider, Stack, Typography,
} from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import ReceiptIcon from '@mui/icons-material/Receipt';
import QRCode from 'qrcode';
import type { Payment, SaleHeader, SaleLine } from '../../types/sales';
import { useSettingsStore } from '../../store/settingsStore';
import { groupVatByRate, round2 } from '../../utils/vat';
import { zatcaStatusLabel } from '../../utils/zatcaInvoice';
import { formatMoney, formatQty } from '../../utils/format';

import { T, useT } from '../../i18n';
interface Props {
  open: boolean;
  invoice: SaleHeader | null;
  // The A4 document is the buyer's tax invoice. The 80mm till receipt is the customer's copy, so
  // when the parent can open that second surface, offer it here - the cashier should not have to
  // close A4 and hunt for the receipt row in the ledger.
  onPrintReceipt?: () => void;
  onClose: () => void;
}

interface DocumentLine {
  itemId: string;
  itemNameAr: string;
  itemNameEn: string;
  qty: number;
  unitPrice: number;
  discountAmount: number;
  netExclVat: number;
  vatRate: number;
  vatAmount: number;
  totalInclVat: number;
}

// Collapse batch-split cart lines into one invoice row per item, like the receipt does: the buyer
// bought N units of an item, and which batch they came from is an inventory detail. Amounts are
// re-added with round2 so the printed row total equals the sum of what was actually charged.
function toDocumentLines(lines: SaleLine[]): DocumentLine[] {
  const byItem = new Map<string, DocumentLine>();
  for (const l of lines) {
    const existing = byItem.get(l.itemId);
    if (existing) {
      existing.qty += l.qty;
      existing.discountAmount = round2(existing.discountAmount + l.discountAmount);
      existing.netExclVat = round2(existing.netExclVat + l.netExclVat);
      existing.vatAmount = round2(existing.vatAmount + l.vatAmount);
      existing.totalInclVat = round2(existing.totalInclVat + l.totalInclVat);
      continue;
    }
    byItem.set(l.itemId, {
      itemId: l.itemId,
      itemNameAr: l.itemNameAr,
      itemNameEn: l.itemNameEn,
      qty: l.qty,
      unitPrice: l.unitPrice,
      discountAmount: l.discountAmount,
      netExclVat: l.netExclVat,
      vatRate: l.vatRate,
      vatAmount: l.vatAmount,
      totalInclVat: l.totalInclVat,
    });
  }
  return [...byItem.values()];
}

const PAYMENT_LABEL: Record<Payment['method'], string> = {
  cash: 'نقداً / Cash',
  card: 'بطاقة / Card',
  insurance: 'تأمين / Insurance',
  points: 'نقاط الولاء / Loyalty points',
  wasfaty: 'وصفتي / Wasfaty',
  other: 'أخرى / Other',
};

const TH = { fontSize: 11, fontWeight: 700, borderBottom: '1px solid #333', py: 0.75, px: 0.5 } as const;
const TD = { fontSize: 11, borderBottom: '1px solid #ddd', py: 0.6, px: 0.5, verticalAlign: 'top' } as const;

export default function TaxInvoiceDocument({ open, invoice, onPrintReceipt, onClose }: Props) {
  const tr = useT();
  const settings = useSettingsStore((s) => s.settings);
  // Keyed by the QR payload: the rendered image is only trusted when it belongs to the invoice on
  // screen, so switching between two invoices can never flash the previous one's QR.
  const [qr, setQr] = useState<{ payload: string; dataUrl: string }>({ payload: '', dataUrl: '' });
  const printAreaRef = useRef<HTMLDivElement>(null);

  const qrPayload = invoice?.zatcaQrBase64 ?? '';
  useEffect(() => {
    if (!qrPayload) return;
    let cancelled = false;
    QRCode.toDataURL(qrPayload, { margin: 1, width: 220 })
      .then((dataUrl) => { if (!cancelled) setQr({ payload: qrPayload, dataUrl }); })
      .catch(() => { if (!cancelled) setQr({ payload: qrPayload, dataUrl: '' }); });
    return () => { cancelled = true; };
  }, [qrPayload]);
  const qrDataUrl = qr.payload === qrPayload ? qr.dataUrl : '';

  if (!invoice) return null;

  const docLines = toDocumentLines(invoice.lines);
  const vatBuckets = groupVatByRate(invoice.lines);
  const stamped =
    invoice.zatcaStatus === 'phase2_cleared' || invoice.zatcaStatus === 'phase2_reported';
  const titleAr = invoice.invoiceType === 'standard' ? 'فاتورة ضريبية' : 'فاتورة ضريبية مبسطة';
  const titleEn = invoice.invoiceType === 'standard' ? 'Standard Tax Invoice' : 'Simplified Tax Invoice';

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <style>{`
        @page { size: A4; margin: 12mm; }
        @media print {
          body * { visibility: hidden; }
          #tax-invoice-print-area, #tax-invoice-print-area * { visibility: visible; }
          #tax-invoice-print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 186mm;
            padding: 0;
            background: #fff;
            color: #000;
          }
        }
      `}</style>

      <DialogContent id="tax-invoice-print-area" ref={printAreaRef} sx={{ bgcolor: '#fff', color: '#000' }}>
        {/* ---- seller + document header ---- */}
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
          <Box>
            <Typography sx={{ fontSize: 17, fontWeight: 700 }}>{settings.storeNameAr}</Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{settings.storeNameEn}</Typography>
            <Typography sx={{ fontSize: 10.5 }}>
              <T>الرقم الضريبي / VAT No:</T> {settings.vatRegistrationNo}
            </Typography>
            <Typography sx={{ fontSize: 10.5 }}>
              <T>السجل التجاري / CR No:</T> {settings.crNumber}
            </Typography>
            <Typography sx={{ fontSize: 10.5 }}>{settings.address}</Typography>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography sx={{ fontSize: 16, fontWeight: 700 }}>{titleAr}</Typography>
            <Typography sx={{ fontSize: 12, fontWeight: 600 }}>{titleEn}</Typography>
            <Typography sx={{ fontSize: 10.5, mt: 0.5 }}>
              {/* Arabic is the legally required term; English sits underneath it, never instead. */}
              {invoice.invoiceType === 'standard'
                ? 'يجب ختم هذه الفاتورة من هيئة الزكاة والضريبة والجمارك قبل تسليمها'
                : 'تُبلغ هذه الفاتورة إلى هيئة الزكاة والضريبة والجمارك خلال ٢٤ ساعة'}
            </Typography>
            <Box
              sx={{
                display: 'inline-block', mt: 0.75, px: 1, py: 0.25, border: '1px solid #333',
                borderRadius: 0.5, fontSize: 10.5, fontWeight: 700,
              }}
            >
              {zatcaStatusLabel(invoice.zatcaStatus).label.toUpperCase()}
            </Box>
          </Box>
        </Stack>

        <Divider sx={{ borderColor: '#333' }} />

        {/* ---- identity of the DOCUMENT (Phase 2), not just of the sale ---- */}
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 3, py: 1, fontSize: 10.5 }}>
          <Box>
            <Typography sx={{ fontSize: 10.5, fontWeight: 700 }}><T>Invoice No / رقم الفاتورة</T></Typography>
            <Typography sx={{ fontSize: 11, direction: 'ltr', unicodeBidi: 'isolate' }}>{invoice.invoiceNo}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 10.5, fontWeight: 700 }}><T>Issue date / تاريخ الإصدار</T></Typography>
            <Typography sx={{ fontSize: 11 }}>
              {invoice.date.slice(0, 10)} {invoice.date.slice(11, 19)}
            </Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 10.5, fontWeight: 700 }}><T>UUID</T></Typography>
            <Typography sx={{ fontSize: 10, fontFamily: 'monospace' }}>
              {invoice.zatcaUuid ?? '—'}
            </Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 10.5, fontWeight: 700 }}><T>ICV</T></Typography>
            <Typography sx={{ fontSize: 11 }}>{invoice.zatcaIcv ?? '—'}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 10.5, fontWeight: 700 }}><T>Payment / الدفع</T></Typography>
            <Typography sx={{ fontSize: 11 }}>
              {invoice.payments.map((p) => PAYMENT_LABEL[p.method]).join(' + ')}
            </Typography>
          </Box>
        </Stack>

        {/* ---- buyer ---- */}
        <Box sx={{ border: '1px solid #333', borderRadius: 0.5, p: 1, mb: 1.5 }}>
          <Typography sx={{ fontSize: 10.5, fontWeight: 700, mb: 0.25 }}>
            <T>Buyer / المشتري</T>
          </Typography>
          <Typography sx={{ fontSize: 11 }}>
            {invoice.customerNameAr || invoice.customerNameEn || tr("عميل نقدي / Walk-in Customer")}
          </Typography>
          {invoice.customerVatNumber && (
            <Typography sx={{ fontSize: 10.5 }}>
              <T>الرقم الضريبي / VAT No:</T> {invoice.customerVatNumber}
            </Typography>
          )}
          {invoice.invoiceType === 'standard' && !invoice.customerVatNumber && (
            <Typography sx={{ fontSize: 10.5, color: '#b00020' }}>
              <T>VAT number missing on a standard invoice - complete it before sending to the buyer.</T>
            </Typography>
          )}
        </Box>

        {/* ---- lines ---- */}
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
          <Box component="thead">
            <Box component="tr">
              <Box component="th" sx={{ ...TH, textAlign: 'left', width: '38%' }}><T>Item / الصنف</T></Box>
              <Box component="th" sx={{ ...TH, textAlign: 'right' }}><T>Qty</T></Box>
              <Box component="th" sx={{ ...TH, textAlign: 'right' }}><T>Unit</T></Box>
              <Box component="th" sx={{ ...TH, textAlign: 'right' }}><T>Discount</T></Box>
              <Box component="th" sx={{ ...TH, textAlign: 'right' }}><T>Net</T></Box>
              <Box component="th" sx={{ ...TH, textAlign: 'right' }}><T>VAT %</T></Box>
              <Box component="th" sx={{ ...TH, textAlign: 'right' }}><T>VAT</T></Box>
              <Box component="th" sx={{ ...TH, textAlign: 'right' }}><T>Total</T></Box>
            </Box>
          </Box>
          <Box component="tbody">
            {docLines.map((l) => (
              <Box component="tr" key={l.itemId}>
                <Box component="td" sx={TD}>
                  <Typography sx={{ fontSize: 11 }}>{l.itemNameAr}</Typography>
                  <Typography sx={{ fontSize: 10, color: '#444' }}>{l.itemNameEn}</Typography>
                </Box>
                <Box component="td" sx={{ ...TD, textAlign: 'right' }}>{formatQty(l.qty)}</Box>
                <Box component="td" sx={{ ...TD, textAlign: 'right' }}>{formatMoney(l.unitPrice)}</Box>
                <Box component="td" sx={{ ...TD, textAlign: 'right' }}>
                  {l.discountAmount > 0 ? `-${formatMoney(l.discountAmount)}` : '—'}
                </Box>
                <Box component="td" sx={{ ...TD, textAlign: 'right' }}>{formatMoney(l.netExclVat)}</Box>
                <Box component="td" sx={{ ...TD, textAlign: 'right' }}>{(l.vatRate * 100).toFixed(0)}%</Box>
                <Box component="td" sx={{ ...TD, textAlign: 'right' }}>{formatMoney(l.vatAmount)}</Box>
                <Box component="td" sx={{ ...TD, textAlign: 'right', fontWeight: 600 }}>{formatMoney(l.totalInclVat)}</Box>
              </Box>
            ))}
          </Box>
        </Box>

        {/* ---- totals + QR ---- */}
        <Stack direction="row" spacing={2} sx={{ mt: 1.5, alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1 }}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', fontSize: 11, py: 0.25 }}>
              <Typography sx={{ fontSize: 11 }}><T>الإجمالي قبل الضريبة / Subtotal (excl. VAT)</T></Typography>
              <Typography sx={{ fontSize: 11 }}>{formatMoney(invoice.subtotalExclVat)}</Typography>
            </Stack>
            {invoice.totalDiscount > 0 && (
              <Stack direction="row" sx={{ justifyContent: 'space-between', fontSize: 11, py: 0.25 }}>
                <Typography sx={{ fontSize: 11 }}><T>الخصم / Discount</T></Typography>
                <Typography sx={{ fontSize: 11 }}>-{formatMoney(invoice.totalDiscount)}</Typography>
              </Stack>
            )}
            {vatBuckets.map((b) => (
              <Stack key={b.rate} direction="row" sx={{ justifyContent: 'space-between', fontSize: 11, py: 0.25 }}>
                <Typography sx={{ fontSize: 11 }}>
                  <T>ضريبة القيمة المضافة / VAT</T> {b.rate > 0 ? `(${(b.rate * 100).toFixed(0)}%)` : tr("(zero-rated)")}
                </Typography>
                <Typography sx={{ fontSize: 11 }}>{formatMoney(b.vatAmount)}</Typography>
              </Stack>
            ))}
            <Divider sx={{ my: 0.5, borderColor: '#333' }} />
            <Stack direction="row" sx={{ justifyContent: 'space-between', py: 0.25 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 700 }}><T>الإجمالي / Total (SAR)</T></Typography>
              <Typography sx={{ fontSize: 12, fontWeight: 700 }}>{formatMoney(invoice.totalInclVat)}</Typography>
            </Stack>
          </Box>

          <Box sx={{ width: 120, textAlign: 'center' }}>
            {qrDataUrl ? (
              <img src={qrDataUrl} width={110} height={110} alt={tr('ZATCA invoice QR')} />
            ) : (
              <Box sx={{ width: 110, height: 110, border: '1px dashed #999', mx: 'auto' }} />
            )}
            <Typography sx={{ fontSize: 9.5, color: '#444', mt: 0.5 }}>
              <T>رمز الاستجابة / ZATCA QR</T>
            </Typography>
          </Box>
        </Stack>

        {/* ---- honesty about the stamp ---- */}
        <Box sx={{ mt: 1.5, pt: 1, borderTop: '1px solid #ccc' }}>
          <Typography sx={{ fontSize: 9.5, color: '#444' }}>
            {stamped
              ? `${tr('Cryptographically stamped and ')}${invoice.zatcaStatus === 'phase2_cleared' ? tr('cleared') : tr('reported')}${tr(' by ZATCA')}${invoice.zatcaSubmittedAt ? ` on ${invoice.zatcaSubmittedAt.slice(0, 10)}` : ''}${tr('. Invoice hash: ')}${invoice.zatcaInvoiceHashBase64 ?? '—'}`
              : `${tr("NOT YET STAMPED BY ZATCA (")}${zatcaStatusLabel(invoice.zatcaStatus).label}${tr("). This document is not a valid Phase 2 tax invoice until it is submitted and accepted - see Point of Sale > ZATCA Sales Invoices.")}`}
          </Typography>
          <Typography sx={{ fontSize: 9.5, color: '#444', mt: 0.25 }}>
            {settings.storeNameEn} · {settings.address} <T>· VAT</T> {settings.vatRegistrationNo}
          </Typography>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="outlined" startIcon={<PrintIcon />} onClick={() => window.print()}>
          <T>Print A4</T>
        </Button>
        {onPrintReceipt && (
          <Button variant="outlined" startIcon={<ReceiptIcon />} onClick={onPrintReceipt}>
            <T>Print Receipt</T>
          </Button>
        )}
        <Button onClick={onClose}><T>Close</T></Button>
      </DialogActions>
    </Dialog>
  );
}
