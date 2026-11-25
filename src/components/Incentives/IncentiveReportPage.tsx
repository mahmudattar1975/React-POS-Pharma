import { useState, useEffect } from 'react';
import {
  Box, Typography, Paper, Table, TableHead, TableRow, TableCell, TableBody, Stack, TextField,
  Button, Card, CardContent,
} from '@mui/material';
import { useCatalogStore } from '../../store/catalogStore';
import { fetchIncentiveReport, fetchIncentiveSummary } from '../../api/incentiveApi';
import type { IncentiveRecord, IncentiveSummary } from '../../types/incentive';
import { formatMoney } from '../../utils/format';
import { formatDiscountPercent } from '../../utils/purchasing';

export default function IncentiveReportPage() {
  const { items: catalogItems } = useCatalogStore();
  const [from, setFrom] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [cashier, setCashier] = useState('');
  const [itemId, setItemId] = useState('');
  const [records, setRecords] = useState<IncentiveRecord[]>([]);
  const [summary, setSummary] = useState<{ days: IncentiveSummary[]; totals: { invoiceCount: number; totalSaleAmount: number; totalIncentive: number } } | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [recs, summ] = await Promise.all([
        fetchIncentiveReport({ from, to, cashier: cashier || undefined, itemId: itemId || undefined }),
        fetchIncentiveSummary({ from, to }),
      ]);
      setRecords(recs);
      setSummary(summ);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function exportCsv() {
    const header = ['Date', 'Invoice', 'Item', 'Qty', 'Sale Amount', 'Type', 'Rate', 'Incentive', 'Cashier'];
    const rows = records.map((r) => [
      r.invoiceDate.slice(0, 10),
      r.invoiceNo,
      r.itemNameEn,
      r.qty,
      r.saleAmount.toFixed(2),
      r.incentiveType,
      r.rate,
      r.incentiveAmount.toFixed(2),
      r.cashierName,
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `incentive-report-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Report rows carry the dotnet_pos barcode as itemId; older rows may still carry a catalog id.
  const itemName = (id: string) => catalogItems.find((i) => i.barcode === id || i.id === id)?.nameEn ?? id;

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Incentive Report (حافز)</Typography>
        <Button variant="outlined" onClick={exportCsv} disabled={records.length === 0}>Export CSV</Button>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
          <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} size="small" />
          <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} size="small" />
          <TextField label="Cashier" value={cashier} onChange={(e) => setCashier(e.target.value)} size="small" />
          <TextField label="Item" value={itemId} onChange={(e) => setItemId(e.target.value)} size="small" placeholder="barcode" />
          <Button variant="contained" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Apply'}</Button>
        </Stack>
      </Paper>

      {summary && (
        <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
          <Card sx={{ minWidth: 160 }}>
            <CardContent>
              <Typography variant="caption" color="text.secondary">Invoices</Typography>
              <Typography variant="h6">{summary.totals.invoiceCount}</Typography>
            </CardContent>
          </Card>
          <Card sx={{ minWidth: 160 }}>
            <CardContent>
              <Typography variant="caption" color="text.secondary">Total Sales</Typography>
              <Typography variant="h6">{formatMoney(summary.totals.totalSaleAmount)}</Typography>
            </CardContent>
          </Card>
          <Card sx={{ minWidth: 160 }}>
            <CardContent>
              <Typography variant="caption" color="text.secondary">Total Incentive</Typography>
              <Typography variant="h6" color="success.main">{formatMoney(summary.totals.totalIncentive)}</Typography>
            </CardContent>
          </Card>
        </Stack>
      )}

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Invoice</TableCell>
              <TableCell>Item</TableCell>
              <TableCell>Qty</TableCell>
              <TableCell>Sale Amount</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Rate</TableCell>
              <TableCell>Incentive</TableCell>
              <TableCell>Cashier</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {records.length === 0 && (
              <TableRow>
                <TableCell colSpan={9}>
                  <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                    No incentive records for this range.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {records.map((r) => (
              <TableRow key={r.id} hover>
                <TableCell>{r.invoiceDate.slice(0, 10)}</TableCell>
                <TableCell>{r.invoiceNo}</TableCell>
                <TableCell>{r.itemNameEn} ({itemName(r.itemId)})</TableCell>
                <TableCell>{r.qty}</TableCell>
                <TableCell>{formatMoney(r.saleAmount)}</TableCell>
                <TableCell>{r.incentiveType}</TableCell>
                <TableCell>{r.incentiveType === 'percent' ? formatDiscountPercent(r.rate) : formatMoney(r.rate)}</TableCell>
                <TableCell>{formatMoney(r.incentiveAmount)}</TableCell>
                <TableCell>{r.cashierName}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      {summary && summary.days.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>Daily summary</Typography>
          <Paper variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Invoices</TableCell>
                  <TableCell>Sale Amount</TableCell>
                  <TableCell>Incentive</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {summary.days.map((d) => (
                  <TableRow key={d.date}>
                    <TableCell>{d.date}</TableCell>
                    <TableCell>{d.invoiceCount}</TableCell>
                    <TableCell>{formatMoney(d.totalSaleAmount)}</TableCell>
                    <TableCell>{formatMoney(d.totalIncentive)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </Box>
      )}
    </Box>
  );
}
