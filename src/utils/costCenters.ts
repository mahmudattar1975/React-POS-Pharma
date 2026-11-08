// Pure cost-center tree + expense math (Phase A). Kept free of store/UI imports so the same
// functions serve the pages, the store's posting validations, and the unit tests unchanged.
import type { CategoryCenterMap, CostCenter, ExpenseEntry } from '../types/costCenters';
import { round2 } from './vat';

// The Phase-A account menu for manual expenses. Deliberately WHAT-was-spent labels, not centers
// (electricity/rent/salaries are expense ACCOUNTS, the cost center is WHO is responsible - see
// the design doc §1.2 note against creating a center per expense type). Free-typed labels remain
// possible later; a fixed list keeps the seed data and report grouping predictable for now.
export const EXPENSE_ACCOUNT_OPTIONS = [
  'Rent',
  'Utilities',
  'Salaries & Benefits',
  'Maintenance',
  'IT & Telecom',
  'Supplies',
  'Government & License Fees',
  'Other',
] as const;

// yyyy-mm-dd for "today" in the app's local timezone - same slicing convention the other pages
// use for their default date fields (new Date().toISOString().slice(0, 10)).
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Is a NEW document/expense allowed on this center at `date`? Encodes the validation matrix from
// costcenter.md §8 (inactive-center block, non-posting-parent notion applied per center, and the
// effective-date window). Historical entries never get retro-invalidated by deactivation - the
// guard applies only when a NEW entry names the center (acceptance criterion 7: deactivating a
// center must not remove historical reporting).
export function isPostingOpen(center: CostCenter | undefined, dateISO: string): boolean {
  if (!center) return false;
  if (!center.isActive) return false;
  if (!center.IsPostingAllowed) return false;
  if (dateISO < center.effectiveFrom) return false;
  if (center.effectiveTo !== undefined && dateISO > center.effectiveTo) return false;
  return true;
}

// Parent/hierarchy validation - the web equivalent of the CHECK-(COSTCNO <> COSTMAIN) +
// recursive-CTE cycle scan the SQL Server mirror needs (costcenter.md §7.2). Throws with a
// human-readable message so addCenter/moveCenter surfaces it in a dialog verbatim.
// `selfId` is the node being (re-)parented: passing it catches self-parenting AND writes cycles
// (A -> B -> A) in one pass; for a brand-new node undefined is fine since no cycle can exist yet.
export function assertParentValid(centers: CostCenter[], parentId: string | undefined, selfId?: string): void {
  if (parentId === undefined) return; // a root is always fine
  if (selfId !== undefined && parentId === selfId) {
    throw new Error('A cost center cannot be its own parent.');
  }
  const byId = indexCenters(centers);
  if (!byId.has(parentId)) {
    throw new Error('Parent cost center was not found.');
  }
  // Walk up from the proposed parent: if we ever step on SELF, the chain closes into a cycle.
  let cursor = byId.get(parentId);
  const seen = new Set<string>();
  while (cursor) {
    if (cursor.id === selfId) {
      throw new Error('That parent would create a cycle in the cost-center tree.');
    }
    if (seen.has(cursor.id)) break; // defensive: pre-existing cycle, stop instead of looping forever
    seen.add(cursor.id);
    cursor = cursor.parentId !== undefined ? byId.get(cursor.parentId) : undefined;
  }
}

// Small helper for the id->center lookup, hoisted here so assertParentValid, centerPath and the
// pages share one Map-building code path.
function indexCenters(centers: CostCenter[]): Map<string, CostCenter> {
  const map = new Map<string, CostCenter>();
  for (const c of centers) map.set(c.id, c);
  return map;
}

export function centerById(centers: CostCenter[], id: string | undefined): CostCenter | undefined {
  if (id === undefined) return undefined;
  return centers.find((c) => c.id === id);
}

// All DISTINCT descendants (never including the root itself) - used for subtree rollups and for
// child pickers. BFS order keeps children near their parents in report output.
export function collectDescendantIds(centers: CostCenter[], rootId: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const c of centers) {
    if (c.parentId === undefined || c.id === rootId) continue;
    const list = childrenOf.get(c.parentId) ?? [];
    list.push(c.id);
    childrenOf.set(c.parentId, list);
  }
  const out: string[] = [];
  const queue = [...(childrenOf.get(rootId) ?? [])];
  while (queue.length) {
    const id = queue.shift() as string;
    out.push(id);
    for (const child of childrenOf.get(id) ?? []) queue.push(child);
  }
  return out;
}

// Centers one level under `parentId` - what the tree page and parent pickers iterate.
export function childCentersOf(centers: CostCenter[], parentId: string | undefined): CostCenter[] {
  return centers.filter((c) => c.parentId === parentId);
}

// Depth-first listing (roots first in seed order, then each branch's own subtree) - the display
// order both the tree page and the report iterate, so a subtree always reads as one block.
export function orderedCenters(centers: CostCenter[]): CostCenter[] {
  const out: CostCenter[] = [];
  const walk = (parentId: string | undefined): void => {
    for (const c of centers) {
      if (c.parentId !== parentId) continue;
      out.push(c);
      walk(c.id);
    }
  };
  walk(undefined);
  return out;
}

