// The owner's dashboard: one page that answers "what came in, what went out, what is left on the
// shelf, and who is buying". It reads the same posted records as Reports, so no figure is stored
// here twice. Purchases and purchase returns are split by PurchaseInvoice.isReturn and sales
// returns are their own list, which keeps every return a positive figure instead of a minus row.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import type SvgIcon from '@mui/material/SvgIcon';
import {
  Box, Button, Chip, Divider, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  Typography,
} from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import BarChartIcon from '@mui/icons-material/BarChart';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import AssignmentReturnIcon from '@mui/icons-material/AssignmentReturn';
import UndoIcon from '@mui/icons-material/Undo';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import PaidIcon from '@mui/icons-material/Paid';
import StorefrontIcon from '@mui/icons-material/Storefront';
import PeopleIcon from '@mui/icons-material/People';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import { useSalesStore } from '../../store/salesStore';
import { usePurchasingStore } from '../../store/purchasingStore';
import { useCatalogStore } from '../../store/catalogStore';
import { useCustomerStore } from '../../store/customerStore';
import { useSettingsStore } from '../../store/settingsStore';
import { formatQty, formatSar } from '../../utils/format';
import {
  latestActivity, monthlyTrend, summariseParties, summarisePurchases, summariseSales, summariseStock,
  withinPeriod,
} from '../../utils/analytics';
import type { NamedValue, TrendPoint } from '../../utils/analytics';

type PeriodKey = '30' | '90' | '365' | 'all';

const PERIOD_LABEL: Record<PeriodKey, string> = {
  '30': 'Last 30 days',
  '90': 'Last 90 days',
  '365': 'Last 12 months',
  all: 'All time',
};

// Shared identity: a tinted icon tile, a bold title and a one-line explanation, exactly like the
// Reports sections, so the dashboard reads as the same designed system rather than a new screen.
function SectionHeader({
  icon: Icon,
  color,
  title,
  subtitle,
  action,
}: {
  icon: typeof SvgIcon;
  color: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.5 }}>
      <Box
        sx={{
          display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: 1.5,
          color, bgcolor: `${color}14`, flex: '0 0 auto',
        }}
      >
        <Icon fontSize="small" />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>{title}</Typography>
        {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
      </Box>
      {action}
    </Box>
  );
}

function StatTile({
  icon: Icon,
  color,
  label,
  value,
  hint,
}: {
  icon: typeof SvgIcon;
  color: string;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        flex: '1 1 200px',
        minWidth: 190,
        transition: 'transform 150ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 150ms cubic-bezier(0.4, 0, 0.2, 1)',
        '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 6px 16px rgba(20, 18, 10, 0.08)' },
      }}
    >
      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
        <Box
          sx={{
            display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 1.5,
            color, bgcolor: `${color}14`, flex: '0 0 auto',
          }}
        >
          <Icon fontSize="small" />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" noWrap>{label}</Typography>
          <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>{value}</Typography>
          {hint && <Typography variant="caption" color="text.secondary" noWrap>{hint}</Typography>}
        </Box>
      </Stack>
    </Paper>
  );
}

function StatLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2, py: 0.5 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, textAlign: 'right' }}>{value}</Typography>
    </Stack>
  );
}

function BarList({
  rows,
  color,
  empty,
  formatValue = formatSar,
}: {
  rows: NamedValue[];
  color: string;
  empty: string;
  formatValue?: (value: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) {
    return <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>{empty}</Typography>;
  }
  return (
    <Stack spacing={1.25}>
      {rows.map((row) => (
        <Box key={row.name}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap title={row.name}>{row.name}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{formatValue(row.value)}</Typography>
          </Stack>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
            <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: 'divider', overflow: 'hidden' }}>
              <Box
                sx={{
                  width: `${Math.max(3, (row.value / max) * 100)}%`,
                  height: '100%',
                  borderRadius: 3,
                  bgcolor: color,
                  transition: 'width 400ms cubic-bezier(0.4, 0, 0.2, 1)',
                }}
              />
            </Box>
            {row.meta && <Typography variant="caption" color="text.secondary">{row.meta}</Typography>}
          </Box>
        </Box>
      ))}
    </Stack>
  );
}

