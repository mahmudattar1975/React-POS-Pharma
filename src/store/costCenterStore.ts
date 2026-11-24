// Cost-center master + manual expense ledger (Phase A, see costcenter.md §7.4). The store owns:
// - the center tree (seeded from seedCostCenters, extendable through the Cost Centers page)
// - the expense entries booked on the Expenses page (direct + allocatable, see types/costCenters)
//
// Posting VALIDATIONS are enforced here (addExpense runs isPostingOpen/assertParentValid from
// utils/costCenters.ts) rather than in the page, so any future integration feed (payroll, GL
// import - Phase B/C) can reuse this store and get the same guards for free: no posting to an
// inactive, expired, non-posting, or out-of-window center, no self/cyclic parenting.
//
// Note what is deliberately NOT here: no stored expense totals. Actuals are derived from the
// entries themselves in utils/costCenters.ts's expenseTotals (the design doc's
// "never keep an actuals total that can drift" rule), and no stock/GL writes - a manual expense
// doesn't move inventory and the GL mirror (SQL Server, §7.2 of costcenter.md) comes later.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CategoryCenterMap, CostCenter, ExpenseEntry } from '../types/costCenters';
import { seedCostCenters } from '../utils/seedData';
import { assertParentValid, isPostingOpen, normalizeCategoryKey } from '../utils/costCenters';

interface CostCenterState {
  centers: CostCenter[];
  expenses: ExpenseEntry[];
  // Phase B.1: "items in category X are accounted for by center Y" - one row per normalised
  // category key. Kept as a flat array rather than a Record so it round-trips through the same
  // persist/merge path as `centers`, and so an unused rule stays visible in the exception report.
  categoryMap: CategoryCenterMap[];
  // Types accept the raw creation input; id/createdAt/source are assigned here so callers can't
  // forget the audit trail (legacy writes faddedby/faddedon on every row for the same reason).
  addCenter: (input: Omit<CostCenter, 'id'>) => CostCenter;
  addExpense: (input: Omit<ExpenseEntry, 'id' | 'createdAt' | 'source'>) => ExpenseEntry;
  centerById: (id: string | undefined) => CostCenter | undefined;
  // Upsert by normalised key: saving the same category twice edits the rule, never duplicates it.
  setCategoryMapping: (input: { categoryLabel: string; costCenterId: string; updatedBy?: string }) => CategoryCenterMap;
  clearCategoryMapping: (categoryKey: string) => void;
  // Allocation drivers (Phase B.1) - stored on the center because the SQL mirror keeps them as
  // SPACE_SQM / HEADCOUNT columns (§7.2); undefined clears the value.
  setDrivers: (centerId: string, drivers: { spaceSqm?: number; headcount?: number }) => void;
}

// Same id convention as the other stores' documents (ven-/pur-): short prefix + timestamp keeps
// ids unique and greppable when debugging a localStorage snapshot.
export function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useCostCenterStore = create<CostCenterState>()(
  persist(
    (set, get) => ({
      centers: seedCostCenters,
      expenses: [],
      // Seeded empty on purpose: a pre-filled map would encode assumptions about the chain's
      // department structure that the accountant has not confirmed (open question §9.5).
      categoryMap: [],

      addCenter: (input) => {
        // Parent validation BEFORE adding: self-parenting, unknown parent, and write cycles
        // (A→B→A) are exactly the hierarchy corruptions the SQL mirror's recursive-CTE check
        // guards against - catching them here keeps the browser tree trustworthy, not just
        // the eventual server copy.
        assertParentValid([...get().centers, { ...input, id: '__new__' }], input.parentId, '__new__');
        const center: CostCenter = { ...input, id: makeId('cc') };
        set((s) => ({ centers: [...s.centers, center] }));
        return center;
      },

      addExpense: (input) => {
        const center = get().centerById(input.costCenterId);
        if (!isPostingOpen(center, input.date)) {
          throw new Error(
            center
              ? `Cost center ${center.nameEn} is not open for posting on ${input.date} (inactive, closed window, or posting disabled).`
              : 'Expense must be assigned to a valid cost center.'
          );
        }
        if (!(input.amount > 0)) {
          throw new Error('Expense amount must be greater than zero.');
        }
        const entry: ExpenseEntry = {
          ...input,
          id: makeId('exp'),
          source: 'manual',
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ expenses: [...s.expenses, entry] }));
        return entry;
      },

      centerById: (id) =>
        id === undefined ? undefined : get().centers.find((c) => c.id === id),

      setCategoryMapping: ({ categoryLabel, costCenterId, updatedBy }) => {
        const label = categoryLabel.trim();
        if (!label) throw new Error('Choose a category first.');
        const target = get().centerById(costCenterId);
        if (!target) throw new Error('Cost center was not found.');
        // An overhead pool is a SOURCE of allocations, never the accountable owner of a sale
        // category (§10.4) - mapping one here would double-count once Phase D posts.
        if (target.kind === 'overhead') {
          throw new Error(`${target.nameEn} is an overhead pool - map categories to a branch or activity center.`);
        }
        if (!target.isActive) throw new Error(`${target.nameEn} is inactive.`);
        if (!target.IsPostingAllowed) throw new Error(`${target.nameEn} does not allow posting.`);

        const row: CategoryCenterMap = {
          categoryKey: normalizeCategoryKey(label),
          categoryLabel: label,
          costCenterId,
          updatedAt: new Date().toISOString(),
          updatedBy,
        };
        // Replace-in-place keeps exactly one rule per key (the upsert contract) and keeps the
        // array order stable so the table does not jump around after a save.
        set((s) => ({
          categoryMap: s.categoryMap.some((m) => m.categoryKey === row.categoryKey)
            ? s.categoryMap.map((m) => (m.categoryKey === row.categoryKey ? row : m))
            : [...s.categoryMap, row],
        }));
        return row;
      },

      clearCategoryMapping: (categoryKey) =>
        set((s) => ({ categoryMap: s.categoryMap.filter((m) => m.categoryKey !== categoryKey) })),

      setDrivers: (centerId, drivers) => {
        const target = get().centerById(centerId);
        if (!target) throw new Error('Cost center was not found.');
        if (target.kind === 'overhead') {
          throw new Error('Enter drivers on the operating centers (branch or activity) that receive allocations.');
        }
        for (const [field, value] of [
          ['Floor area', drivers.spaceSqm],
          ['Headcount', drivers.headcount],
        ] as const) {
          if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
            throw new Error(`${field} must be zero or a positive number.`);
          }
        }
        set((s) => ({
          centers: s.centers.map((c) =>
            c.id === centerId
              ? { ...c, spaceSqm: drivers.spaceSqm, headcount: drivers.headcount }
              : c
          ),
        }));
      },
    }),
    {
      name: 'pharmacy-cost-centers',
      // Same merge philosophy as purchasingStore's comment: keep whatever this browser already
      // persisted (user-created centers + entered expenses), but APPEND any NEWLY-added seed
      // center so an existing session still sees fresh seed entries instead of silently missing
      // the closed-kiosk example or a later-seeded branch.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<CostCenterState>;
        const persistedCenters = p.centers ?? current.centers;
        const persistedIds = new Set(persistedCenters.map((c) => c.id));
        const persistedExpenses = p.expenses ?? current.expenses;
        return {
          ...current,
          ...p,
          centers: [...persistedCenters, ...current.centers.filter((c) => !persistedIds.has(c.id))],
          expenses: persistedExpenses,
        };
      },
    }
  )
);
