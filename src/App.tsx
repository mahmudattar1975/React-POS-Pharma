import { useEffect } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { theme } from './theme';
import { usePendingSyncStore } from './store/pendingSyncStore';
import AppLayout from './components/Layout/AppLayout';
import LoginPage from './components/Auth/LoginPage';
import RequireAuth from './components/Auth/RequireAuth';
import DrawerGate from './components/Auth/DrawerGate';
import SalesHubPage from './components/Sales/SalesHubPage';
import InventoryHubPage from './components/Inventory/InventoryHubPage';
import PurchasingHubPage from './components/Purchasing/PurchasingHubPage';
import OffersPage from './components/Offers/OffersPage';
import CostCentersHubPage from './components/CostCenters/CostCentersHubPage';
import ReportsPage from './components/Reports/ReportsPage';
import DashboardPage from './components/Dashboard/DashboardPage';
import WasfatyClaimsPage from './components/Reports/WasfatyClaimsPage';
import SettingsPage from './components/Settings/SettingsPage';
import { useAlertSounds } from './hooks/useAlertSounds';

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

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
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
                <Route path="/cost-centers" element={<CostCentersHubPage />} />
                <Route path="/expenses" element={<CostCentersHubPage />} />
                <Route path="/category-map" element={<CostCentersHubPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/wasfaty-claims" element={<WasfatyClaimsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                {/* The invoice ledger lives beside the till now (Point of Sale > ZATCA sales
                    invoices), so old /e-invoices links and bookmarks land there instead of on
                    Settings, which no longer owns the invoice list. */}
                <Route path="/e-invoices" element={<Navigate to="/sales-invoices" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
