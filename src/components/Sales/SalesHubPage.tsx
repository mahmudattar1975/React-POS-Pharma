// Selling, refunding and the invoices those two produce are one counter workflow: the cashier
// rings up a basket, takes goods back, and may need the tax invoice ZATCA stamped for either.
// They share one nav entry ("Point of Sale") with seven tabs. /returns, /sales-invoices and
// /controlled-register keep working as direct links so a bookmark or a pasted URL still opens the
// right tab; "/" keeps opening the till. Incentive Items joins the same counter workspace because
// its rates are maintained by the same people who run the till.
//
// The controlled-drug register lives here rather than under Reports because it is written by the
// same counter actions (dispense, return, write-off) and is read at the same counter.
//
// Deliberately no page heading here - the POS screen fills the viewport and a second title bar
// would eat selling space. The tab strip alone tells you which side of the counter you're on.
import { useLocation, useNavigate } from 'react-router-dom';
import { Box, Tab, Tabs } from '@mui/material';
import { coloredTabSx, coloredTabsIndicatorSx } from '../common/tabStyles';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import AssignmentReturnIcon from '@mui/icons-material/AssignmentReturn';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import MedicationIcon from '@mui/icons-material/Medication';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import POSPage from '../POS/POSPage';
import ReturnsPage from '../Returns/ReturnsPage';
import PrescriptionsPage from '../Prescriptions/PrescriptionsPage';
import ControlledRegisterPage from '../Prescriptions/ControlledRegisterPage';
import ZatcaInvoicesPanel from '../Zatca/ZatcaInvoicesPanel';
import RsdMonitorPage from '../Rsd/RsdMonitorPage';
import IncentiveItemsPage from '../Incentives/IncentiveItemsPage';

// Each tab gets a semantic colour so the cashier can recognise the workspace at a glance.
// Short on-screen labels keep the tab strip compact; ariaLabel gives screen readers (and the
// accessibility-tree based E2E suite) the full name of the compliance workspaces.
const TABS = [
  { path: '/', label: 'Sell', ariaLabel: 'Sell', icon: <PointOfSaleIcon fontSize="small" />, color: '#1f5e40' }, // sale / money in
  { path: '/returns', label: 'Returns', ariaLabel: 'Returns', icon: <AssignmentReturnIcon fontSize="small" />, color: '#7d5714' }, // reversal
  { path: '/incentives', label: 'Incentives', ariaLabel: 'Incentives', icon: <TrendingUpIcon fontSize="small" />, color: '#7b1fa2' }, // bonus rules
  { path: '/prescriptions', label: 'Prescriptions', ariaLabel: 'Prescriptions', icon: <MedicationIcon fontSize="small" />, color: '#1565c0' }, // clinical
  { path: '/sales-invoices', label: 'ZATCA Sale', ariaLabel: 'ZATCA Sales Invoices', icon: <ReceiptLongIcon fontSize="small" />, color: '#283593' }, // tax / compliance
  { path: '/controlled-register', label: 'Controlled', ariaLabel: 'Controlled', icon: <FactCheckOutlinedIcon fontSize="small" />, color: '#b3261e' }, // restricted
  { path: '/rsd-reporting', label: 'RSD', ariaLabel: 'RSD Reporting', icon: <VerifiedUserIcon fontSize="small" />, color: '#00695c' }, // regulator
];

export default function SalesHubPage() {
  const location = useLocation();
  const navigate = useNavigate();
  // Path-driven (not state) so a refresh on a tab keeps the cashier where they were.
  const tabIndex = TABS.findIndex((entry) => entry.path === location.pathname);
  const activeTab = tabIndex === -1 ? 0 : tabIndex;
  // Render by path, not array index, so reordering tabs can't silently swap their content.
  const activePath = TABS[activeTab].path;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Tabs
        value={activeTab}
        onChange={(_, value: number) => navigate(TABS[value].path)}
        sx={{
          flex: 'none',
          px: 2,
          pt: 1,
          borderBottom: 1,
          borderColor: 'divider',
          ...coloredTabsIndicatorSx(TABS[activeTab].color),
        }}
      >
        {TABS.map((entry) => (
          <Tab
            key={entry.path}
            icon={entry.icon}
            iconPosition="start"
            label={entry.label}
            aria-label={entry.ariaLabel}
            sx={coloredTabSx(entry.color)}
          />
        ))}
      </Tabs>
      {/* POSPage sizes itself to 100% height, so the content slot must be a bounded flex child
          (minHeight 0) instead of an auto-height wrapper. The invoice ledger is taller than the
          viewport, so it gets its own scroll container and the same page padding Settings gave it. */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        {activePath === '/' && <POSPage />}
        {activePath === '/returns' && <ReturnsPage />}
        {activePath === '/incentives' && (
          <Box sx={{ height: '100%', overflow: 'auto', p: 3 }}>
            <IncentiveItemsPage />
          </Box>
        )}
        {activePath === '/prescriptions' && (
          <Box sx={{ height: '100%', overflow: 'auto' }}>
            <PrescriptionsPage />
          </Box>
        )}
        {activePath === '/sales-invoices' && (
          <Box sx={{ height: '100%', overflow: 'auto', p: 3 }}>
            <Box sx={{ maxWidth: 1200 }}>
              <ZatcaInvoicesPanel />
            </Box>
          </Box>
        )}
        {activePath === '/controlled-register' && (
          <Box sx={{ height: '100%', overflow: 'auto' }}>
            <ControlledRegisterPage />
          </Box>
        )}
        {activePath === '/rsd-reporting' && (
          <Box sx={{ height: '100%', overflow: 'auto' }}>
            <RsdMonitorPage />
          </Box>
        )}
      </Box>
    </Box>
  );
}
