// Branch-filtered views over the local-first stores. The stores keep the full persisted history
// (so switching terminals never destroys another branch's documents); every screen reads through
// these hooks instead, which is what makes a branch a data boundary rather than a sidebar label.
import { useMemo } from 'react';
import type { Batch } from '../types/catalog';
import type { PurchaseInvoice } from '../types/purchasing';
import type { ReturnHeader, SaleHeader } from '../types/sales';
import { LEGACY_BRANCH_ID, rowsForBranch } from '../utils/branchScope';
import { useCatalogStore } from './catalogStore';
import type { ReceivingEvent } from './catalogStore';
import { usePurchasingStore } from './purchasingStore';
import { useSalesStore } from './salesStore';
import { useSettingsStore } from './settingsStore';

export function useCurrentBranchId(): string {
  return useSettingsStore((s) => s.settings.branchId?.trim() || LEGACY_BRANCH_ID);
}

export function useBranchSales(): SaleHeader[] {
  const invoices = useSalesStore((s) => s.invoices);
  const branchId = useCurrentBranchId();
  return useMemo(() => rowsForBranch(invoices, branchId), [invoices, branchId]);
}

export function useBranchSalesReturns(): ReturnHeader[] {
  const returns = useSalesStore((s) => s.returns);
  const branchId = useCurrentBranchId();
  return useMemo(() => rowsForBranch(returns, branchId), [returns, branchId]);
}

export function useBranchPurchases(): PurchaseInvoice[] {
  const invoices = usePurchasingStore((s) => s.invoices);
  const branchId = useCurrentBranchId();
  return useMemo(() => rowsForBranch(invoices, branchId), [invoices, branchId]);
}

export function useBranchBatches(): Batch[] {
  const batches = useCatalogStore((s) => s.batches);
  const branchId = useCurrentBranchId();
  return useMemo(() => rowsForBranch(batches, branchId), [batches, branchId]);
}

export function useBranchReceivingLog(): ReceivingEvent[] {
  const receivingLog = useCatalogStore((s) => s.receivingLog);
  const branchId = useCurrentBranchId();
  return useMemo(() => rowsForBranch(receivingLog, branchId), [receivingLog, branchId]);
}
