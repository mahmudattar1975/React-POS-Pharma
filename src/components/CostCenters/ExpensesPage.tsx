// Expenses - manual expense entry + the Phase-A flagship report "Expenses by cost center" (see
// costcenter.md §7.4: the requirements contract made expense accounting the chain's objective).
//
// Business rules baked in:
// - Entry is create-only (posted expenses are history, same discipline as purchases/sales) and
//   every entry requires a valid, OPEN cost center at the entry's date - store-level validation.
// - Account (what was spent) never encodes the center (who is responsible) - design doc §1.2.
// - Actuals are DERIVED - this report sums entries live and tags revenue from the sales store;
//   nothing here caches totals (the "never drift from GL" rule, costcenter.md §8.2.3).
// - Exception reporting (§8.4 criterion 1): documents tagged with center ids that no longer
//   resolve, and untagged sales, are counted and listed so nothing silently vanishes from the
//   expense/revenue picture - that is the acceptance criterion Phase A must guarantee.
import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import type { ExpenseEntry, ExpenseKind } from '../../types/costCenters';
import { useCostCenterStore } from '../../store/costCenterStore';
import { useSalesStore } from '../../store/salesStore';
import { usePurchasingStore } from '../../store/purchasingStore';
import { useCatalogStore } from '../../store/catalogStore';
import { useSettingsStore } from '../../store/settingsStore';
import { round2 } from '../../utils/vat';
import {
  EXPENSE_ACCOUNT_OPTIONS, expenseTotals, isPostingOpen, observedCategories, orderedCenters,
  todayISO, unmappedCategoryRevenue,
} from '../../utils/costCenters';