// "Head Office → IT Services" style path for dialogs/history where only an id is stored.
export function centerPath(centers: CostCenter[], id: string | undefined): string {
  const parts: string[] = [];
  const byId = indexCenters(centers);
  let cursor = centerById(centers, id);
  while (cursor) {
    parts.unshift(cursor.nameEn);
    cursor = cursor.parentId !== undefined ? byId.get(cursor.parentId) : undefined;
  }
  return parts.join(' → ');
}

export interface CenterExpenseTotals {
  direct: number; // entries booked ON this center itself, round2
  subtree: number; // direct + every descendant's entries, round2 - the rollup the report shows
  allocatable: number; // of the DIRECT entries, how much still awaits a phase-D allocation run
}

// Direct + rolled-up totals per center. Actuals are ALWAYS derived from the entry list, never
// cached on the center (the design doc's explicit correction over the legacy's on-master
// COSTBAL totals - closing will refresh a cache, not define truth). Writing an expense against a
// center id that no longer exists in the tree is impossible through the UI, but a deactivation
// or future re-import leaves that money still attributed - callers surface it as an exception.
export function expenseTotals(centers: CostCenter[], expenses: ExpenseEntry[]): Map<string, CenterExpenseTotals> {
  const directByCenter = new Map<string, number>();
  const allocatableByCenter = new Map<string, number>();
  for (const e of expenses) {
    directByCenter.set(e.costCenterId, (directByCenter.get(e.costCenterId) ?? 0) + e.amount);
    if (e.kind === 'allocatable') {
      allocatableByCenter.set(e.costCenterId, (allocatableByCenter.get(e.costCenterId) ?? 0) + e.amount);
    }
  }
  const totals = new Map<string, CenterExpenseTotals>();
  for (const c of centers) {
    const direct = round2(directByCenter.get(c.id) ?? 0);
    const allocatable = round2(allocatableByCenter.get(c.id) ?? 0);
    // Roll the subtree up along parentId chains, INDEPENDENTLY per center, so a re-parented
    // node immediately reports under its new parent without any stored sum to fix.
    let subtree = direct;
    for (const dId of collectDescendantIds(centers, c.id)) {
      subtree += directByCenter.get(dId) ?? 0;
    }
    totals.set(c.id, { direct, subtree: round2(subtree), allocatable });
  }
  return totals;
}

// =============================================================================================
// Phase B.1 - category-driven defaulting (costcenter.md §9.1, rules from §10.5)
// =============================================================================================
//
// The problem this solves: the POS tags every sale with ONE header center (the branch), so an
// invoice cannot say "these antibiotics belong to the antibiotics department". The map below lets
// the accountant say it once - "items in category X are accounted for by center Y" - and checkout
// then stamps that center on each LINE without the cashier answering anything (zero-friction rule,
// §7.4). See §10.3: the stamped center is the accountable one, and the header tag stays the branch.

// The one place the category spelling rule lives: trim, casefold, collapse internal whitespace.
// 'Baby Care', 'baby care ' and 'Baby  Care' all become 'baby care'. Arabic survives unchanged
// (there is no case to fold), so the same rule covers an Arabic-only imported feed.
export function normalizeCategoryKey(category: string): string {
  return category.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface CategoryResolution {
  costCenterId?: string; // what to stamp on the line; undefined = leave untagged (exception)
  // 'mapped'     - a rule existed and its center is open for posting
  // 'fallback'   - no usable rule, so the document keeps the store's own branch center
  // 'unassigned' - neither a rule nor a usable fallback: the line stays untagged and is reported
  source: 'mapped' | 'fallback' | 'unassigned';
  // Why a fallback happened. Rendered in the exception list; never thrown - a sale must never be
  // blocked because master data is stale (§9.4 "never block a sale").
  note?: string;
}

// Resolve the center a sale/purchase line should carry for `category`, at `dateISO` (an ISO date
// or datetime - only the date part is compared).
//
// Deliberate limitation: a rule whose target has been deactivated does NOT silently keep working.
// It falls back to the branch center and raises a note, because posting sales into a retired
// center would corrupt that center's history while hiding the fact that the rule is stale.
export function resolveCenterForCategory(
  category: string | undefined,
  map: CategoryCenterMap[],
  centers: CostCenter[],
  dateISO: string,
  fallbackCenterId?: string,
): CategoryResolution {
  const day = dateISO.slice(0, 10);
  const fallback = centerById(centers, fallbackCenterId);
  const fallbackOpen = fallback && isPostingOpen(fallback, day) ? fallback : undefined;

  const key = category ? normalizeCategoryKey(category) : '';
  const row = key ? map.find((m) => m.categoryKey === key) : undefined;

  if (row) {
    const target = centerById(centers, row.costCenterId);
    if (target && isPostingOpen(target, day)) {
      return { costCenterId: target.id, source: 'mapped' };
    }
    const note = `rule points at ${row.costCenterId}, which is not open for posting`;
    return fallbackOpen
      ? { costCenterId: fallbackOpen.id, source: 'fallback', note }
      : { source: 'unassigned', note };
  }

  const note = key ? 'category has no mapping rule' : 'item has no category';
  return fallbackOpen
    ? { costCenterId: fallbackOpen.id, source: 'fallback', note }
    : { source: 'unassigned', note };
}

// The categories that actually exist in the item master, grouped by normalised key. The mapping
// UI offers exactly these (never a hard-coded list), so a rule can only be written for a category
// that has items behind it. Uncategorised items are skipped: they cannot carry a rule anyway.
export interface ObservedCategory {
  key: string;
  label: string; // first spelling seen - the one the accountant recognises
  itemCount: number;
  sampleNames: string[]; // up to 3 English names, so "which items?" is answerable in the UI
}

export function observedCategories(
  items: Array<{ nameEn: string; category: string }>,
): ObservedCategory[] {
  const byKey = new Map<string, ObservedCategory>();
  for (const item of items) {
    const raw = (item.category ?? '').trim();
    if (!raw) continue;
    const key = normalizeCategoryKey(raw);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { key, label: raw, itemCount: 1, sampleNames: [item.nameEn] });
      continue;
    }
    existing.itemCount += 1;
    if (existing.sampleNames.length < 3) existing.sampleNames.push(item.nameEn);
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
}

