import { useMemo } from 'react';
import { Box, Typography, Paper, Table, TableHead, TableRow, TableCell, TableBody, Button, Chip } from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import { useSalesStore } from '../../store/salesStore';
import { useCustomerStore } from '../../store/customerStore';
import { useCatalogStore } from '../../store/catalogStore';
import { round2 } from '../../utils/vat';
import { pointsToSar } from '../../utils/loyalty';

export default function ReportsPage() {
  const { invoices } = useSalesStore();
  const { customers } = useCustomerStore();
  const { receivingLog } = useCatalogStore();

  const receivingSummary = useMemo(() => {
    const totalQty = receivingLog.reduce((s, r) => s + r.qty, 0);
    const totalCost = round2(receivingLog.reduce((s, r) => s + r.qty * r.costPrice, 0));
    const vendorCount = receivingLog.filter((r) => r.source === 'vendor').length;
    const headOfficeCount = receivingLog.filter((r) => r.source === 'head_office').length;
    return { totalQty, totalCost, vendorCount, headOfficeCount };
  }, [receivingLog]);

  const receivingRows = useMemo(() => receivingLog.slice().reverse(), [receivingLog]);

  // Net of any return clawback/refund already applied - see ReturnsPage's cumulative-ratio
  // logic, which keeps pointsEarnedClawedBack/pointsRedeemedRefunded in step with returns.
  const pointsSummary = useMemo(() => {
    let earned = 0;
    let redeemed = 0;
    for (const inv of invoices) {
      earned += (inv.pointsEarned ?? 0) - (inv.pointsEarnedClawedBack ?? 0);
      redeemed += (inv.pointsRedeemed ?? 0) - (inv.pointsRedeemedRefunded ?? 0);
    }
    return { earned, redeemed };
  }, [invoices]);

  const customerBalances = useMemo(
    () => customers.filter((c) => c.phone && c.loyaltyPoints > 0).sort((a, b) => b.loyaltyPoints - a.loyaltyPoints),
    [customers]
  );

  const byDate = useMemo(() => {
    const map = new Map<string, { count: number; subtotal: number; vat: number; total: number }>();
    for (const inv of invoices) {
      const day = inv.date.slice(0, 10);
      const row = map.get(day) ?? { count: 0, subtotal: 0, vat: 0, total: 0 };
      row.count += 1;
      row.subtotal = round2(row.subtotal + inv.subtotalExclVat);
      row.vat = round2(row.vat + inv.totalVatAmount);
      row.total = round2(row.total + inv.totalInclVat);
      map.set(day, row);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [invoices]);

  const grand = useMemo(
    () => ({
      count: invoices.length,
      total: round2(invoices.reduce((s, i) => s + i.totalInclVat, 0)),
      vat: round2(invoices.reduce((s, i) => s + i.totalVatAmount, 0)),
    }),
    [invoices]
  );

  return (
    <Box sx={{ p: 3 }}>
      {/* Print the whole report (every section below), not just one table - the standard "hide
          everything, then re-reveal one subtree" trick also used by ReceiptView.tsx. No fixed
          @page size needed here (unlike the 80mm receipt) - plain A4/Letter portrait paginates a
          multi-section report fine on its own. */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #reports-print-area, #reports-print-area * { visibility: visible; }
          #reports-print-area { position: absolute; left: 0; top: 0; width: 100%; padding: 12px; }
          #reports-print-hide { display: none; }
        }
      `}</style>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Reports</Typography>
        <Button id="reports-print-hide" variant="outlined" startIcon={<PrintIcon />} onClick={() => window.print()}>
          Print
        </Button>
      </Box>

      <Box id="reports-print-area">
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        {[
          { label: 'Invoices', value: grand.count },
          { label: 'Total Sales (incl. VAT)', value: `SAR ${grand.total.toFixed(2)}` },
          { label: 'Total VAT Collected', value: `SAR ${grand.vat.toFixed(2)}` },
          { label: 'Net Points Earned', value: pointsSummary.earned },
          { label: 'Net Points Redeemed', value: pointsSummary.redeemed },
        ].map((s) => (
          <Paper
            key={s.label}
            variant="outlined"
            sx={{
              p: 2,
              flex: '1 1 220px',
              transition: 'transform 150ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 150ms cubic-bezier(0.4, 0, 0.2, 1)',
              '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 6px 16px rgba(20, 18, 10, 0.08)' },
            }}
          >
            <Typography variant="caption" color="text.secondary">{s.label}</Typography>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>{s.value}</Typography>
          </Paper>
        ))}
      </Box>

      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Daily Sales &amp; VAT Summary</Typography>
      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell align="right">Invoices</TableCell>
              <TableCell align="right">Subtotal (excl. VAT)</TableCell>
              <TableCell align="right">VAT</TableCell>
              <TableCell align="right">Total (incl. VAT)</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {byDate.length === 0 && (
              <TableRow><TableCell colSpan={5}><Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>No sales recorded yet.</Typography></TableCell></TableRow>
            )}
            {byDate.map(([day, row]) => (
              <TableRow key={day} hover>
                <TableCell>{day}</TableCell>
                <TableCell align="right">{row.count}</TableCell>
                <TableCell align="right">{row.subtotal.toFixed(2)}</TableCell>
                <TableCell align="right">{row.vat.toFixed(2)}</TableCell>
                <TableCell align="right">{row.total.toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Typography variant="subtitle1" sx={{ fontWeight: 600, mt: 3, mb: 1 }}>Loyalty Points Balances</Typography>
      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Customer</TableCell>
              <TableCell>Phone</TableCell>
              <TableCell align="right">Points</TableCell>
              <TableCell align="right">Value (SAR)</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {customerBalances.length === 0 && (
              <TableRow><TableCell colSpan={4}><Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>No customer holds a points balance yet.</Typography></TableCell></TableRow>
            )}
            {customerBalances.map((c) => (
              <TableRow key={c.id} hover>
                <TableCell>{c.nameEn}</TableCell>
                <TableCell>{c.phone}</TableCell>
                <TableCell align="right">{c.loyaltyPoints}</TableCell>
                <TableCell align="right">{pointsToSar(c.loyaltyPoints).toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Typography variant="subtitle1" sx={{ fontWeight: 600, mt: 3, mb: 1 }}>All Invoices</Typography>
      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Invoice No.</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Customer</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Total</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {invoices.slice().reverse().map((inv) => (
              <TableRow key={inv.id} hover>
                <TableCell>{inv.invoiceNo}</TableCell>
                <TableCell>{new Date(inv.date).toLocaleString()}</TableCell>
                <TableCell>{inv.invoiceType}</TableCell>
                <TableCell>{inv.customerNameEn || inv.customerNameAr}</TableCell>
                <TableCell>{inv.status}</TableCell>
                <TableCell align="right">{inv.totalInclVat.toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Typography variant="subtitle1" sx={{ fontWeight: 600, mt: 3, mb: 1 }}>Goods Received</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2 }}>
        {[
          { label: 'Receiving Events', value: receivingLog.length },
          { label: 'Total Units Received', value: receivingSummary.totalQty },
          { label: 'Total Cost Value', value: `SAR ${receivingSummary.totalCost.toFixed(2)}` },
          { label: 'From Vendors', value: receivingSummary.vendorCount },
          { label: 'From Head Office', value: receivingSummary.headOfficeCount },
        ].map((s) => (
          <Paper key={s.label} variant="outlined" sx={{ p: 2, flex: '1 1 180px' }}>
            <Typography variant="caption" color="text.secondary">{s.label}</Typography>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>{s.value}</Typography>
          </Paper>
        ))}
      </Box>
      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Item</TableCell>
              <TableCell>Batch No.</TableCell>
              <TableCell>Expiry</TableCell>
              <TableCell align="right">Qty</TableCell>
              <TableCell>Source</TableCell>
              <TableCell>Transfer No.</TableCell>
              <TableCell align="right">Cost/Unit</TableCell>
              <TableCell align="right">Total Cost</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {receivingRows.length === 0 && (
              <TableRow><TableCell colSpan={9}><Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>No stock has been received yet.</Typography></TableCell></TableRow>
            )}
            {receivingRows.map((r) => (
              <TableRow key={r.id} hover>
                <TableCell>{new Date(r.date).toLocaleString()}</TableCell>
                <TableCell>{r.itemNameEn || r.itemNameAr}</TableCell>
                <TableCell>{r.batchNo}</TableCell>
                <TableCell>{r.expiryDate}</TableCell>
                <TableCell align="right">{r.qty}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={r.source === 'vendor' ? 'Vendor' : 'Head Office'}
                    color={r.source === 'vendor' ? 'default' : 'info'}
                  />
                </TableCell>
                <TableCell>{r.transferNo ?? '-'}</TableCell>
                <TableCell align="right">{r.costPrice.toFixed(3)}</TableCell>
                <TableCell align="right">{(r.qty * r.costPrice).toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
      </Box>
    </Box>
  );
}