export default function ExpensesPage() {
  const centers = useCostCenterStore((s) => s.centers);
  const expenses = useCostCenterStore((s) => s.expenses);
  const addExpense = useCostCenterStore((s) => s.addExpense);
  const sales = useSalesStore((s) => s.invoices);
  const purchaseInvoices = usePurchasingStore((s) => s.invoices);
  const items = useCatalogStore((s) => s.items);
  const categoryMap = useCostCenterStore((s) => s.categoryMap);
  const defaultCostCenterId = useSettingsStore((s) => s.settings.costCenterId);

  // Only today-open centers are bookable; the picker never shows the closed kiosk or a future
  // center, so a mistyped/invalid center cannot even reach the store's validation throw.
  const postingCenters = centers.filter((c) => isPostingOpen(c, todayISO()));
  const [targetCenterId, setTargetCenterId] = useState<string>(defaultCostCenterId ?? '');

  // ---- entry form
  const [date, setDate] = useState(todayISO());
  const [account, setAccount] = useState<string>(EXPENSE_ACCOUNT_OPTIONS[0]);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<ExpenseKind>('direct');
  const [entered, setEntered] = useState<ExpenseEntry | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // The store re-validates (isPostingOpen) with the real throw - here only to enable/disable.
  const formValid =
    !!date && Number(amount) > 0 && isPostingOpen(centers.find((c) => c.id === targetCenterId), date);

  function submit() {
    if (!formValid) return;
    try {
      const e = addExpense({
        date,
        amount: round2(Number(amount)),
        description: description.trim() || account,
        costCenterId: targetCenterId,
        expenseAccount: account,
        kind,
      });
      setEntered(e);
      setFormError(null);
      setAmount('');
      setDescription('');
    } catch (err) {
      setFormError(String(err instanceof Error ? err.message : err));
      setEntered(null);
    }
  }

  // ---- derived reporting -------------------------------------------------------------
  // Revenue per center comes straight from the tagged SALE documents - never stored on the
  // center. Purchases are inventoriable cost, not P&L expense, so they stay out of the ratio and
  // are only listed in the exception check below.
  //
  // Phase B.1: attribution is per LINE (the department stamp written from the category map at
  // checkout) and falls back to the invoice HEADER (the branch) for every invoice issued before
  // that map existed - so historical reporting does not change shape when a rule is added today.
  const report = useMemo(() => {
    const revenueByCenter = new Map<string, number>();
    const centerIds = new Set(centers.map((c) => c.id));
    const soldLines: Array<{ itemId: string; amount: number }> = [];
    let danglingSales = 0; // lines stamped with a center id that no longer resolves
    let unassignedSalesRevenue = 0; // lines with no stamp at all
    let unassignedSalesLines = 0;

    for (const inv of sales) {
      for (const line of inv.lines) {
        soldLines.push({ itemId: line.itemId, amount: line.netExclVat });
        const centerId = line.costCenterId ?? inv.costCenterId;
        if (!centerId) {
          unassignedSalesRevenue += line.netExclVat;
          unassignedSalesLines += 1;
          continue;
        }
        if (!centerIds.has(centerId)) {
          danglingSales += 1;
          continue;
        }
        revenueByCenter.set(centerId, (revenueByCenter.get(centerId) ?? 0) + line.netExclVat);
      }
    }

    const totals = expenseTotals(centers, expenses);
    let danglingPurchases = 0;
    let unassignedPurchases = 0;
    for (const inv of purchaseInvoices) {
      if (inv.costCenterId && !centerIds.has(inv.costCenterId)) danglingPurchases += 1;
      if (!inv.costCenterId) unassignedPurchases += 1;
    }

    return {
      revenueByCenter,
      totals,
      danglingSales,
      danglingPurchases,
      unassignedSalesRevenue: round2(unassignedSalesRevenue),
      unassignedSalesLines,
      unassignedPurchases,
      categoryRisk: unmappedCategoryRevenue(soldLines, items, categoryMap),
    };
  }, [centers, expenses, sales, purchaseInvoices, items, categoryMap]);

  // Category coverage is a catalogue question, not a sales one: how many of the categories that
  // actually exist in the item master have a rule. Kept next to the reconciliation figures so a
  // growing gap is visible before it turns into an unexplained revenue shift.
  const categoryCoverage = useMemo(() => {
    const observed = observedCategories(items);
    const mapped = new Set(categoryMap.map((m) => m.categoryKey));
    return {
      observed: observed.length,
      unmapped: observed.filter((o) => !mapped.has(o.key)).map((o) => o.label),
    };
  }, [items, categoryMap]);

  const totalExpenses = round2(expenses.reduce((s, e) => s + e.amount, 0));
  const totalAllocatable = round2(
    expenses.filter((e) => e.kind === 'allocatable').reduce((s, e) => s + e.amount, 0)
  );

  return (
    <Box sx={{ maxWidth: 980 }}>
      <Stack spacing={2}>
        {/* ---- entry form */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>Record Expense</Typography>
          <Stack spacing={2}>
            {formError && <Alert severity="error" onClose={() => setFormError(null)}>{formError}</Alert>}
            {entered && (
              <Alert severity="success" onClose={() => setEntered(null)}>
                Expense {entered.id} - SAR {entered.amount.toFixed(2)} ({entered.expenseAccount}) recorded on{' '}
                {centers.find((c) => c.id === entered.costCenterId)?.nameEn}.
              </Alert>
            )}
            <Stack direction="row" spacing={1.5}>
              <TextField
                label="Date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                size="small"
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />
              <Select labelId="account-label" value={account} onChange={(e) => setAccount(e.target.value)} size="small" sx={{ maxWidth: 260 }}>
                {EXPENSE_ACCOUNT_OPTIONS.map((a) => (
                  <MenuItem key={a} value={a}>{a}</MenuItem>
                ))}
              </Select>
              <TextField
                label="Amount (SAR)"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                size="small"
                helperText="Incl. any VAT, as paid"
                fullWidth
              />
            </Stack>
            <Stack direction="row" spacing={1.5}>
              <Select
                labelId="expense-center-label"
                value={targetCenterId}
                onChange={(e) => setTargetCenterId(e.target.value)}
                size="small"
                sx={{ maxWidth: 420 }}
              >
                {postingCenters.map((c) => (
                  <MenuItem key={c.id} value={c.id}>{c.code} — {c.nameEn}</MenuItem>
                ))}
              </Select>
              <Select
                labelId="kind-label"
                value={kind}
                onChange={(e) => setKind(e.target.value as ExpenseKind)}
                size="small"
                sx={{ maxWidth: 280 }}
              >
                <MenuItem value="direct">Direct (stays on this center)</MenuItem>
                <MenuItem value="allocatable">Allocatable (shared, awaits allocation)</MenuItem>
              </Select>
            </Stack>
            <TextField
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              size="small"
              helperText="Defaults to the account label when left empty."
              fullWidth
            />
            <Button variant="contained" size="small" disabled={!formValid} onClick={submit} sx={{ alignSelf: 'flex-start' }}>
              Record expense
            </Button>
            <Typography variant="caption" color="text.secondary">
              Direct expenses belong to exactly one branch/department. Allocatable ones (rent, IT,
              chain salaries) sit on their shared center until an allocation run distributes them -
              marking them now prevents the double-count later.
            </Typography>
          </Stack>
        </Paper>

        {/* ---- recent entries */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>
            Recorded Expenses ({expenses.length} · SAR {totalExpenses.toFixed(2)} total · of which
            allocatable SAR {totalAllocatable.toFixed(2)})
          </Typography>
          {expenses.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No expenses recorded yet.
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Date</TableCell>
                    <TableCell>Account</TableCell>
                    <TableCell>Description</TableCell>
                    <TableCell>Center</TableCell>
                    <TableCell>Kind</TableCell>
                    <TableCell align="right">Amount (SAR)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {[...expenses].reverse().slice(0, 25).map((e) => {
                    const c = centers.find((x) => x.id === e.costCenterId);
                    return (
                      <TableRow key={e.id}>
                        <TableCell>{e.date}</TableCell>
                        <TableCell>{e.expenseAccount}</TableCell>
                        <TableCell>{e.description}</TableCell>
                        <TableCell>
                          {c ? `${c.code} — ${c.nameEn}` : '— (unknown center)'}
                        </TableCell>
                        <TableCell>{e.kind}</TableCell>
                        <TableCell align="right">{e.amount.toFixed(2)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>

        {/* ---- flagship report: expenses by cost center */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>Expenses by Cost Center</Typography>
          <Typography variant="caption" color="text.secondary">
            Derived live from recorded expenses + tagged sales. Subtree = center plus all its
            children (head-office rows therefore show the whole chain). Allocation shares land in
            a later phase, so allocatable amounts stay flagged where they are.
          </Typography>
          <TableContainer sx={{ mt: 1.5 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Center</TableCell>
                  <TableCell>Kind</TableCell>
                  <TableCell align="right">Direct (SAR)</TableCell>
                  <TableCell align="right">Allocatable (SAR)</TableCell>
                  <TableCell align="right">Subtree total (SAR)</TableCell>
                  <TableCell align="right">Tagged revenue (SAR)</TableCell>
                  <TableCell align="right">Expense-to-revenue %</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {orderedCenters(centers).map((c) => {
                  const t = report.totals.get(c.id);
                  const revenue = report.revenueByCenter.get(c.id) ?? 0;
                  const ownExpenses = c.kind === 'branch' ? (t?.direct ?? 0) : (t?.subtree ?? 0);
                  // Branch cards compare their OWN direct expenses against their own tagged
                  // revenue; overhead/activity rows use the subtree rollup (comparing HQ rent
                  // against branch sales mixed into HQ's subtree would misstate the ratio).
                  const ratio = revenue > 0 ? ownExpenses / revenue : null;
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        {c.code} — {c.nameEn}
                        {!c.isActive && (
                          <Typography variant="caption" color="text.secondary"> (inactive)</Typography>
                        )}
                      </TableCell>
                      <TableCell>{c.kind}</TableCell>
                      <TableCell align="right">{(t?.direct ?? 0).toFixed(2)}</TableCell>
                      <TableCell align="right">{(t?.allocatable ?? 0).toFixed(2)}</TableCell>
                      <TableCell align="right"><strong>{(t?.subtree ?? 0).toFixed(2)}</strong></TableCell>
                      <TableCell align="right">{revenue.toFixed(2)}</TableCell>
                      <TableCell align="right">{ratio === null ? '—' : `${(ratio * 100).toFixed(1)}%`}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          {/* ---- §8.4 criterion 1: exception block - nothing leaves the expense picture silently */}
          <Stack spacing={0.5} sx={{ mt: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Assignment exceptions</Typography>
            <Typography variant="body2" color={report.danglingSales ? 'error' : 'text.secondary'}>
              Sale lines stamped with a cost center that no longer exists: {report.danglingSales}
            </Typography>
            <Typography variant="body2" color={report.danglingPurchases ? 'error' : 'text.secondary'}>
              Purchase invoices tagged to a cost center that no longer exists: {report.danglingPurchases}
            </Typography>
            <Typography variant="body2" color={report.unassignedSalesLines ? 'error' : 'text.secondary'}>
              Sale lines with no cost-center tag at all (ex VAT): {report.unassignedSalesLines > 0
                ? `${report.unassignedSalesRevenue.toFixed(2)} SAR across ${report.unassignedSalesLines} line${report.unassignedSalesLines === 1 ? '' : 's'}`
                : 'none'}
            </Typography>
            <Typography variant="body2" color={categoryCoverage.unmapped.length ? 'error' : 'text.secondary'}>
              Categories with no cost-center rule: {categoryCoverage.unmapped.length} of{' '}
              {categoryCoverage.observed}
              {categoryCoverage.unmapped.length > 0
                ? ` (${report.categoryRisk.revenue.toFixed(2)} SAR of sales still on the branch default)`
                : ''}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Purchases without a cost-center tag (informational - stock cost, not P&L expense):
              {report.unassignedPurchases > 0 ? ` ${report.unassignedPurchases}` : ' none'}
            </Typography>
          </Stack>
        </Paper>
      </Stack>
    </Box>
  );
}