// Four thin columns per month (sales, sales returns, purchases, purchase returns). Pure CSS bars keep
// the bundle free of a charting dependency while still showing the shape of the business.
const TREND_COLORS = {
  sales: '#2f7a52',
  salesReturns: '#e65100',
  purchases: '#5d4037',
  purchaseReturns: '#c62828',
};

function TrendChart({ points }: { points: TrendPoint[] }) {
  const max = Math.max(1, ...points.flatMap((p) => [p.sales, p.purchases, p.salesReturns, p.purchaseReturns]));
  const series: { key: keyof typeof TREND_COLORS; label: string }[] = [
    { key: 'sales', label: 'Sales' },
    { key: 'salesReturns', label: 'Sales returns' },
    { key: 'purchases', label: 'Purchases' },
    { key: 'purchaseReturns', label: 'Purchase returns' },
  ];
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: { xs: 1, sm: 2 }, height: 190, overflowX: 'auto', pb: 0.5 }}>
        {points.map((point) => (
          <Box key={point.key} sx={{ flex: 1, minWidth: 64 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, height: 160 }}>
              {series.map((s) => {
                const value = point[s.key];
                return (
                  <Box
                    key={s.key}
                    title={`${point.label} · ${s.label}: ${formatSar(value)}`}
                    sx={{
                      flex: 1,
                      height: value > 0 ? `${Math.max(2, (value / max) * 100)}%` : '2px',
                      bgcolor: value > 0 ? TREND_COLORS[s.key] : 'divider',
                      borderRadius: '4px 4px 0 0',
                      transition: 'height 400ms cubic-bezier(0.4, 0, 0.2, 1)',
                    }}
                  />
                );
              })}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 0.75 }}>
              {point.label}
            </Typography>
          </Box>
        ))}
      </Box>
      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', mt: 1, rowGap: 0.5 }}>
        {series.map((s) => (
          <Stack key={s.key} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: TREND_COLORS[s.key] }} />
            <Typography variant="caption" color="text.secondary">{s.label}</Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { invoices: sales, returns: salesReturns } = useSalesStore();
  const { invoices: purchaseDocs, vendors } = usePurchasingStore();
  const { items, batches } = useCatalogStore();
  const { customers } = useCustomerStore();
  const settings = useSettingsStore((s) => s.settings);

  const [period, setPeriod] = useState<PeriodKey>('90');
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const days = period === 'all' ? null : Number(period);

  const filteredSales = useMemo(
    () => sales.filter((s) => withinPeriod(s.date, days, today)),
    [sales, days, today]
  );
  const filteredSalesReturns = useMemo(
    () => salesReturns.filter((r) => withinPeriod(r.date, days, today)),
    [salesReturns, days, today]
  );
  const filteredPurchases = useMemo(
    () => purchaseDocs.filter((p) => withinPeriod(p.date, days, today)),
    [purchaseDocs, days, today]
  );

  const salesSummary = useMemo(
    () => summariseSales(filteredSales, filteredSalesReturns),
    [filteredSales, filteredSalesReturns]
  );
  const purchaseSummary = useMemo(() => summarisePurchases(filteredPurchases), [filteredPurchases]);
  const stockSummary = useMemo(() => summariseStock(items, batches, today), [items, batches, today]);
  const parties = useMemo(
    () => summariseParties(vendors, customers, filteredPurchases, filteredSales),
    [vendors, customers, filteredPurchases, filteredSales]
  );
  const trend = useMemo(
    () => monthlyTrend(sales, salesReturns, purchaseDocs, 6),
    [sales, salesReturns, purchaseDocs]
  );
  const anchor = useMemo(() => latestActivity(sales, salesReturns, purchaseDocs), [sales, salesReturns, purchaseDocs]);

  const salesPeriodLabel = anchor ? `Latest activity ${anchor.slice(0, 10)}` : 'No activity yet';

  return (
    <Box sx={{ p: 3 }}>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #dashboard-print-area, #dashboard-print-area * { visibility: visible; }
          #dashboard-print-area { position: absolute; left: 0; top: 0; width: 100%; padding: 12px; }
          #dashboard-print-controls { display: none; }
        }
      `}</style>

      {/* ---- header ---- */}
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>Business Dashboard</Typography>
          <Typography variant="body2" color="text.secondary">
            {settings.storeNameEn || 'Pharmacy'} · {settings.storeNameAr || ''} · {salesPeriodLabel}
          </Typography>
        </Box>
        <Stack id="dashboard-print-controls" direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Chip
            size="small"
            label="Live data"
            color="success"
            variant="outlined"
            sx={{ bgcolor: '#2f7a5210' }}
          />
          <Button variant="outlined" startIcon={<BarChartIcon />} onClick={() => navigate('/reports')}>
            Detailed reports
          </Button>
          <Button variant="outlined" startIcon={<PrintIcon />} onClick={() => window.print()}>
            Print
          </Button>
        </Stack>
      </Stack>

      {/* ---- period ---- */}
      <Stack id="dashboard-print-controls" direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 2 }}>
        {(Object.keys(PERIOD_LABEL) as PeriodKey[]).map((key) => (
          <Chip
            key={key}
            label={PERIOD_LABEL[key]}
            color={period === key ? 'primary' : 'default'}
            variant={period === key ? 'filled' : 'outlined'}
            onClick={() => setPeriod(key)}
            sx={{ cursor: 'pointer' }}
          />
        ))}
        <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center', ml: 1 }}>
          Stock figures are always the current shelf state.
        </Typography>
      </Stack>

      <Box id="dashboard-print-area">
        {/* ---- headline figures ---- */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3 }}>
          <StatTile
            icon={PointOfSaleIcon}
            color="#2e7d32"
            label="Net sales (incl. VAT)"
            value={formatSar(salesSummary.grossSales)}
            hint={`${salesSummary.invoiceCount} invoice${salesSummary.invoiceCount === 1 ? '' : 's'} · avg ${formatSar(salesSummary.avgBasket)}`}
          />
          <StatTile
            icon={ShoppingCartIcon}
            color="#5d4037"
            label="Purchases (incl. VAT)"
            value={formatSar(purchaseSummary.purchasesInclVat)}
            hint={`${purchaseSummary.invoiceCount} invoice${purchaseSummary.invoiceCount === 1 ? '' : 's'} · input VAT ${formatSar(purchaseSummary.vat)}`}
          />
          <StatTile
            icon={AssignmentReturnIcon}
            color="#e65100"
            label="Sales returns"
            value={formatSar(salesSummary.refunded)}
            hint={`${salesSummary.returnCount} return${salesSummary.returnCount === 1 ? '' : 's'} · ${(salesSummary.returnRate * 100).toFixed(1)}% of sales`}
          />
          <StatTile
            icon={UndoIcon}
            color="#c62828"
            label="Purchase returns"
            value={formatSar(purchaseSummary.credit)}
            hint={`${purchaseSummary.returnCount} return${purchaseSummary.returnCount === 1 ? '' : 's'} · ${(purchaseSummary.returnRate * 100).toFixed(1)}% of purchases`}
          />
          <StatTile
            icon={Inventory2Icon}
            color="#1565c0"
            label="Stock at cost"
            value={formatSar(stockSummary.costValue)}
            hint={`${formatQty(stockSummary.units)} units · ${stockSummary.batchCount} batches`}
          />
          <StatTile
            icon={PaidIcon}
            color="#00838f"
            label="Stock at retail"
            value={formatSar(stockSummary.retailValue)}
            hint={`Potential margin ${formatSar(stockSummary.margin)}`}
          />
        </Box>

        {/* ---- trend ---- */}
        <Paper variant="outlined" sx={{ p: 2.5, mb: 2 }}>
          <SectionHeader
            icon={BarChartIcon}
            color="#1565c0"
            title="Sales & Purchasing — last 6 months"
            subtitle="Returns are drawn as their own positive bars, never subtracted from the sale or purchase"
          />
          <TrendChart points={trend} />
        </Paper>

        {/* ---- goods + stock watch ---- */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' }, gap: 2, mb: 2 }}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <SectionHeader
              icon={Inventory2Icon}
              color="#1565c0"
              title="Goods on the Shelf"
              subtitle="Cost value by category, from the live batches"
            />
            <Stack direction="row" spacing={3} sx={{ mb: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">Items</Typography>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{stockSummary.itemCount}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Units on hand</Typography>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{formatQty(stockSummary.units)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">At cost</Typography>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{formatSar(stockSummary.costValue)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">At retail</Typography>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{formatSar(stockSummary.retailValue)}</Typography>
              </Box>
            </Stack>
            <Divider sx={{ mb: 1.5 }} />
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              Cost value by category
            </Typography>
            <Box sx={{ mt: 1 }}>
              <BarList
                rows={stockSummary.byCategory}
                color="#1565c0"
                empty="No stock on the shelf yet."
              />
            </Box>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <SectionHeader
              icon={WarningAmberIcon}
              color="#b8862c"
              title="Stock Watch"
              subtitle="Items at or below reorder level, and batches that have expired or expire within 90 days"
            />
            <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
              <Chip size="small" color="warning" variant="outlined" label={`${stockSummary.lowStock.length} low stock`} />
              <Chip size="small" color="error" variant="outlined" label={`${stockSummary.expiring.length} expired / near expiry`} />
            </Stack>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Item</TableCell>
                  <TableCell align="right">On hand</TableCell>
                  <TableCell align="right">Reorder</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {stockSummary.lowStock.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                        Every item is above its reorder level.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {stockSummary.lowStock.map((row) => (
                  <TableRow key={row.name} hover>
                    <TableCell>{row.name}</TableCell>
                    <TableCell align="right">{formatQty(row.qty)}</TableCell>
                    <TableCell align="right">{formatQty(row.reorderLevel)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Divider sx={{ my: 1.5 }} />
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
              <EventBusyIcon fontSize="small" sx={{ color: '#c62828' }} />
              <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Expired / expiring within 90 days
              </Typography>
            </Stack>
            {stockSummary.expiring.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No batch is close to expiry.</Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Item</TableCell>
                    <TableCell>Batch</TableCell>
                    <TableCell>Expiry</TableCell>
                    <TableCell align="right">Qty</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {stockSummary.expiring.map((row) => (
                    <TableRow key={`${row.name}-${row.batchNo}`} hover>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>{row.batchNo}</TableCell>
                      <TableCell>{row.expiryDate}</TableCell>
                      <TableCell align="right">{formatQty(row.qty)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Paper>
        </Box>

        {/* ---- sales + purchases ---- */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' }, gap: 2, mb: 2 }}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <SectionHeader
              icon={PointOfSaleIcon}
              color="#2e7d32"
              title="Sales Analysis"
              subtitle={`${salesSummary.invoiceCount} invoices · ${formatQty(salesSummary.itemsSold)} units sold`}
            />
            <Stack spacing={0.25} sx={{ mb: 1.5 }}>
              <StatLine label="Gross sales (incl. VAT)" value={formatSar(salesSummary.grossSales)} />
              <StatLine label="Net excl. VAT" value={formatSar(salesSummary.netExclVat)} />
              <StatLine label="Output VAT" value={formatSar(salesSummary.vat)} />
              <StatLine label="Average basket" value={formatSar(salesSummary.avgBasket)} />
              <StatLine label="Sales returns" value={`${formatSar(salesSummary.refunded)} · ${formatQty(salesSummary.returnedUnits)} units`} />
            </Stack>
            <Divider sx={{ mb: 1.5 }} />
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              Payment mix
            </Typography>
            <Box sx={{ mt: 1, mb: 2 }}>
              <BarList rows={salesSummary.byPayment} color="#2f7a52" empty="No payments recorded in this period." />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              Top items by sales
            </Typography>
            <Box sx={{ mt: 1 }}>
              <BarList rows={salesSummary.topItems} color="#1565c0" empty="No items sold in this period." />
            </Box>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <SectionHeader
              icon={ShoppingCartIcon}
              color="#5d4037"
              title="Purchasing Analysis"
              subtitle={`${purchaseSummary.invoiceCount} invoices · ${formatQty(purchaseSummary.paidUnits)} paid units + ${formatQty(purchaseSummary.bonusUnits)} bonus`}
            />
            <Stack spacing={0.25} sx={{ mb: 1.5 }}>
              <StatLine label="Purchases (incl. VAT)" value={formatSar(purchaseSummary.purchasesInclVat)} />
              <StatLine label="Net excl. VAT" value={formatSar(purchaseSummary.purchasesExclVat)} />
              <StatLine label="Input VAT" value={formatSar(purchaseSummary.vat)} />
              <StatLine label="Purchase returns" value={`${formatSar(purchaseSummary.credit)} · ${formatQty(purchaseSummary.returnedUnits)} units`} />
            </Stack>
            <Divider sx={{ mb: 1.5 }} />
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              Top suppliers by purchases
            </Typography>
            <Box sx={{ mt: 1 }}>
              <BarList rows={purchaseSummary.topVendors} color="#5d4037" empty="No purchases in this period." />
            </Box>
          </Paper>
        </Box>

        {/* ---- returns + parties ---- */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}> 
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <SectionHeader
              icon={AssignmentReturnIcon}
              color="#e65100"
              title="Returns Watch"
              subtitle="What came back in and what went back to suppliers"
            />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: '#e6510008', border: '1px solid', borderColor: '#e6510022' }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                  <AssignmentReturnIcon fontSize="small" sx={{ color: '#e65100' }} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Sales returns</Typography>
                </Stack>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{formatSar(salesSummary.refunded)}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                  {salesSummary.returnCount} return{salesSummary.returnCount === 1 ? '' : 's'} · {(salesSummary.returnRate * 100).toFixed(1)}% of sales
                </Typography>
                <StatLine label="Units returned" value={formatQty(salesSummary.returnedUnits)} />
              </Box>
              <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: '#c6282808', border: '1px solid', borderColor: '#c6282822' }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                  <UndoIcon fontSize="small" sx={{ color: '#c62828' }} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Purchase returns</Typography>
                </Stack>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{formatSar(purchaseSummary.credit)}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                  {purchaseSummary.returnCount} return{purchaseSummary.returnCount === 1 ? '' : 's'} · {(purchaseSummary.returnRate * 100).toFixed(1)}% of purchases
                </Typography>
                <StatLine label="Units returned" value={formatQty(purchaseSummary.returnedUnits)} />
              </Box>
            </Box>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <SectionHeader
              icon={StorefrontIcon}
              color="#4527a0"
              title="Vendors & Customers"
              subtitle={`${parties.activeVendorCount} active vendors · ${parties.customerCount} customer accounts`}
            />
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              Top vendors by purchases
            </Typography>
            <Box sx={{ mt: 1, mb: 2 }}>
              <BarList rows={parties.topVendors} color="#4527a0" empty="No supplier purchases yet." />
            </Box>
            <Divider sx={{ mb: 1.5 }} />
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
              <PeopleIcon fontSize="small" sx={{ color: '#00838f' }} />
              <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Top customers by spend
              </Typography>
            </Stack>
            <BarList rows={parties.topCustomers} color="#00838f" empty="No identified customer sales yet." />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
              {formatQty(parties.loyaltyPoints)} loyalty points outstanding across customers.
            </Typography>
          </Paper>
        </Box>
      </Box>
    </Box>
  );
}
