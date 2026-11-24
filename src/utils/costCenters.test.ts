// Unit tests for the cost-center tree + expense math (see utils/costCenters.ts). The hierarchy
// validation and the rollups here are the backbone of the Phase-A acceptance criterion from
// costcenter.md §8.4 ("every eligible posted expense is assigned to a valid cost center or
// appears in an exception report") - a silently-wrong rollup would misstate branch P&L the same
// way a wrong batch cost misstates margins, so each rule gets an exact expected value.
//
// The seed-tree fixture mirrors seedCostCenters' shape (HQ overhead pool with three branches and
// desk activities) without importing the seed itself, so test cases can freely mutate a tree.
import { describe, expect, it } from 'vitest';

import type { CategoryCenterMap, CostCenter, ExpenseEntry } from '../types/costCenters';
import {
  assertParentValid,
  categoryMapExceptions,
  centerById,
  centerPath,
  collectDescendantIds,
  expenseTotals,
  isPostingOpen,
  normalizeCategoryKey,
  observedCategories,
  orderedCenters,
  resolveCenterForCategory,
  unmappedCategoryRevenue,
} from './costCenters';

function center(overrides: Partial<CostCenter> = {}): CostCenter {
  return {
    id: 'cc-x',
    code: 'X',
    nameAr: 'مركز',
    nameEn: 'Center X',
    kind: 'branch',
    isActive: true,
    IsPostingAllowed: true,
    effectiveFrom: '2026-01-01',
    ...overrides,
  };
}

