// One Inventory workspace with five tabs. The legacy app had separate windows for stock data, the
// batch/expiry inquiry and the company (manufacturer) file; in this app they all describe "what we
// have and who makes it", so they share one nav entry. Every URL is kept: /inventory opens the
// batches tab, /items the item master tab, /manufacturers the company master, /dosages the
// reusable dosage-instruction library and /wasfaty-mapping the NUPCO approved-list mapping, so
// existing bookmarks/deep links always land on the right screen.
import { useLocation, useNavigate } from 'react-router-dom';
import { Box, Tab, Tabs, Typography } from '@mui/material';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import ListAltIcon from '@mui/icons-material/ListAlt';
import FactoryIcon from '@mui/icons-material/Factory';
import MedicationOutlinedIcon from '@mui/icons-material/MedicationOutlined';
import LocalPharmacyOutlinedIcon from '@mui/icons-material/LocalPharmacyOutlined';
import InventoryPage from './InventoryPage';
import ItemMasterPage from './ItemMasterPage';
import ManufacturersPage from './ManufacturersPage';
import DosagesPage from './DosagesPage';
import WasfatyMappingPage from './WasfatyMappingPage';

const TABS = [
  { path: '/inventory', label: 'Batches & Expiry', icon: <Inventory2Icon fontSize="small" /> },
  { path: '/items', label: 'Item Master', icon: <ListAltIcon fontSize="small" /> },
  { path: '/manufacturers', label: 'Companies (Manufacturers)', icon: <FactoryIcon fontSize="small" /> },
  { path: '/dosages', label: 'Dosage Instructions', icon: <MedicationOutlinedIcon fontSize="small" /> },
  { path: '/wasfaty-mapping', label: 'Wasfaty / NUPCO Mapping', icon: <LocalPharmacyOutlinedIcon fontSize="small" /> },
];

export default function InventoryHubPage() {
  const location = useLocation();
  const navigate = useNavigate();
  // Resolved from the path (not remembered in state) so a refresh or a pasted link always opens the
  // tab that URL names.
  const tab = Math.max(0, TABS.findIndex((entry) => entry.path === location.pathname));

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>Inventory &amp; Expiry</Typography>
      <Typography variant="caption" color="text.secondary">
        Batch expiry, stock levels, the item master file, the manufacturer file and the dosage library
      </Typography>
      <Tabs
        value={tab}
        onChange={(_, value: number) => navigate(TABS[value].path)}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ mt: 1.5, mb: 2.5, borderBottom: 1, borderColor: 'divider' }}
      >
        {TABS.map((entry) => (
          <Tab key={entry.path} icon={entry.icon} iconPosition="start" label={entry.label} sx={{ minHeight: 44 }} />
        ))}
      </Tabs>
      {tab === 0 && <InventoryPage />}
      {tab === 1 && <ItemMasterPage />}
      {tab === 2 && <ManufacturersPage />}
      {tab === 3 && <DosagesPage />}
      {tab === 4 && <WasfatyMappingPage />}
    </Box>
  );
}
