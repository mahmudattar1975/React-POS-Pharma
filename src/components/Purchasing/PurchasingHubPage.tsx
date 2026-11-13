// One purchasing workspace with four tabs. Vendor invoices, the vendor master, direct stock
// receiving and head-office transfers all belong to the same supplier/stock-in workflow, so they
// share one nav entry instead of four. Each legacy URL is kept and still opens its own tab:
// /purchases, /vendors, /receiving and /head-office-receiving.
import { useLocation, useNavigate } from 'react-router-dom';
import { Box, Tab, Tabs, Typography } from '@mui/material';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import StorefrontIcon from '@mui/icons-material/Storefront';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import MoveToInboxIcon from '@mui/icons-material/MoveToInbox';
import PurchaseInvoicePage from './PurchaseInvoicePage';
import VendorsPage from './VendorsPage';
import ReceivingPage from '../Receiving/ReceivingPage';
import HeadOfficeReceivingPage from '../Receiving/HeadOfficeReceivingPage';

const TABS = [
  { path: '/purchases', label: 'Purchase Invoices (Vendor / Customer)', icon: <ReceiptLongIcon fontSize="small" /> },
  { path: '/vendors', label: 'Vendors & Customers', icon: <StorefrontIcon fontSize="small" /> },
  { path: '/receiving', label: 'Stock Receiving', icon: <LocalShippingIcon fontSize="small" /> },
  { path: '/head-office-receiving', label: 'Receive from Head Office', icon: <MoveToInboxIcon fontSize="small" /> },
];

export default function PurchasingHubPage() {
  const location = useLocation();
  const navigate = useNavigate();
  // Resolved from the path (not remembered in state) so a refresh or a pasted link always opens
  // the tab that URL names. Anything unexpected falls back to the vendor invoice tab.
  const tabIndex = Math.max(0, TABS.findIndex((entry) => entry.path === location.pathname));

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>Purchasing &amp; Receiving</Typography>
      <Typography variant="caption" color="text.secondary">
        Vendor invoices, the vendor master, direct stock receiving and head-office transfers
      </Typography>
      <Tabs
        value={tabIndex}
        onChange={(_, value: number) => navigate(TABS[value].path)}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ mt: 1.5, mb: 2.5, borderBottom: 1, borderColor: 'divider' }}
      >
        {TABS.map((entry) => (
          <Tab key={entry.path} icon={entry.icon} iconPosition="start" label={entry.label} sx={{ minHeight: 44 }} />
        ))}
      </Tabs>
      {tabIndex === 0 && <PurchaseInvoicePage />}
      {tabIndex === 1 && <VendorsPage />}
      {tabIndex === 2 && <ReceivingPage />}
      {tabIndex === 3 && <HeadOfficeReceivingPage />}
    </Box>
  );
}
