// Branch ownership for the browser's local-first records.
//
// The server already stamps SQL sales/returns/batches with the terminal branch from
// config/branch.json. The old browser stores did not: one localStorage held every document ever
// issued on this PC, so changing the terminal branch only relabelled the sidebar - old invoices,
// stock and reports stayed visible. Every local row now carries branchId; rows saved before this
// existed are treated as the unconfigured demo register (Riyadh, cc-br-001), which is the branch
// the server used as its fallback. New rows are stamped from the cached /api/context branch.
import type { BranchContext } from '../types/branch';
import { useSettingsStore } from '../store/settingsStore';

// Same id as server/src/branch.ts's fallback and the RIY seed row in prisma/seed.ts.
export const LEGACY_BRANCH_ID = 'cc-br-001';

// The catalog ships with demo stock so a brand-new till can sell immediately. That starter stock
// is not any real branch's received goods, so it stays visible on every terminal; real stock
// posted through receiving/purchasing is stamped with the terminal branch and stays branch-owned.
export const SHARED_SEED_BRANCH_ID = 'shared-seed';

export function currentBranchId(): string {
  return useSettingsStore.getState().settings.branchId?.trim() || LEGACY_BRANCH_ID;
}

export function branchIdOf(row?: { branchId?: string } | null): string {
  return row?.branchId?.trim() || LEGACY_BRANCH_ID;
}

export function belongsToBranch<T extends { branchId?: string }>(row: T, branchId: string): boolean {
  const owner = branchIdOf(row);
  return owner === SHARED_SEED_BRANCH_ID || owner === branchId;
}

export function belongsToCurrentBranch<T extends { branchId?: string }>(row: T): boolean {
  return belongsToBranch(row, currentBranchId());
}

export function rowsForBranch<T extends { branchId?: string }>(rows: T[], branchId: string): T[] {
  return rows.filter((row) => belongsToBranch(row, branchId));
}

export function stampBranch<T extends { branchId?: string }>(row: T, branchId = currentBranchId()): T {
  return { ...row, branchId };
}

export function stampLegacyBranch<T extends { branchId?: string }>(row: T): T {
  return row.branchId ? row : { ...row, branchId: LEGACY_BRANCH_ID };
}

// Applied by GET /api/context, which is called at boot AND again just before checkout. The
// checkout refresh matters when the cashier changed branch.json without hard-refreshing the
// browser: the sale must never inherit a stale unprefixed number from the previous register.
export function applyBranchContext(ctx: BranchContext): void {
  if (!ctx.configured) return;
  const settings = useSettingsStore.getState().settings;
  useSettingsStore.getState().update({
    branchId: ctx.branch.id,
    branchCode: ctx.branch.code,
    branchNameEn: ctx.branch.nameEn,
    branchNameAr: ctx.branch.nameAr,
    costCenterId: ctx.branch.costCenterId || settings.costCenterId,
  });
}
