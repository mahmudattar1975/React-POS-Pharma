import { useEffect } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { theme } from './theme';
import { usePendingSyncStore } from './store/pendingSyncStore';
import AppLayout from './components/Layout/AppLayout';
import LoginPage from './components/Auth/LoginPage';
import RequireAuth from './components/Auth/RequireAuth';
import DrawerGate from './components/Auth/DrawerGate';
import POSPage from './components/POS/POSPage';
import InventoryPage from './components/Inventory/InventoryPage';
import OffersPage from './components/Offers/OffersPage';
import ReceivingPage from './components/Receiving/ReceivingPage';
import HeadOfficeReceivingPage from './components/Receiving/HeadOfficeReceivingPage';
import ReturnsPage from './components/Returns/ReturnsPage';
import ReportsPage from './components/Reports/ReportsPage';
import SettingsPage from './components/Settings/SettingsPage';

export default function App() {
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
                <Route path="/" element={<POSPage />} />
                <Route path="/inventory" element={<InventoryPage />} />
                <Route path="/offers" element={<OffersPage />} />
                <Route path="/receiving" element={<ReceivingPage />} />
                <Route path="/head-office-receiving" element={<HeadOfficeReceivingPage />} />
                <Route path="/returns" element={<ReturnsPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
