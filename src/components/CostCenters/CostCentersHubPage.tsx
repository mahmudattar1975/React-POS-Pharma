// The three accounting screens share one workspace: the centre tree defines where money can go,
// Category → Center decides which centre a sales category posts to, and Expenses records spend
// against those centres. Kept as tabs (not three sidebar rows) because they are one mental model
// and are edited by the same person.
// Legacy URLs are preserved so existing links still open the right tab: /cost-centers,
// /category-map and /expenses.
import { useLocation, useNavigate } from 'react-router-dom';
import { Box, Tab, Tabs, Typography } from '@mui/material';
import { coloredTabSx, coloredTabsIndicatorSx } from '../common/tabStyles';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import CategoryIcon from '@mui/icons-material/Category';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import CostCentersPage from './CostCentersPage';
import CategoryMapPage from './CategoryMapPage';
import ExpensesPage from './ExpensesPage';

const TABS = [
  { path: '/cost-centers', label: 'Cost Centers', icon: <AccountTreeIcon fontSize="small" />, color: '#283593' }, // structure
  { path: '/category-map', label: 'Category → Center', icon: <CategoryIcon fontSize="small" />, color: '#00695c' }, // routing
  { path: '/expenses', label: 'Expenses', icon: <AccountBalanceWalletIcon fontSize="small" />, color: '#b3261e' }, // spend
];

export default function CostCentersHubPage() {
  const location = useLocation();
  const navigate = useNavigate();
  // Resolved from the URL rather than remembered, so refresh/deep link always opens the named tab.
  const tabIndex = Math.max(0, TABS.findIndex((entry) => entry.path === location.pathname));

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>Cost Centers &amp; Expenses</Typography>
      <Typography variant="caption" color="text.secondary">
        Centre structure, category routing rules and expense postings
      </Typography>
      <Tabs
        value={tabIndex}
        onChange={(_, value: number) => navigate(TABS[value].path)}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ mt: 1.5, mb: 2.5, borderBottom: 1, borderColor: 'divider', ...coloredTabsIndicatorSx(TABS[tabIndex].color) }}
      >
        {TABS.map((entry) => (
          <Tab key={entry.path} icon={entry.icon} iconPosition="start" label={entry.label} sx={coloredTabSx(entry.color)} />
        ))}
      </Tabs>
      {tabIndex === 0 && <CostCentersPage />}
      {tabIndex === 1 && <CategoryMapPage />}
      {tabIndex === 2 && <ExpensesPage />}
    </Box>
  );
}
