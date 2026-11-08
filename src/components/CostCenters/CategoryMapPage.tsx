// Category -> Cost Center mapping (Phase B.1, costcenter.md §9.1).
//
// This is the page that turns the Phase-A "one branch tag per invoice" into department-level
// reporting: the accountant writes one rule per item category, and checkout then stamps the
// matching center on each SALE LINE without the cashier answering anything (§7.4 zero-friction
// rule). See §10.5 for why the key is a normalised free-text category rather than a category
// master table.
//
// Three exception buckets are shown because they mean different things (§10.5):
//   unmapped_category - a to-do: this category's sales still land on the store center
//   stale_target      - a bug: the rule points at a centre that is retired / closed / gone
//   unused_rule       - usually a typo: the rule matches no item at all
import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import type { CategoryMapException } from '../../utils/costCenters';
import {
  categoryMapExceptions, observedCategories, unmappedCategoryRevenue,
} from '../../utils/costCenters';
import { useCatalogStore } from '../../store/catalogStore';
import { useCostCenterStore } from '../../store/costCenterStore';
import { useSalesStore } from '../../store/salesStore';
import { useAuthStore } from '../../store/authStore';
import { round2 } from '../../utils/vat';

export default function CategoryMapPage() {
  const items = useCatalogStore((s) => s.items);
  const sales = useSalesStore((s) => s.invoices);
  const centers = useCostCenterStore((s) => s.centers);
  const categoryMap = useCostCenterStore((s) => s.categoryMap);
  const setCategoryMapping = useCostCenterStore((s) => s.setCategoryMapping);
  const clearCategoryMapping = useCostCenterStore((s) => s.clearCategoryMapping);
  const session = useAuthStore((s) => s.session);

  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const observed = useMemo(() => observedCategories(items), [items]);
  const ruleByKey = useMemo(
    () => new Map(categoryMap.map((m) => [m.categoryKey, m])),
    [categoryMap],
  );
  // Overhead pools stay in the list (so an old rule still renders its value) but are disabled:
  // a pool is an allocation SOURCE, never the accountable owner of a sale category (§10.4).
  const targetCenters = useMemo(() => centers.filter((c) => c.kind !== 'overhead'), [centers]);

  const exceptions = useMemo(
    () => categoryMapExceptions(observed, categoryMap, centers, new Date().toISOString()),
    [observed, categoryMap, centers],
  );
  const byKind = useMemo(() => {
    const group = (kind: CategoryMapException['kind']) => exceptions.filter((e) => e.kind === kind);
    return {
      unmapped: group('unmapped_category'),
      stale: group('stale_target'),
      unused: group('unused_rule'),
    };
  }, [exceptions]);

  // "Money still on the branch default": sale lines whose item category has no usable rule.
  // Derived live from issued invoices - nothing is cached (the §8.2.3 never-drift rule).
  const atRisk = useMemo(() => {
    const soldLines = sales.flatMap((inv) =>
      inv.lines.map((l) => ({ itemId: l.itemId, amount: l.netExclVat }))
    );
    return unmappedCategoryRevenue(soldLines, items, categoryMap);
  }, [sales, items, categoryMap]);

  function save(categoryLabel: string, costCenterId: string) {
    try {
      setCategoryMapping({ categoryLabel, costCenterId, updatedBy: session?.fullName });
      setError(null);
      setSaved(categoryLabel);
    } catch (err) {
      setSaved(null);
      setError(String(err instanceof Error ? err.message : err));
    }
  }

  function remove(categoryKey: string, label: string) {
    clearCategoryMapping(categoryKey);
    setError(null);
    setSaved(`${label} (rule removed)`);
  }

  const mappedCount = observed.filter((o) => ruleByKey.has(o.key)).length;

  return (
    <Box sx={{ maxWidth: 1100 }}>
      <Stack spacing={2}>
        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        {saved && (
          <Alert severity="success" onClose={() => setSaved(null)}>
            Saved: {saved}. New sales in this category will carry the mapped center on each line.
          </Alert>
        )}

        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Item categories ({observed.length} in the catalog · {mappedCount} mapped)
          </Typography>
          <Typography variant="caption" color="text.secondary">
            The list comes from the item master itself, so only categories that actually have items
            can be mapped. Sales lines keep the center they were stamped with, even if the rule
            changes later.
          </Typography>

          {observed.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              No categorised items in the catalog.
            </Typography>
          ) : (
            <TableContainer sx={{ mt: 1.5 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Category</TableCell>
                    <TableCell align="right">Items</TableCell>
                    <TableCell>Sample items</TableCell>
                    <TableCell sx={{ minWidth: 280 }}>Maps to</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {observed.map((o) => {
                    const rule = ruleByKey.get(o.key);
                    const target = rule ? centers.find((c) => c.id === rule.costCenterId) : undefined;
                    const stale = !!rule && (!target || byKind.stale.some((e) => e.categoryKey === o.key));
                    return (
                      <TableRow key={o.key}>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{o.label}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            key: {o.key}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">{o.itemCount}</TableCell>
                        <TableCell>
                          <Typography variant="caption" color="text.secondary">
                            {o.sampleNames.join(', ')}
                            {o.itemCount > o.sampleNames.length ? ' …' : ''}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={rule?.costCenterId ?? ''}
                            onChange={(e) => save(o.label, e.target.value)}
                            displayEmpty
                            size="small"
                            fullWidth
                            error={stale}
                          >
                            <MenuItem value="">
                              <em>(no rule - falls back to the store center)</em>
                            </MenuItem>
                            {targetCenters.map((c) => (
                              <MenuItem
                                key={c.id}
                                value={c.id}
                                disabled={!c.isActive || !c.IsPostingAllowed}
                              >
                                {c.code} — {c.nameEn}
                                {!c.isActive ? ' (inactive)' : ''}
                                {!c.IsPostingAllowed ? ' (no posting)' : ''}
                              </MenuItem>
                            ))}
                          </Select>
                          {stale && (
                            <Typography variant="caption" color="error">
                              Rule target is not open for posting - sales fall back to the store center.
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">
                          {rule && (
                            <Button size="small" color="inherit" onClick={() => remove(o.key, o.label)}>
                              Remove
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>

        {/* ---- exceptions: what is still unclassified, and what it costs */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>Assignment exceptions</Typography>
          <Typography variant="caption" color="text.secondary">
            Revenue at risk counts issued sale lines (ex VAT, after discount) whose category has no
            usable rule - those lines stay on the store's branch center.
          </Typography>
          <Stack spacing={0.5} sx={{ mt: 1.5 }}>
            <Typography variant="body2" color={byKind.unmapped.length ? 'error' : 'text.secondary'}>
              Categories with no rule: {byKind.unmapped.length}
              {byKind.unmapped.length > 0 && ` (${byKind.unmapped.map((e) => e.categoryLabel).join(', ')})`}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Sales value still on the branch default: SAR {round2(atRisk.revenue).toFixed(2)} across{' '}
              {atRisk.lineCount} sale line{atRisk.lineCount === 1 ? '' : 's'}
            </Typography>
            <Typography variant="body2" color={byKind.stale.length ? 'error' : 'text.secondary'}>
              Rules pointing at a centre that is not open: {byKind.stale.length}
            </Typography>
          </Stack>

          {byKind.unused.length > 0 && (
            <>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 2 }}>
                Rules matching no item ({byKind.unused.length})
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Usually a typo. They do nothing today but would start applying the moment an item
                with that category is imported.
              </Typography>
              <TableContainer sx={{ mt: 1 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Rule category</TableCell>
                      <TableCell>Key</TableCell>
                      <TableCell>Maps to</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {byKind.unused.map((e) => (
                      <TableRow key={e.categoryKey}>
                        <TableCell>{e.categoryLabel}</TableCell>
                        <TableCell><code>{e.categoryKey}</code></TableCell>
                        <TableCell>
                          {centers.find((c) => c.id === e.costCenterId)?.nameEn ?? '(missing centre)'}
                        </TableCell>
                        <TableCell align="right">
                          <Button size="small" color="inherit" onClick={() => remove(e.categoryKey, e.categoryLabel)}>
                            Remove
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}

          <Chip
            size="small"
            sx={{ mt: 2 }}
            variant="outlined"
            label={`Coverage ${observed.length === 0 ? 0 : Math.round((mappedCount / observed.length) * 100)}% of catalog categories`}
          />
        </Paper>
      </Stack>
    </Box>
  );
}
