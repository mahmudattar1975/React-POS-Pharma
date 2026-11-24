// Selling, refunding and the invoices those two produce are one counter workflow: the cashier
// rings up a basket, takes goods back, and may need the tax invoice ZATCA stamped for either.
// They share one nav entry ("Point of Sale") with six tabs. /returns, /sales-invoices,
// /rsd-reporting and /controlled-register keep working as direct links so a bookmark or a pasted
// URL still opens the right tab; "/" keeps opening the till.
//
// The controlled-drug register lives here rather than under Reports because it is written by the
// same counter actions (dispense, return, write-off) and is read at the same counter. RSD
// reporting lives here for the same reason: it is the other half of what the counter did.
//
// Deliberately no page heading here - the POS screen fills the viewport and a second title bar
// would eat selling space. The tab strip alone tells you which side of the counter you're on.
import { useLocation, useNavigate } from 'react-router-dom';
import { Box, Tab, Tabs } from '@mui/material';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import AssignmentReturnIcon from '@mui/icons-material/AssignmentReturn';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import MedicationIcon from '@mui/icons-material/Medication';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import TrackChangesIcon from '@mui/icons-material/TrackChanges';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import POSPage from '../POS/POSPage';
import ReturnsPage from '../Returns/ReturnsPage';
import PrescriptionsPage from '../Prescriptions/PrescriptionsPage';
import ControlledRegisterPage from '../Prescriptions/ControlledRegisterPage';
import ZatcaInvoicesPanel from '../Zatca/ZatcaInvoicesPanel';
import RsdMonitoringPanel from '../Rsd/RsdMonitoringPanel';
import IncentiveItemsPage from '../Incentives/IncentiveItemsPage';

const TABS = [
  { path: '/', label: 'Sell', icon: <PointOfSaleIcon fontSize="small" /> },
  { path: '/prescriptions', label: 'Prescriptions', icon: <MedicationIcon fontSize="small" /> },
  { path: '/controlled-register', label: 'Controlled Register', icon: <FactCheckOutlinedIcon fontSize="small" /> },
  { path: '/returns', label: 'Returns', icon: <AssignmentReturnIcon fontSize="small" /> },
  { path: '/sales-invoices', label: 'ZATCA Sales Invoices', icon: <ReceiptLongIcon fontSize="small" /> },
  { path: '/rsd-reporting', label: 'RSD Reporting', icon: <TrackChangesIcon fontSize="small" /> },
  { path: '/incentives', label: 'Incentive Items', icon: <TrendingUpIcon fontSize="small" /> },
];

export default function SalesHubPage() {
  const location = useLocation();
  const navigate = useNavigate();
  // Path-driven (not state) so a refresh on a tab keeps the cashier where they were.
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
      {/* POSPage sizes itself to 100% height, so the content slot must be a bounded flex child
          (minHeight 0) instead of an auto-height wrapper. The invoice ledger is taller than the
          viewport, so it gets its own scroll container and the same page padding Settings gave it. */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        {activeTab === 0 && <POSPage />}
        {activeTab === 1 && (
          <Box sx={{ height: '100%', overflow: 'auto' }}>
            <PrescriptionsPage />
          </Box>
        )}
        {activeTab === 2 && (
          <Box sx={{ height: '100%', overflow: 'auto' }}>
            <ControlledRegisterPage />
          </Box>
        )}
        {activeTab === 3 && <ReturnsPage />}
        {activeTab === 4 && (
          <Box sx={{ height: '100%', overflow: 'auto', p: 3 }}>
            <Box sx={{ maxWidth: 1200 }}>
              <ZatcaInvoicesPanel />
            </Box>
          </Box>
        )}
        {activeTab === 5 && (
          <Box sx={{ height: '100%', overflow: 'auto', p: 3 }}>
            <RsdMonitoringPanel />
          </Box>
        )}
        {activeTab === 6 && (
          <Box sx={{ height: '100%', overflow: 'auto', p: 3 }}>
            <IncentiveItemsPage />
          </Box>
        )}
      </Box>
    </Box>
  );
}
