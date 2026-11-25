import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, Paper, Table, TableHead, TableRow, TableCell, TableBody, Button, Chip } from '@mui/material';
import type SvgIcon from '@mui/material/SvgIcon';
import PrintIcon from '@mui/icons-material/Print';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import CardGiftcardIcon from '@mui/icons-material/CardGiftcard';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import AssignmentReturnIcon from '@mui/icons-material/AssignmentReturn';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import PaidIcon from '@mui/icons-material/Paid';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import StarsIcon from '@mui/icons-material/Stars';
import { useSalesStore } from '../../store/salesStore';
import { useCustomerStore } from '../../store/customerStore';
import { useCatalogStore } from '../../store/catalogStore';
import { round2 } from '../../utils/vat';
import { pointsToSar } from '../../utils/loyalty';
import { formatMoney, formatQty, formatSar, formatUnitPrice } from '../../utils/format';
import { summariseStagnant } from '../../utils/analytics';

import { T, useT } from '../../i18n';
// Each report gets its own name and a coloured icon, so the page reads as a set of separate
// reports rather than one long table. The tint is the same hue at low opacity so the icon never
// competes with the figures.
function SectionTitle({
  icon: Icon,
  color,
  title,
  subtitle,
}: {
  icon: typeof SvgIcon;
  color: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mt: 3, mb: 1 }}>
      <Box
        sx={{
          display: 'grid',
          placeItems: 'center',
          width: 36,
          height: 36,
          borderRadius: 1.5,
          color,
          bgcolor: `${color}14`,
          flex: '0 0 auto',
        }}
      >
        <Icon fontSize="small" />
      </Box>
      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>{title}</Typography>
        {subtitle && (
          <Typography variant="caption" color="text.secondary">{subtitle}</Typography>
        )}
      </Box>
    </Box>
  );
}

