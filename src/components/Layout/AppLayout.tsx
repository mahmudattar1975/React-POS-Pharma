import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Box, List, ListItemButton, ListItemIcon, ListItemText, Typography, Divider, Avatar, Chip, Button } from '@mui/material';
import LocalPharmacyIcon from '@mui/icons-material/LocalPharmacy';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import MoveToInboxIcon from '@mui/icons-material/MoveToInbox';
import AssignmentReturnIcon from '@mui/icons-material/AssignmentReturn';
import BarChartIcon from '@mui/icons-material/BarChart';
import SettingsIcon from '@mui/icons-material/Settings';
import LogoutIcon from '@mui/icons-material/Logout';
import { useSettingsStore } from '../../store/settingsStore';
import { useAuthStore } from '../../store/authStore';
import { useShiftStore } from '../../store/shiftStore';
import CloseDrawerDialog from '../Auth/CloseDrawerDialog';

// Each module gets its own icon color so the sidebar reads as a colorful, scannable icon set
// rather than uniform gray glyphs - blue (the selected/brand color) is reserved for the active
// row's background and text, not tied to any one icon.
const NAV = [
  { to: '/', label: 'Point of Sale', icon: <PointOfSaleIcon fontSize="small" />, color: '#1565c0' },
  { to: '/inventory', label: 'Inventory & Expiry', icon: <Inventory2Icon fontSize="small" />, color: '#2e7d32' },
  { to: '/offers', label: 'Offers & Promotions', icon: <LocalOfferIcon fontSize="small" />, color: '#e65100' },
  { to: '/receiving', label: 'Stock Receiving', icon: <LocalShippingIcon fontSize="small" />, color: '#6a1b9a' },
  { to: '/head-office-receiving', label: 'Receive from Head Office', icon: <MoveToInboxIcon fontSize="small" />, color: '#00695c' },
  { to: '/returns', label: 'Returns', icon: <AssignmentReturnIcon fontSize="small" />, color: '#c62828' },
  { to: '/reports', label: 'Reports', icon: <BarChartIcon fontSize="small" />, color: '#00838f' },
  { to: '/settings', label: 'Settings', icon: <SettingsIcon fontSize="small" />, color: '#546e7a' },
];

export default function AppLayout() {
  const settings = useSettingsStore((s) => s.settings);
  const location = useLocation();
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const logout = useAuthStore((s) => s.logout);
  const shift = useShiftStore((s) => s.shift);
  const [closeDrawerOpen, setCloseDrawerOpen] = useState(false);

  return (
    <Box sx={{ display: 'flex', height: '100vh' }}>
      <Box
        sx={{
          width: 236,
          flex: 'none',
          borderRight: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '2px 0 8px rgba(20, 18, 10, 0.03)',
        }}
      >
        <Box sx={{ px: 2.5, py: 2.5, display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Avatar sx={{ bgcolor: 'primary.main', width: 36, height: 36 }}>
            <LocalPharmacyIcon fontSize="small" />
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {settings.storeNameEn}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Pharmacy POS
            </Typography>
          </Box>
        </Box>
        <Divider />
        <List sx={{ px: 1, py: 1 }}>
          {NAV.map((n) => (
            <ListItemButton
              key={n.to}
              component={NavLink}
              to={n.to}
              selected={location.pathname === n.to}
              sx={{ borderRadius: 2, mb: 0.5 }}
            >
              <ListItemIcon sx={{ minWidth: 34, color: n.color }}>{n.icon}</ListItemIcon>
              <ListItemText slotProps={{ primary: { sx: { fontSize: 14 } } }} primary={n.label} />
            </ListItemButton>
          ))}
        </List>
        <Box sx={{ mt: 'auto', px: 2.5, py: 2, color: 'text.secondary' }}>
          <Typography variant="caption" sx={{ display: 'block', fontWeight: 600 }}>
            {session?.fullName ?? settings.cashierName}
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>VAT {settings.vatRegistrationNo}</Typography>
          {shift && (
            <Chip
              label={`Drawer open • float ${shift.openingFloat.toFixed(2)} SAR`}
              size="small"
              color="success"
              variant="outlined"
              sx={{ mb: 1, width: '100%' }}
            />
          )}
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {shift && (
              <Button size="small" variant="outlined" fullWidth onClick={() => setCloseDrawerOpen(true)}>
                Close Drawer
              </Button>
            )}
            <Button
              size="small"
              color="inherit"
              onClick={() => {
                logout();
                navigate('/login', { replace: true });
              }}
              title="Sign out"
            >
              <LogoutIcon fontSize="small" />
            </Button>
          </Box>
        </Box>
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto', bgcolor: 'background.default' }}>
        <Outlet />
      </Box>
      {closeDrawerOpen && <CloseDrawerDialog onClose={() => setCloseDrawerOpen(false)} />}
    </Box>
  );
}
