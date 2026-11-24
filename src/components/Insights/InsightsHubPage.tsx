// The owner's analysis workspace is one sidebar entry with two tabs: the Dashboard for the
// at-a-glance view, and Reports for the same figures broken out into printable sections. Both
// pages stay addressable on their original URLs (/dashboard and /reports), so old links and the
// dashboard's "Detailed reports" button still land on the right tab.
import { useLocation, useNavigate } from 'react-router-dom';
import { Box, Tab, Tabs } from '@mui/material';
import InsightsIcon from '@mui/icons-material/Insights';
import BarChartIcon from '@mui/icons-material/BarChart';
import DashboardPage from '../Dashboard/DashboardPage';
import ReportsPage from '../Reports/ReportsPage';
import IncentiveReportPage from '../Incentives/IncentiveReportPage';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';

const TABS = [
  { path: '/dashboard', label: 'Dashboard', icon: <InsightsIcon fontSize="small" /> },
  { path: '/reports', label: 'Reports', icon: <BarChartIcon fontSize="small" /> },
  { path: '/incentive-report', label: 'Incentive Report', icon: <TrendingUpIcon fontSize="small" /> },
];

export default function InsightsHubPage() {
  const location = useLocation();
  const navigate = useNavigate();
  // Path-driven (not state) so a refresh on a tab keeps the owner where they were.
  const tabIndex = TABS.findIndex((entry) => entry.path === location.pathname);
  const activeTab = tabIndex === -1 ? 0 : tabIndex;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Tabs
        value={activeTab}
        onChange={(_, value: number) => navigate(TABS[value].path)}
        sx={{ flex: 'none', px: 2, pt: 1, borderBottom: 1, borderColor: 'divider' }}
      >
        {TABS.map((entry) => (
          <Tab key={entry.path} icon={entry.icon} iconPosition="start" label={entry.label} sx={{ minHeight: 44 }} />
        ))}
      </Tabs>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {activeTab === 0 ? <DashboardPage /> : activeTab === 1 ? <ReportsPage /> : <IncentiveReportPage />}
      </Box>
    </Box>
  );
}