// The three ways a category map goes wrong, and the reason the report distinguishes them: a
// missing rule is a to-do, a stale rule is a bug, and a rule matching nothing is usually a typo
// that would otherwise sit in the table looking authoritative forever.
export type CategoryMapExceptionKind = 'unmapped_category' | 'stale_target' | 'unused_rule';

export interface CategoryMapException {
  kind: CategoryMapExceptionKind;
  categoryKey: string;
  categoryLabel: string;
  costCenterId?: string;
  itemCount: number; // observed items behind the key; 0 for unused_rule
  detail: string;
}

export function categoryMapExceptions(
  observed: ObservedCategory[],
  map: CategoryCenterMap[],
  centers: CostCenter[],
  dateISO: string,
): CategoryMapException[] {
  const day = dateISO.slice(0, 10);
  const observedKeys = new Set(observed.map((o) => o.key));
  const mapByKey = new Map(map.map((m) => [m.categoryKey, m]));
  const out: CategoryMapException[] = [];

  for (const o of observed) {
    const row = mapByKey.get(o.key);
    if (!row) {
      out.push({
        kind: 'unmapped_category',
        categoryKey: o.key,
        categoryLabel: o.label,
        itemCount: o.itemCount,
        detail: 'No rule - sales in this category fall back to the store center.',
      });
      continue;
    }
    const target = centerById(centers, row.costCenterId);
    if (!target) {
      out.push({
        kind: 'stale_target',
        categoryKey: o.key,
        categoryLabel: o.label,
        costCenterId: row.costCenterId,
        itemCount: o.itemCount,
        detail: 'Rule points at a cost center that no longer exists.',
      });
    } else if (!isPostingOpen(target, day)) {
      out.push({
        kind: 'stale_target',
        categoryKey: o.key,
        categoryLabel: o.label,
        costCenterId: row.costCenterId,
        itemCount: o.itemCount,
        detail: `Rule points at ${target.code}, which is not open for posting today.`,
      });
    }
  }

  for (const row of map) {
    if (observedKeys.has(row.categoryKey)) continue;
    out.push({
      kind: 'unused_rule',
      categoryKey: row.categoryKey,
      categoryLabel: row.categoryLabel,
      costCenterId: row.costCenterId,
      itemCount: 0,
      detail: 'Rule matches no item in the catalog (typo, or the category was retired).',
    });
  }

  return out;
}

// Sales value still landing on the fallback center because its category has no usable rule. Takes
// plain { itemId, amount } lines so this module never imports the sales/purchasing types - the
// caller decides what "amount" means (the Expenses page passes net-of-discount, ex-VAT).
export interface UnmappedRevenue {
  revenue: number; // round2
  lineCount: number;
}

export function unmappedCategoryRevenue(
  soldLines: Array<{ itemId: string; amount: number }>,
  items: Array<{ id: string; category: string }>,
  map: CategoryCenterMap[],
): UnmappedRevenue {
  const keyByItemId = new Map(items.map((i) => [i.id, normalizeCategoryKey(i.category ?? '')]));
  const mappedKeys = new Set(map.map((m) => m.categoryKey));
  let revenue = 0;
  let lineCount = 0;
  for (const line of soldLines) {
    const key = keyByItemId.get(line.itemId);
    if (key !== undefined && mappedKeys.has(key)) continue;
    revenue += line.amount;
    lineCount += 1;
  }
  return { revenue: round2(revenue), lineCount };
}