export default function ReportsPage() {
  const tr = useT();
  const navigate = useNavigate();
  const { invoices } = useSalesStore();
  const { customers } = useCustomerStore();
  const { receivingLog, items, batches } = useCatalogStore();

  // Receiving events include purchase returns as negative quantities. They are NOT netted into the
  // stock report: a return gets its own report below and is shown as a positive "units returned"
  // figure, so no report ever prints a minus sign.
  const stockReceived = useMemo(() => {
    const rows = receivingLog.filter((r) => r.qty > 0);
    return {
      rows: rows.slice().reverse(),
      events: rows.length,
      units: rows.reduce((s, r) => s + r.qty, 0),
      cost: round2(rows.reduce((s, r) => s + r.qty * r.costPrice, 0)),
      vendorCount: rows.filter((r) => r.source === 'vendor').length,
      headOfficeCount: rows.filter((r) => r.source === 'head_office').length,
    };
  }, [receivingLog]);

  const purchaseReturns = useMemo(() => {
    const rows = receivingLog.filter((r) => r.qty < 0);
    return {
      rows: rows.slice().reverse(),
      events: rows.length,
      units: rows.reduce((s, r) => s + Math.abs(r.qty), 0),
      credit: round2(rows.reduce((s, r) => s + Math.abs(r.qty) * r.costPrice, 0)),
    };
  }, [receivingLog]);

  // Dead stock is a full report of its own: stock still on the shelf with no sale for 90 days.
  // The window is fixed so the report always answers the same question, whatever month it is run.
  const stagnant = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return summariseStagnant(items, batches, invoices, 90, today);
  }, [items, batches, invoices]);

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

  const kpis = [
    { label: 'Invoices', value: grand.count, icon: ReceiptLongIcon, color: '#1565c0' },
    { label: 'Total Sales (incl. VAT)', value: formatSar(grand.total), icon: PaidIcon, color: '#2e7d32' },
    { label: 'Total VAT Collected', value: formatSar(grand.vat), icon: AccountBalanceIcon, color: '#6a1b9a' },
    { label: 'Net Points Earned', value: pointsSummary.earned, icon: StarsIcon, color: '#e65100' },
    { label: 'Net Points Redeemed', value: pointsSummary.redeemed, icon: CardGiftcardIcon, color: '#00838f' },
  ];

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
        <Typography variant="h5" sx={{ fontWeight: 700 }}><T>Reports</T></Typography>
        <Box id="reports-print-hide" sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" onClick={() => navigate('/wasfaty-claims')}>
            <T>Wasfaty / NUPCO claims</T>
          </Button>
          <Button variant="outlined" startIcon={<PrintIcon />} onClick={() => window.print()}>
            <T>Print</T>
          </Button>
        </Box>
      </Box>

      <Box id="reports-print-area">
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Paper
              key={kpi.label}
              variant="outlined"
              sx={{
                p: 2,
                flex: '1 1 220px',
                transition: 'transform 150ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 150ms cubic-bezier(0.4, 0, 0.2, 1)',
                '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 6px 16px rgba(20, 18, 10, 0.08)' },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                <Box
                  sx={{
                    display: 'grid',
                    placeItems: 'center',
                    width: 38,
                    height: 38,
                    borderRadius: 1.5,
                    color: kpi.color,
                    bgcolor: `${kpi.color}14`,
                    flex: '0 0 auto',
                  }}
                >
                  <Icon fontSize="small" />
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary">{kpi.label}</Typography>
                  <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2 }}>{kpi.value}</Typography>
                </Box>
              </Box>
            </Paper>
          );
        })}
      </Box>

      <SectionTitle
        icon={PointOfSaleIcon}
        color="#1565c0"
        title={tr('Sales Summary by Day')}
        subtitle="Invoices, subtotal, VAT and total for each selling day"
      />
      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell><T>Date</T></TableCell>
              <TableCell align="right"><T>Invoices</T></TableCell>
              <TableCell align="right"><T>Subtotal (excl. VAT)</T></TableCell>
              <TableCell align="right"><T>VAT</T></TableCell>
              <TableCell align="right"><T>Total (incl. VAT)</T></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {byDate.length === 0 && (
              <TableRow><TableCell colSpan={5}><Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}><T>No sales recorded yet.</T></Typography></TableCell></TableRow>
            )}
            {byDate.map(([day, row]) => (
              <TableRow key={day} hover>
                <TableCell>{day}</TableCell>
                <TableCell align="right">{row.count}</TableCell>
                <TableCell align="right">{formatMoney(row.subtotal)}</TableCell>
                <TableCell align="right">{formatMoney(row.vat)}</TableCell>
                <TableCell align="right">{formatMoney(row.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <SectionTitle
        icon={CardGiftcardIcon}
        color="#e65100"
        title={tr('Customer Loyalty Points')}
        subtitle="Points still held by each customer and their value"
      />
      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell><T>Customer</T></TableCell>
              <TableCell><T>Phone</T></TableCell>
              <TableCell align="right"><T>Points</T></TableCell>
              <TableCell align="right"><T>Value (SAR)</T></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {customerBalances.length === 0 && (
              <TableRow><TableCell colSpan={4}><Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}><T>No customer holds a points balance yet.</T></Typography></TableCell></TableRow>
            )}
            {customerBalances.map((c) => (
              <TableRow key={c.id} hover>
                <TableCell>{c.nameEn}</TableCell>
                <TableCell>{c.phone}</TableCell>
                <TableCell align="right">{c.loyaltyPoints}</TableCell>
                <TableCell align="right">{formatMoney(pointsToSar(c.loyaltyPoints))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <SectionTitle
        icon={ReceiptLongIcon}
        color="#2e7d32"
        title={tr('Sales Invoices')}
        subtitle="Every posted sale with its type and status"
      />
      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell><T>Invoice No.</T></TableCell>
              <TableCell><T>Date</T></TableCell>
              <TableCell><T>Type</T></TableCell>
              <TableCell><T>Customer</T></TableCell>
              <TableCell><T>Status</T></TableCell>
              <TableCell align="right"><T>Total</T></TableCell>
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
                <TableCell align="right">{formatMoney(inv.totalInclVat)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <SectionTitle
        icon={Inventory2Icon}
        color="#5d4037"
        title={tr('Stock Received')}
        subtitle="Purchases and head-office deliveries that added units to the shelf"
      />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2 }}>
        {[
          { label: tr("Receiving Events"), value: stockReceived.events },
          { label: tr("Total Units Received"), value: formatQty(stockReceived.units) },
          { label: tr("Total Cost Value"), value: formatSar(stockReceived.cost) },
          { label: tr("From Vendors"), value: stockReceived.vendorCount },
          { label: tr("From Head Office"), value: stockReceived.headOfficeCount },
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
              <TableCell><T>Date</T></TableCell>
              <TableCell><T>Item</T></TableCell>
              <TableCell><T>Batch No.</T></TableCell>
              <TableCell><T>Expiry</T></TableCell>
              <TableCell align="right"><T>Qty Received</T></TableCell>
              <TableCell><T>Source</T></TableCell>
              <TableCell><T>Transfer No.</T></TableCell>
              <TableCell align="right"><T>Cost/Unit</T></TableCell>
              <TableCell align="right"><T>Total Cost</T></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {stockReceived.rows.length === 0 && (
              <TableRow><TableCell colSpan={9}><Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}><T>No stock has been received yet.</T></Typography></TableCell></TableRow>
            )}
            {stockReceived.rows.map((r) => (
              <TableRow key={r.id} hover>
                <TableCell>{new Date(r.date).toLocaleString()}</TableCell>
                <TableCell>{r.itemNameEn || r.itemNameAr}</TableCell>
                <TableCell>{r.batchNo}</TableCell>
                <TableCell>{r.expiryDate ?? '—'}</TableCell>
                <TableCell align="right">{formatQty(r.qty)}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={r.source === 'vendor' ? 'Vendor' : 'Head Office'}
                    color={r.source === 'vendor' ? 'default' : 'info'}
                  />
                </TableCell>
                <TableCell>{r.transferNo ?? '-'}</TableCell>
                <TableCell align="right">{formatUnitPrice(r.costPrice)}</TableCell>
                <TableCell align="right">{formatMoney(r.qty * r.costPrice)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <SectionTitle
        icon={AssignmentReturnIcon}
        color="#c62828"
        title={tr('Purchase Returns')}
        subtitle="Units sent back to suppliers, shown separately with positive quantities"
      />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2 }}>
        {[
          { label: tr("Return Events"), value: purchaseReturns.events },
          { label: tr("Total Units Returned"), value: formatQty(purchaseReturns.units) },
          { label: tr("Total Credit Value"), value: formatSar(purchaseReturns.credit) },
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
              <TableCell><T>Date</T></TableCell>
              <TableCell><T>Item</T></TableCell>
              <TableCell><T>Batch No.</T></TableCell>
              <TableCell><T>Expiry</T></TableCell>
              <TableCell align="right"><T>Qty Returned</T></TableCell>
              <TableCell><T>Source</T></TableCell>
              <TableCell align="right"><T>Cost/Unit</T></TableCell>
              <TableCell align="right"><T>Total Credit</T></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {purchaseReturns.rows.length === 0 && (
              <TableRow><TableCell colSpan={8}><Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}><T>No purchase returns posted yet.</T></Typography></TableCell></TableRow>
            )}
            {purchaseReturns.rows.map((r) => (
              <TableRow key={r.id} hover>
                <TableCell>{new Date(r.date).toLocaleString()}</TableCell>
                <TableCell>{r.itemNameEn || r.itemNameAr}</TableCell>
                <TableCell>{r.batchNo}</TableCell>
                <TableCell>{r.expiryDate ?? '—'}</TableCell>
                <TableCell align="right">{formatQty(Math.abs(r.qty))}</TableCell>
                <TableCell>
                  <Chip size="small" label={tr('Vendor return')} color="error" variant="outlined" />
                </TableCell>
                <TableCell align="right">{formatUnitPrice(r.costPrice)}</TableCell>
                <TableCell align="right">{formatMoney(Math.abs(r.qty * r.costPrice))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <SectionTitle
        icon={HourglassEmptyIcon}
        color="#b8862c"
        title={tr('Stagnant Items')}
        subtitle="Stock still on the shelf with no sale in the last 90 days"
      />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2 }}>
        {[
          { label: 'Stagnant Items', value: stagnant.count },
          { label: tr("Units Tied Up"), value: formatQty(stagnant.units) },
          { label: tr("Cost Value"), value: formatSar(stagnant.costValue) },
          { label: tr("Retail Value"), value: formatSar(stagnant.retailValue) },
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
              <TableCell><T>Item</T></TableCell>
              <TableCell><T>Category</T></TableCell>
              <TableCell align="right"><T>Qty on Hand</T></TableCell>
              <TableCell align="right"><T>Cost Value</T></TableCell>
              <TableCell align="right"><T>Retail Value</T></TableCell>
              <TableCell><T>Last Sold</T></TableCell>
              <TableCell align="right"><T>Days Idle</T></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {stagnant.rows.length === 0 && (
              <TableRow><TableCell colSpan={7}><Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}><T>Every item in stock has sold within the last 90 days.</T></Typography></TableCell></TableRow>
            )}
            {stagnant.rows.map((row) => (
              <TableRow key={row.itemId} hover>
                <TableCell>{row.name}</TableCell>
                <TableCell>{row.category || '—'}</TableCell>
                <TableCell align="right">{formatQty(row.qtyOnHand)}</TableCell>
                <TableCell align="right">{formatMoney(row.costValue)}</TableCell>
                <TableCell align="right">{formatMoney(row.retailValue)}</TableCell>
                <TableCell>{row.lastSoldDate ?? tr("Never sold")}</TableCell>
                <TableCell align="right">{row.daysIdle === null ? '—' : formatQty(row.daysIdle)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
      </Box>
    </Box>
  );
}
