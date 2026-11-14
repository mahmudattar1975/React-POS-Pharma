// The A4 purchase-invoice document: what this pharmacy received from a supplier, rebuilt from the
// posted invoice so it can be reprinted at any time.
//
// It is deliberately NOT a ZATCA tax invoice. In a purchase the SUPPLIER issues the tax invoice and
// this pharmacy is the buyer, so stamping a QR or calling this a tax invoice would misrepresent the
// legal document. This printout is the goods-received record that ties our internal PUR number to
// the supplier's paper invoice number, the batches/expiries that entered stock and the input VAT
// claimed. The supplier's own invoice remains the legal evidence.
import { useRef } from 'react';
import {
  Box, Button, Dialog, DialogActions, DialogContent, Divider, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import type { PurchaseInvoice, PurchaseLine, Vendor } from '../../types/purchasing';
import { PARTY_TYPE_FLAG } from '../../types/party';
import { formatDiscountPercent } from '../../utils/purchasing';
import { formatMoney, formatQty, formatUnitPrice } from '../../utils/format';
import { useSettingsStore } from '../../store/settingsStore';

interface Props {
  open: boolean;
  invoice: PurchaseInvoice | null;
  // Master row for the party's VAT number/phone, which the invoice only snapshots by name/number.
  // Same row shape for a vendor and a customer account - typeFlag on the invoice says which side.
  party?: Vendor;
  // Human label for the branch the purchase was attributed to (undefined when it has none).
  costCenterLabel?: string;
  onClose: () => void;
}

const TH = { fontSize: 10.5, fontWeight: 700, borderBottom: '1px solid #333', py: 0.6, px: 0.5 } as const;
const TD = { fontSize: 10.5, borderBottom: '1px solid #ddd', py: 0.5, px: 0.5, verticalAlign: 'top' } as const;

// Invoices posted before bonus-diluted costing existed carry only the per-paid-unit cost.
function lineUnitCost(l: PurchaseLine): number {
  return l.dilutedUnitCostPrice ?? l.unitCostPrice;
}

export default function PurchaseInvoiceDocument({ open, invoice, party, costCenterLabel, onClose }: Props) {
  const settings = useSettingsStore((s) => s.settings);
  const printAreaRef = useRef<HTMLDivElement>(null);

  if (!invoice) return null;

  const partyIsCustomer = invoice.partyType === PARTY_TYPE_FLAG.customer;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <style>{`
        @page { size: A4; margin: 12mm; }
        @media print {
          body * { visibility: hidden; }
          #purchase-invoice-print-area, #purchase-invoice-print-area * { visibility: visible; }
          #purchase-invoice-print-area {
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

      <DialogContent id="purchase-invoice-print-area" ref={printAreaRef} sx={{ bgcolor: '#fff', color: '#000' }}>
        {/* ---- buyer (this pharmacy) + document header ---- */}
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
          <Box>
            <Typography sx={{ fontSize: 9, fontWeight: 700, color: '#555', letterSpacing: 0.5 }}>
              Buyer / المشتري
            </Typography>
            <Typography sx={{ fontSize: 17, fontWeight: 700 }}>{settings.storeNameAr}</Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{settings.storeNameEn}</Typography>
            <Typography sx={{ fontSize: 10.5 }}>الرقم الضريبي / VAT No: {settings.vatRegistrationNo || '—'}</Typography>
            <Typography sx={{ fontSize: 10.5 }}>السجل التجاري / CR No: {settings.crNumber || '—'}</Typography>
            <Typography sx={{ fontSize: 10.5 }}>{settings.address}</Typography>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography sx={{ fontSize: 16, fontWeight: 700 }}>
              {invoice.isReturn ? 'فاتورة مرتجع مشتريات' : 'فاتورة مشتريات'}
            </Typography>
            <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
              {invoice.isReturn ? 'Purchase Return' : 'Purchase Invoice'}
            </Typography>
            <Typography sx={{ fontSize: 10 }}>
              {invoice.isReturn ? 'مرتجع بضاعة / Goods returned record' : 'سجل استلام بضاعة / Goods received record'}
            </Typography>
            <Box
              sx={{
                display: 'inline-block', mt: 0.75, px: 1, py: 0.25, border: '1px solid #333',
                borderRadius: 0.5, fontSize: 10, fontWeight: 700,
              }}
            >
              {invoice.isReturn ? 'RETURNED' : 'RECEIVED'} · {invoice.invoiceNo}
            </Box>
          </Box>
        </Stack>

        <Divider sx={{ borderColor: '#333' }} />

        {/* ---- supplier (the buyer is this pharmacy's letterhead above) ---- */}
        <Box sx={{ py: 1 }}>
          <Box sx={{ border: '1px solid #bbb', borderRadius: 0.5, p: 1 }}>
            <Typography sx={{ fontSize: 10, fontWeight: 700 }}>
              {partyIsCustomer ? 'Customer / العميل' : 'Supplier / المورد'}
            </Typography>
            <Typography sx={{ fontSize: 11, fontWeight: 600 }}>{invoice.vendorNameEn}</Typography>
            <Typography sx={{ fontSize: 10 }} dir="rtl" style={{ textAlign: 'left' }}>{invoice.vendorNameAr}</Typography>
            <Typography sx={{ fontSize: 10 }}>
              {partyIsCustomer ? 'Customer account' : 'Vendor'} No {invoice.vendorNo ?? party?.vendorNo ?? '—'}
              {party?.vatNumber
                ? ` · VAT ${party.vatNumber}`
                : ' · VAT not on file'}
              {party?.phone ? ` · ${party.phone}` : ''}
            </Typography>
          </Box>
        </Box>

        {/* ---- identity of the document, not just of the delivery ---- */}
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 3, py: 1, fontSize: 10.5 }}>
          <Box>
            <Typography sx={{ fontSize: 10, fontWeight: 700 }}>
              {partyIsCustomer ? 'Customer document / مستند العميل' : 'Supplier invoice / فاتورة المورد'}
            </Typography>
            <Typography sx={{ fontSize: 11 }}>{invoice.vendorInvoiceNo}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 10, fontWeight: 700 }}>Purchase No / رقم الشراء</Typography>
            <Typography sx={{ fontSize: 11 }}>{invoice.invoiceNo}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 10, fontWeight: 700 }}>Invoice date / تاريخ الفاتورة</Typography>
            <Typography sx={{ fontSize: 11 }}>{invoice.date}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 10, fontWeight: 700 }}>Received / تاريخ الاستلام</Typography>
            <Typography sx={{ fontSize: 11 }}>{invoice.receivedAt.slice(0, 16).replace('T', ' ')}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 10, fontWeight: 700 }}>Received by / المستلم</Typography>
            <Typography sx={{ fontSize: 11 }}>{invoice.receivedBy}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 10, fontWeight: 700 }}>Branch / الفرع</Typography>
            <Typography sx={{ fontSize: 11 }}>{costCenterLabel ?? '—'}</Typography>
          </Box>
        </Stack>

        {/* ---- lines: the batches that actually entered stock ---- */}
        <Table size="small" sx={{ '& th, & td': { px: 0.5 } }}>
          <TableHead>
            <TableRow>
              <TableCell sx={TH}>#</TableCell>
              <TableCell sx={TH}>Item / الصنف</TableCell>
              <TableCell sx={TH} align="right">Qty / الكمية</TableCell>
              <TableCell sx={TH}>Batch / expiry</TableCell>
              <TableCell sx={TH} align="right">Unit price</TableCell>
              <TableCell sx={TH} align="right">Unit cost</TableCell>
              <TableCell sx={TH} align="right">Disc. 1</TableCell>
              <TableCell sx={TH} align="right">Disc. 2</TableCell>
              <TableCell sx={TH} align="right">Disc. 3</TableCell>
              <TableCell sx={TH} align="right">Net (excl. VAT)</TableCell>
              <TableCell sx={TH} align="right">VAT</TableCell>
              <TableCell sx={TH} align="right">Total</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {invoice.lines.map((l, index) => (
              <TableRow key={l.id}>
                <TableCell sx={TD}>{index + 1}</TableCell>
                <TableCell sx={TD}>
                  <Typography sx={{ fontSize: 10.5, fontWeight: 600 }}>{l.itemNameEn}</Typography>
                  {l.itemNameAr && (
                    <Typography sx={{ fontSize: 9.5 }} dir="rtl" style={{ textAlign: 'left' }}>{l.itemNameAr}</Typography>
                  )}
                  {l.unit && <Typography sx={{ fontSize: 9.5, color: '#444' }}>{l.unit}</Typography>}
                </TableCell>
                <TableCell sx={TD} align="right">
                  {formatQty(l.qty)}
                  {l.bonusQty > 0 && (
                    <Typography sx={{ fontSize: 9.5, color: '#444' }}>+{formatQty(l.bonusQty)} bonus</Typography>
                  )}
                </TableCell>
                <TableCell sx={TD}>
                  {l.batchNo}
                  <Typography sx={{ fontSize: 9.5, color: '#444' }}>{l.expiryDate}</Typography>
                </TableCell>
                <TableCell sx={TD} align="right">{formatUnitPrice(l.unitPurchasePrice)}</TableCell>
                <TableCell sx={TD} align="right">
                  {formatUnitPrice(lineUnitCost(l))}
                  {l.bonusQty > 0 && (
                    <Typography sx={{ fontSize: 9.5, color: '#444' }}>paid {formatUnitPrice(l.unitCostPrice)}</Typography>
                  )}
                </TableCell>
                <TableCell sx={TD} align="right">
                  <PrintLineDiscount percent={l.discount1Percent} amount={l.discount1Amount} />
                </TableCell>
                <TableCell sx={TD} align="right">
                  <PrintLineDiscount percent={l.discount2Percent} amount={l.discount2Amount} />
                </TableCell>
                <TableCell sx={TD} align="right">
                  <PrintLineDiscount percent={l.discount3Percent} amount={l.discount3Amount} />
                </TableCell>
                <TableCell sx={TD} align="right">{formatMoney(l.netExclVat)}</TableCell>
                <TableCell sx={TD} align="right">
                  {formatMoney(l.vatAmount)}
                  <Typography sx={{ fontSize: 9.5, color: '#444' }}>{(l.vatRate * 100).toFixed(0)}%</Typography>
                </TableCell>
                <TableCell sx={TD} align="right">{formatMoney(l.totalInclVat)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* ---- totals ---- */}
        <Stack direction="row" sx={{ justifyContent: 'flex-end', mt: 1.5 }}>
          <Box sx={{ minWidth: 260 }}>
            <TotalRow label="Subtotal (excl. VAT)" value={formatMoney(invoice.subtotalExclVat)} />
            {invoice.totalDiscount > 0 && (
              <TotalRow label="Purchase discounts" value={`-${formatMoney(invoice.totalDiscount)}`} />
            )}
            {invoice.totalBonusValue > 0 && (
              <TotalRow
                label="Bonus goods (free - not charged or taxed)"
                value={formatMoney(invoice.totalBonusValue)}
              />
            )}
            {invoice.vatByRate.map((b) => (
              <TotalRow
                key={b.rate}
                label={`Input VAT ${b.rate > 0 ? `(${(b.rate * 100).toFixed(0)}%)` : '(zero-rated)'}`}
                value={formatMoney(b.vatAmount)}
              />
            ))}
            <Divider sx={{ my: 0.5 }} />
            <TotalRow label="Total incl. VAT (SAR)" value={formatMoney(invoice.totalInclVat)} bold />
          </Box>
        </Stack>

        {invoice.notes && (
          <Typography sx={{ fontSize: 10, mt: 1.5 }}>
            <strong>Notes / ملاحظات:</strong> {invoice.notes}
          </Typography>
        )}

        <Divider sx={{ mt: 2 }} />
        <Typography sx={{ fontSize: 9.5, color: '#444', mt: 0.75 }}>
          This is the buyer&apos;s goods-received record for{' '}
          {partyIsCustomer ? 'customer document' : 'supplier invoice'} {invoice.vendorInvoiceNo}.
          It is not a ZATCA tax invoice -{' '}
          {partyIsCustomer
            ? 'the customer\u2019s own document remains the legal record for this buy-back.'
            : 'the supplier\u2019s own tax invoice remains the legal document for the input VAT shown here.'}
        </Typography>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="outlined" startIcon={<PrintIcon />} onClick={() => window.print()}>
          Print A4
        </Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function PrintLineDiscount({ percent, amount }: { percent: number; amount: number }) {
  if (!(percent > 0)) return <>—</>;
  return (
    <>
      {formatDiscountPercent(percent)}
      <Typography sx={{ fontSize: 9.5, color: '#444' }}>{formatMoney(amount)}</Typography>
    </>
  );
}

function TotalRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
      <Typography sx={{ fontSize: bold ? 11 : 10, fontWeight: bold ? 700 : 400 }}>{label}</Typography>
      <Typography sx={{ fontSize: bold ? 11 : 10, fontWeight: bold ? 700 : 400 }}>{value}</Typography>
    </Stack>
  );
}
