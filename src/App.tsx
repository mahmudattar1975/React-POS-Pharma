import { lazy, Suspense, useEffect } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { usePendingSyncStore } from './store/pendingSyncStore';
import { useRsdOutboxStore } from './store/rsdOutboxStore';
import { getBranchContext } from './api/branchApi';
import { getSharedCatalog } from './api/catalogApi';
import { useCatalogStore } from './store/catalogStore';
import type { Item } from './types/catalog';
import AppLayout from './components/Layout/AppLayout';
import LoginPage from './components/Auth/LoginPage';
import RequireAuth from './components/Auth/RequireAuth';
import DrawerGate from './components/Auth/DrawerGate';
import SalesHubPage from './components/Sales/SalesHubPage';
import InventoryHubPage from './components/Inventory/InventoryHubPage';
import PurchasingHubPage from './components/Purchasing/PurchasingHubPage';
import { useAlertSounds } from './hooks/useAlertSounds';

// The till, inventory and purchasing hubs stay eager: they are the cashier's hot path.
// Compliance, reporting and configuration screens load on demand so their heavy dependencies
// (spreadsheet export, QR/ZATCA panels, claim tooling) are not in the first paint.
const OffersPage = lazy(() => import('./components/Offers/OffersPage'));
const CostCentersHubPage = lazy(() => import('./components/CostCenters/CostCentersHubPage'));
const InsightsHubPage = lazy(() => import('./components/Insights/InsightsHubPage'));
const WasfatyClaimsPage = lazy(() => import('./components/Reports/WasfatyClaimsPage'));
const SettingsPage = lazy(() => import('./components/Settings/SettingsPage'));
const IncentiveReportPage = lazy(() => import('./components/Incentives/IncentiveReportPage'));
const ZatcaSetupPage = lazy(() => import('./components/Zatca/ZatcaSetupPage'));

export default function App() {
  // Every success / error / warning / info alert gets a matching short tone, so a message is
  // noticed even when the cashier's eyes are on the customer rather than the screen.
  useAlertSounds();

  // Retries any sale/return/receiving backup that failed earlier (server was down, etc.) - once
  // on load, then periodically, so a server that comes back online catches the SQL mirror back up
  // on its own instead of a human having to notice and fix drifted quantities by hand (see
  // store/pendingSyncStore.ts).
  useEffect(() => {
    const flush = () => usePendingSyncStore.getState().flush();
    flush();
    const interval = setInterval(flush, 60_000);
    return () => clearInterval(interval);
  }, []);

  // RSD reports each serialised drug pack in the background; a failed or unreachable report stays
  // in the outbox. Same cadence as the SQL mirror: once on load, then every 60 seconds. Terminal
  // SFDA rejections are never retried here - they wait for an operator (see the RSD tab).
  useEffect(() => {
    const flushRsd = () => useRsdOutboxStore.getState().flush();
    flushRsd();
    const interval = setInterval(flushRsd, 60_000);
    return () => clearInterval(interval);
  }, []);

  // This terminal's branch comes from config/branch.json on the server. Cache it in settings so
  // invoice numbers get the right prefix. If the server is unreachable, keep the last known value:
  // an offline pharmacy still sells, with the same branch stamped on every document.
  useEffect(() => {
    // getBranchContext() caches the configured terminal branch in settingsStore; an unconfigured
    // terminal deliberately keeps the historical numbering. Failure is advisory - an offline till
    // keeps the last known branch, and checkout retries the refresh before issuing a number.
    getBranchContext().catch(() => {
      // No notification at the till; the next successful boot or sale will refresh it.
    });
  }, []);

  // The item catalogue is shared across branches; stock is not. Adopt master rows that another
  // terminal imported (or that were seeded into SQL) into this browser's offline-first catalogue.
  // Failure is advisory: an offline till keeps working from its last known copy, and the next boot
  // retries. Local-only fields (pack ladders, directions, Wasfaty mapping) are preserved by the
  // store's merge, and batches are never touched by this call.
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    getSharedCatalog(controller.signal)
      .then((rows) => {
        if (rows.length === 0) return;
        const items: Item[] = rows.map((row) => ({
          id: row.id,
          barcode: row.barcode,
          nameAr: row.nameAr,
          nameEn: row.nameEn,
          unit: row.unit,
          category: row.category,
          basePrice: row.basePrice,
          vatRate: row.vatRate,
          requiresBatchTracking: row.requiresBatchTracking,
          reorderLevel: row.reorderLevel,
          controlledStatus: row.controlledStatus ?? undefined,
          // isActive is local to each terminal; upsertImportedItems keeps the existing flag and
          // only defaults genuinely new rows to active.
        }));
        useCatalogStore.getState().upsertImportedItems(items);
      })
      .catch(() => {
        // No till-facing alert: the local catalogue is still valid, and the next boot retries.
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  return (
    <BrowserRouter>
        <Suspense fallback={<Box sx={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              <Route element={<DrawerGate />}>
                <Route path="/" element={<SalesHubPage />} />
                <Route path="/inventory" element={<InventoryHubPage />} />
                <Route path="/items" element={<InventoryHubPage />} />
                <Route path="/manufacturers" element={<InventoryHubPage />} />
                <Route path="/dosages" element={<InventoryHubPage />} />
                <Route path="/wasfaty-mapping" element={<InventoryHubPage />} />
                <Route path="/purchases" element={<PurchasingHubPage />} />
                <Route path="/purchase-returns" element={<PurchasingHubPage />} />
                <Route path="/vendors" element={<PurchasingHubPage />} />
                <Route path="/offers" element={<OffersPage />} />
                <Route path="/receiving" element={<PurchasingHubPage />} />
                <Route path="/head-office-receiving" element={<PurchasingHubPage />} />
                <Route path="/returns" element={<SalesHubPage />} />
                <Route path="/sales-invoices" element={<SalesHubPage />} />
                <Route path="/rsd-reporting" element={<SalesHubPage />} />
                <Route path="/controlled-register" element={<SalesHubPage />} />
                <Route path="/cost-centers" element={<CostCentersHubPage />} />
                <Route path="/expenses" element={<CostCentersHubPage />} />
                <Route path="/category-map" element={<CostCentersHubPage />} />
                <Route path="/reports" element={<InsightsHubPage />} />
                <Route path="/dashboard" element={<InsightsHubPage />} />
                {/* Prescriptions and Incentive Items are Point of Sale tabs, so their direct URLs
                    must land on the hub; otherwise the tab strip disappears. */}
                <Route path="/prescriptions" element={<SalesHubPage />} />
                <Route path="/wasfaty-claims" element={<WasfatyClaimsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/incentives" element={<SalesHubPage />} />
                <Route path="/incentive-report" element={<IncentiveReportPage />} />
                {/* Guided data-entry screen for a pharmacy that is onboarding ZATCA for the first
                    time. It shows the checklist and both setup panels on one page; Settings keeps
                    the same panels for an operator who only wants to change one field. */}
                <Route path="/zatca-setup" element={<ZatcaSetupPage />} />
                {/* The invoice ledger lives beside the till now (Point of Sale > ZATCA sales
                    invoices), so old /e-invoices links and bookmarks land there instead of on
                    Settings, which no longer owns the invoice list. */}
                <Route path="/e-invoices" element={<Navigate to="/sales-invoices" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Route>
          </Route>
        </Routes>
        </Suspense>
    </BrowserRouter>
  );
}