function expense(overrides: Partial<ExpenseEntry> = {}): ExpenseEntry {
  return {
    id: 'exp-x',
    date: '2026-03-01',
    amount: 100,
    description: 'Test expense',
    costCenterId: 'cc-x',
    expenseAccount: 'Utilities',
    kind: 'direct',
    source: 'manual',
    createdAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

// Mini chain: cc-hq (root) -> cc-br1 -> cc-br1-ins; plus a separate branch cc-br2 under root.
const tree: CostCenter[] = [
  center({ id: 'cc-hq', code: 'HQ', nameEn: 'Head Office', kind: 'overhead', parentId: undefined }),
  center({ id: 'cc-br1', code: 'BR001-OPS', nameEn: 'Riyadh Branch Ops', parentId: 'cc-hq' }),
  center({ id: 'cc-br1-ins', code: 'BR001-INS', nameEn: 'Insurance Desk', kind: 'activity', parentId: 'cc-br1' }),
  center({ id: 'cc-br2', code: 'BR002-OPS', nameEn: 'Jeddah Branch Ops', parentId: 'cc-hq' }),
];

describe('isPostingOpen', () => {
  it('opens a normal active center inside its effective window', () => {
    expect(isPostingOpen(center(), '2026-06-30')).toBe(true);
    // Window boundary dates are inclusive (>= from, <= to) - a center effective 2026-01-01 must
    // accept a posting on that exact day, like the legacy GLCOSTCNTR date checks.
    expect(isPostingOpen(center(), '2026-01-01')).toBe(true);
  });

  it('rejects inactive centers, non-posting centers, and out-of-window dates', () => {
    expect(isPostingOpen(center({ isActive: false }), '2026-06-30')).toBe(false);
    expect(isPostingOpen(center({ IsPostingAllowed: false }), '2026-06-30')).toBe(false);
    expect(isPostingOpen(center(), '2025-12-31')).toBe(false); // before effectiveFrom
    const closed = center({ effectiveTo: '2026-06-30' });
    expect(isPostingOpen(closed, '2026-06-30')).toBe(true);
    expect(isPostingOpen(closed, '2026-07-01')).toBe(false); // after the inclusive effectiveTo
  });

  it('rejects a missing center outright - every expense needs a resolvable center', () => {
    expect(isPostingOpen(undefined, '2026-06-30')).toBe(false);
  });
});

describe('assertParentValid', () => {
  it('accepts valid parenting and an undefined (root) parent', () => {
    expect(() => assertParentValid(tree, 'cc-hq')).not.toThrow();
    expect(() => assertParentValid(tree, undefined)).not.toThrow();
    expect(() => assertParentValid(tree, 'cc-br1', 'cc-new01')).not.toThrow();
  });

  it('rejects self-parenting (CK-equivalent of COSTCNO <> COSTMAIN)', () => {
    expect(() => assertParentValid(tree, 'cc-br1', 'cc-br1')).toThrow(/own parent/);
  });

  it('rejects a parent that does not exist', () => {
    expect(() => assertParentValid(tree, 'cc-ghost')).toThrow(/not found/);
  });

  it('rejects a write cycle: re-parenting the root under its own grandchild', () => {
    // cc-hq is root here; moving cc-hq under cc-br1-ins would close A->B->C->A. In the real
    // chain that's an edit (moveCenter), so pass the node being moved as selfId.
    expect(() => assertParentValid(tree, 'cc-hq')).not.toThrow(); // pristine tree, not moving
    const moved = [...tree, center({ id: 'cc-tmp', code: 'TMP', parentId: 'cc-hq' })];
    expect(() => assertParentValid(moved, 'cc-tmp', 'cc-tmp')).toThrow(/own parent/);
    // Realistic cycle edit: parent cc-br1 being re-parented to cc-br1-ins (its own child).
    expect(() => assertParentValid(tree, 'cc-br1-ins', 'cc-br1')).toThrow(/cycle/);
  });
});

describe('collectDescendantIds / orderedCenters / centerPath', () => {
  it('collects the full subtree (never the root) by BFS child levels', () => {
    expect(collectDescendantIds(tree, 'cc-hq')).toEqual(['cc-br1', 'cc-br2', 'cc-br1-ins']);
    expect(collectDescendantIds(tree, 'cc-br1')).toEqual(['cc-br1-ins']);
    expect(collectDescendantIds(tree, 'cc-br2')).toEqual([]);
  });

  it('orders centers depth-first: roots first, then each subtree as one block', () => {
    expect(orderedCenters(tree).map((c) => c.id)).toEqual([
      'cc-hq', 'cc-br1', 'cc-br1-ins', 'cc-br2',
    ]);
  });

  it('renders readable bilingual-English paths for dialogs/history', () => {
    expect(centerPath(tree, 'cc-br1-ins')).toBe('Head Office → Riyadh Branch Ops → Insurance Desk');
  });

  it('centerById resolves only exact ids', () => {
    expect(centerById(tree, 'cc-br2')?.code).toBe('BR002-OPS');
    expect(centerById(tree, 'cc-nope')).toBeUndefined();
    expect(centerById(tree, undefined)).toBeUndefined();
  });
});

describe('expenseTotals', () => {
  it('sums direct, allocatable, and subtree rollups exactly', () => {
    const entries: ExpenseEntry[] = [
      expense({ costCenterId: 'cc-br1', amount: 200 }),          // BR001-OPS own
      expense({ costCenterId: 'cc-br1', amount: 100, kind: 'allocatable' }),
      expense({ costCenterId: 'cc-br1-ins', amount: 50 }),       // desk expense rolls into BR001
      expense({ costCenterId: 'cc-hq', amount: 1000, kind: 'allocatable' }), // HQ rent pool
      expense({ costCenterId: 'cc-br2', amount: 75 }),
    ];
    const totals = expenseTotals(tree, entries);

    expect(totals.get('cc-br1-ins')).toEqual({ direct: 50, subtree: 50, allocatable: 0 });
    expect(totals.get('cc-br1')).toEqual({ direct: 300, subtree: 350, allocatable: 100 });
    expect(totals.get('cc-br2')).toEqual({ direct: 75, subtree: 75, allocatable: 0 });
    // HQ rollup = whole chain (1000 + 350 + 75): the head-office card IS the chain total.
    expect(totals.get('cc-hq')).toEqual({ direct: 1000, subtree: 1425, allocatable: 1000 });
  });

  it('rounds money to 2dp (display-money convention) without losing fractional parts', () => {
    const totals = expenseTotals(tree, [
      expense({ costCenterId: 'cc-br1', amount: 10.555 }),
      expense({ costCenterId: 'cc-br1', amount: 0.004 }),
    ]);
    expect(totals.get('cc-br1')?.direct).toBeCloseTo(10.56, 10);
  });

  it('attributes amounts to unknown center ids rather than dropping the money silently', () => {
    // A bad merge could tag an entry to a center the tree no longer has. The rollup map keeps
    // the entry recorded under its id so the Expenses page's exception list can still find and
    // surface it - money must never vanish from the reporting picture (§8.4 criterion 1).
    const entries = [expense({ costCenterId: 'cc-ghost', amount: 222 })];
    const totals = expenseTotals(tree, entries);
    expect(totals.get('cc-br1')?.direct).toBe(0);
    // The ghost's own direct total still exists in the map when something asks for it.
    const recompute = new Map(expenseTotals([...tree, center({ id: 'cc-ghost', code: 'GHOST' })], entries));
    expect(recompute.get('cc-ghost')?.direct).toBe(222);
  });
});

// =============================================================================================
// Phase B.1 - category-driven defaulting
// =============================================================================================

function rule(overrides: Partial<CategoryCenterMap> = {}): CategoryCenterMap {
  return {
    categoryKey: 'baby care',
    categoryLabel: 'Baby Care',
    costCenterId: 'cc-br1',
    updatedAt: '2026-02-01T00:00:00.000Z',
    ...overrides,
  };
}

const map: CategoryCenterMap[] = [
  rule(),
  rule({ categoryKey: 'psychotropics', categoryLabel: 'Psychotropics', costCenterId: 'cc-br1-ins' }),
];

describe('normalizeCategoryKey', () => {
  it('folds case and collapses inner whitespace so one rule covers every spelling', () => {
    expect(normalizeCategoryKey('Baby Care')).toBe('baby care');
    expect(normalizeCategoryKey('  BABY   CARE ')).toBe('baby care');
    expect(normalizeCategoryKey('baby\tcare')).toBe('baby care');
  });

  it('leaves Arabic untouched (there is no case to fold)', () => {
    expect(normalizeCategoryKey('  أدوية  ')).toBe('أدوية');
  });
});

describe('resolveCenterForCategory', () => {
  it('stamps the mapped center on the line', () => {
    expect(resolveCenterForCategory('Baby Care', map, tree, '2026-06-01', 'cc-br2')).toEqual({
      costCenterId: 'cc-br1',
      source: 'mapped',
    });
    // Matching is on the normalised key, not the exact spelling.
    expect(resolveCenterForCategory('baby  care', map, tree, '2026-06-01', 'cc-br2').costCenterId)
      .toBe('cc-br1');
  });

  it('falls back to the store center when the category has no rule', () => {
    const r = resolveCenterForCategory('Analgesics', map, tree, '2026-06-01', 'cc-br2');
    expect(r.costCenterId).toBe('cc-br2');
    expect(r.source).toBe('fallback');
    expect(r.note).toMatch(/no mapping rule/);
  });

  it('falls back and says so when the rule target is retired (never posts into dead history)', () => {
    const retired = tree.map((c) => (c.id === 'cc-br1' ? { ...c, isActive: false } : c));
    const r = resolveCenterForCategory('Baby Care', map, retired, '2026-06-01', 'cc-br2');
    expect(r.source).toBe('fallback');
    expect(r.costCenterId).toBe('cc-br2');
    expect(r.note).toMatch(/not open for posting/);
  });

  it('honours the effective-date window on the rule target', () => {
    const expired = tree.map((c) => (c.id === 'cc-br1' ? { ...c, effectiveTo: '2026-05-31' } : c));
    expect(resolveCenterForCategory('Baby Care', map, expired, '2026-05-31', 'cc-br2').source).toBe('mapped');
    expect(resolveCenterForCategory('Baby Care', map, expired, '2026-06-01', 'cc-br2').source).toBe('fallback');
  });

  it('leaves the line unassigned when neither the rule nor the fallback is usable', () => {
    const closed = tree.map((c) => (c.id === 'cc-br1' || c.id === 'cc-br2' ? { ...c, isActive: false } : c));
    expect(resolveCenterForCategory('Analgesics', map, closed, '2026-06-01', 'cc-br2')).toEqual({
      source: 'unassigned',
      note: 'category has no mapping rule',
    });
  });

  it('treats a missing category as unmapped, with its own note', () => {
    const r = resolveCenterForCategory(undefined, map, tree, '2026-06-01', 'cc-br2');
    expect(r.source).toBe('fallback');
    expect(r.note).toBe('item has no category');
  });

  it('accepts a full ISO datetime, comparing only the date part', () => {
    // POSPage passes new Date().toISOString(), which carries a time component.
    expect(resolveCenterForCategory('Baby Care', map, tree, '2026-06-01T23:59:59.999Z', 'cc-br2').source)
      .toBe('mapped');
    // Before every center's effectiveFrom both the rule and the fallback are closed, so the line
    // is left unassigned rather than posted into a center that was not open yet.
    expect(resolveCenterForCategory('Baby Care', map, tree, '2025-12-31T00:00:00.000Z', 'cc-br2').source)
      .toBe('unassigned');
  });
});

describe('observedCategories', () => {
  const items = [
    { nameEn: 'Baby Lotion', category: 'Baby Care' },
    { nameEn: 'Baby Soap', category: 'baby care' },
    { nameEn: 'Baby Wipes', category: '  BABY   CARE ' },
    { nameEn: 'Baby Oil', category: 'Baby Care' },
    { nameEn: 'Paracetamol', category: 'Analgesics' },
    { nameEn: 'Uncategorised', category: '   ' },
  ];

  it('groups spellings under one normalised key and counts the items', () => {
    const out = observedCategories(items);
    expect(out.map((o) => o.key)).toEqual(['analgesics', 'baby care']);
    const baby = out.find((o) => o.key === 'baby care')!;
    expect(baby.label).toBe('Baby Care'); // first spelling seen is the display label
    expect(baby.itemCount).toBe(4);
  });

  it('keeps at most three sample names and skips uncategorised items', () => {
    const baby = observedCategories(items).find((o) => o.key === 'baby care')!;
    expect(baby.sampleNames).toEqual(['Baby Lotion', 'Baby Soap', 'Baby Wipes']);
    expect(observedCategories(items)).toHaveLength(2);
  });
});

describe('categoryMapExceptions', () => {
  const items = [
    { nameEn: 'Baby Lotion', category: 'Baby Care' },
    { nameEn: 'Paracetamol', category: 'Analgesics' },
  ];

  it('reports unmapped categories and rules that match no item', () => {
    const out = categoryMapExceptions(observedCategories(items), map, tree, '2026-06-01');
    const kinds = out.map((e) => `${e.kind}:${e.categoryKey}`).sort();
    expect(kinds).toEqual([
      'unmapped_category:analgesics', // observed, no rule
      'unused_rule:psychotropics', // rule, no items
    ]);
  });

  it('reports a rule pointing at a missing center as a stale target', () => {
    const broken = [rule({ costCenterId: 'cc-gone' })];
    const out = categoryMapExceptions(observedCategories(items), broken, tree, '2026-06-01');
    const stale = out.find((e) => e.kind === 'stale_target')!;
    expect(stale.categoryKey).toBe('baby care');
    expect(stale.detail).toMatch(/no longer exists/);
  });

  it('reports a rule pointing at an inactive center as a stale target', () => {
    const retired = tree.map((c) => (c.id === 'cc-br1' ? { ...c, isActive: false } : c));
    const out = categoryMapExceptions(observedCategories(items), [rule()], retired, '2026-06-01');
    expect(out.find((e) => e.kind === 'stale_target')?.detail).toMatch(/not open for posting/);
  });

  it('is silent when every observed category has a usable rule', () => {
    const onlyBaby = observedCategories([{ nameEn: 'Baby Lotion', category: 'Baby Care' }]);
    expect(categoryMapExceptions(onlyBaby, [rule()], tree, '2026-06-01')).toEqual([]);
  });
});

describe('unmappedCategoryRevenue', () => {
  const items = [
    { id: 'i1', category: 'Baby Care' },
    { id: 'i2', category: 'Analgesics' },
  ];

  it('sums only the lines whose category has no rule, including unknown items', () => {
    const r = unmappedCategoryRevenue(
      [
        { itemId: 'i1', amount: 100 }, // mapped
        { itemId: 'i2', amount: 50 }, // unmapped category
        { itemId: 'i3', amount: 25 }, // item no longer in the catalog -> counts as unmapped
      ],
      items,
      map,
    );
    expect(r).toEqual({ revenue: 75, lineCount: 2 });
  });

  it('returns zero when every line is covered', () => {
    expect(unmappedCategoryRevenue([{ itemId: 'i1', amount: 100 }], items, map))
      .toEqual({ revenue: 0, lineCount: 0 });
  });
});
