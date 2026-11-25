import { useState, useEffect } from 'react';
import {
  Box, Typography, Paper, Table, TableHead, TableRow, TableCell, TableBody, Stack, TextField,
  Button,
} from '@mui/material';
import { fetchIncentiveReport, fetchIncentiveSummary } from '../../api/incentiveApi';
import type { IncentiveRecord, IncentiveSummary } from '../../types/incentive';
import { formatMoney } from '../../utils/format';

const C = {
  bg: '#f6f4ef',
  surface: '#ffffff',
  ink: '#1a1a1a',
  muted: '#6b6560',
  teal: '#0d5c63',
  gold: '#b8860b',
  border: '#e2ddd3',
  hover: '#f0ece3',
};

export default function IncentiveReportPage() {
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

  return (
    <Box sx={{ bgcolor: C.bg, minHeight: '100%', p: { xs: 2, md: 4 }, fontFamily: '"Tajawal", system-ui, sans-serif' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;800&display=swap');`}</style>

      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="overline" sx={{ color: C.muted, letterSpacing: 1.5, fontWeight: 500, display: 'block', mb: 0.5 }}>
            Dashboard & Reports · Incentives
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 800, color: C.ink, lineHeight: 1.1, letterSpacing: -0.5 }}>
            Incentive Report
          </Typography>
          <Typography variant="body2" sx={{ color: C.muted, mt: 1, maxWidth: 560 }}>
            Sales records and profit bonus granted to cashiers, by date.
          </Typography>
        </Box>
        <Button
          variant="outlined"
          onClick={exportCsv}
          disabled={records.length === 0}
          sx={{ textTransform: 'none', fontWeight: 600, px: 2.5, borderColor: C.teal, color: C.teal, '&:hover': { borderColor: '#0a4a50', bgcolor: C.hover } }}
        >
          Export CSV
        </Button>
      </Box>

      <Paper elevation={0} sx={{ bgcolor: C.surface, border: `1px solid ${C.border}`, borderRadius: 1, p: 2, mb: 3 }}>
        <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
          <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} size="small" />
          <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} size="small" />
          <TextField label="Cashier" value={cashier} onChange={(e) => setCashier(e.target.value)} size="small" />
          <TextField label="Item id" value={itemId} onChange={(e) => setItemId(e.target.value)} size="small" />
          <Button variant="contained" onClick={load} disabled={loading} sx={{ bgcolor: C.teal, textTransform: 'none', fontWeight: 600, '&:hover': { bgcolor: '#0a4a50' } }}>
            {loading ? 'Loading…' : 'Apply'}
          </Button>
        </Stack>
      </Paper>

      {summary && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2, mb: 3 }}>
          <Paper elevation={0} sx={{ p: 2.5, bgcolor: C.surface, border: `1px solid ${C.border}`, borderRadius: 1, borderLeft: `4px solid ${C.teal}` }}>
            <Typography variant="caption" sx={{ color: C.muted, letterSpacing: 0 }}>Invoices</Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, color: C.ink, mt: 0.5 }}>{summary.totals.invoiceCount}</Typography>
          </Paper>
          <Paper elevation={0} sx={{ p: 2.5, bgcolor: C.surface, border: `1px solid ${C.border}`, borderRadius: 1, borderLeft: `4px solid ${C.teal}` }}>
            <Typography variant="caption" sx={{ color: C.muted, letterSpacing: 0 }}>Total Sales</Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, color: C.ink, mt: 0.5 }}>{formatMoney(summary.totals.totalSaleAmount)}</Typography>
          </Paper>
          <Paper elevation={0} sx={{ p: 2.5, bgcolor: C.surface, border: `1px solid ${C.border}`, borderRadius: 1, borderLeft: `4px solid ${C.gold}` }}>
            <Typography variant="caption" sx={{ color: C.muted, letterSpacing: 0 }}>Total Incentive</Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, color: C.gold, mt: 0.5 }}>{formatMoney(summary.totals.totalIncentive)}</Typography>
          </Paper>
        </Box>
      )}

      <Paper elevation={0} sx={{ bgcolor: C.surface, border: `1px solid ${C.border}`, borderRadius: 1, overflow: 'hidden' }}>
        <Table size="small">
          <TableHead sx={{ bgcolor: C.bg }}>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, color: C.ink, borderBottom: `2px solid ${C.border}` }}>Date</TableCell>
              <TableCell sx={{ fontWeight: 700, color: C.ink, borderBottom: `2px solid ${C.border}` }}>Invoice</TableCell>
              <TableCell sx={{ fontWeight: 700, color: C.ink, borderBottom: `2px solid ${C.border}` }}>Item</TableCell>
              <TableCell sx={{ fontWeight: 700, color: C.ink, borderBottom: `2px solid ${C.border}` }}>Qty</TableCell>
              <TableCell sx={{ fontWeight: 700, color: C.ink, borderBottom: `2px solid ${C.border}` }}>Sale Amount</TableCell>
              <TableCell sx={{ fontWeight: 700, color: C.ink, borderBottom: `2px solid ${C.border}` }}>Type</TableCell>
              <TableCell sx={{ fontWeight: 700, color: C.ink, borderBottom: `2px solid ${C.border}` }}>Rate</TableCell>
              <TableCell sx={{ fontWeight: 700, color: C.ink, borderBottom: `2px solid ${C.border}` }}>Incentive</TableCell>
              <TableCell sx={{ fontWeight: 700, color: C.ink, borderBottom: `2px solid ${C.border}` }}>Cashier</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {records.length === 0 && (
              <TableRow>
                <TableCell colSpan={9}>
                  <Typography color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
                    No incentive records for this range.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {records.map((r) => (
              <TableRow key={r.id} hover sx={{ '&:hover': { bgcolor: C.hover } }}>
                <TableCell>{r.invoiceDate.slice(0, 10)}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{r.invoiceNo}</TableCell>
                <TableCell>{r.itemNameEn}</TableCell>
                <TableCell>{r.qty}</TableCell>
                <TableCell>{formatMoney(r.saleAmount)}</TableCell>
                <TableCell sx={{ color: C.muted }}>{r.incentiveType}</TableCell>
                <TableCell>{r.incentiveType === 'percent' ? `${(r.rate * 100).toFixed(2)}%` : formatMoney(r.rate)}</TableCell>
                <TableCell sx={{ fontWeight: 600, color: C.gold }}>{formatMoney(r.incentiveAmount)}</TableCell>
                <TableCell>{r.cashierName}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      {summary && summary.days.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, color: C.ink, mb: 1.5 }}>Daily summary</Typography>
          <Paper elevation={0} sx={{ bgcolor: C.surface, border: `1px solid ${C.border}`, borderRadius: 1, overflow: 'hidden' }}>
            <Table size="small">
              <TableHead sx={{ bgcolor: C.bg }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700, color: C.ink, borderBottom: `2px solid ${C.border}` }}>Date</TableCell>
                  <TableCell sx={{ fontWeight: 700, color: C.ink, borderBottom: `2px solid ${C.border}` }}>Invoices</TableCell>
                  <TableCell sx={{ fontWeight: 700, color: C.ink, borderBottom: `2px solid ${C.border}` }}>Sale Amount</TableCell>
                  <TableCell sx={{ fontWeight: 700, color: C.ink, borderBottom: `2px solid ${C.border}` }}>Incentive</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {summary.days.map((d) => (
                  <TableRow key={d.date} hover sx={{ '&:hover': { bgcolor: C.hover } }}>
                    <TableCell>{d.date}</TableCell>
                    <TableCell>{d.invoiceCount}</TableCell>
                    <TableCell>{formatMoney(d.totalSaleAmount)}</TableCell>
                    <TableCell sx={{ fontWeight: 600, color: C.gold }}>{formatMoney(d.totalIncentive)}</TableCell>
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
