import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Box, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Typography, Divider, Avatar, Chip, Button, IconButton, Tooltip } from '@mui/material';
import LocalPharmacyIcon from '@mui/icons-material/LocalPharmacy';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import InsightsIcon from '@mui/icons-material/Insights';
import SettingsIcon from '@mui/icons-material/Settings';
import LogoutIcon from '@mui/icons-material/Logout';
import LanguageIcon from '@mui/icons-material/Language';
import { T, useT, useI18n } from '../../i18n';
import { useSettingsStore } from '../../store/settingsStore';
import { useAuthStore } from '../../store/authStore';
import { useShiftStore } from '../../store/shiftStore';
import CloseDrawerDialog from '../Auth/CloseDrawerDialog';
import { formatMoney } from '../../utils/format';

// Each module gets its own icon color so the sidebar reads as a colorful, scannable icon set
// rather than uniform gray glyphs - blue (the selected/brand color) is reserved for the active
// row's background and text, not tied to any one icon.
const NAV = [
  { to: '/', label: 'Point of Sale', icon: <PointOfSaleIcon fontSize="small" />, color: '#1565c0' },
  { to: '/inventory', label: 'Inventory & Expiry', icon: <Inventory2Icon fontSize="small" />, color: '#2e7d32' },
  { to: '/purchases', label: 'Purchasing & Receiving', icon: <ReceiptLongIcon fontSize="small" />, color: '#5d4037' },
  { to: '/offers', label: 'Offers & Promotions', icon: <LocalOfferIcon fontSize="small" />, color: '#e65100' },
  { to: '/cost-centers', label: 'Cost Centers & Expenses', icon: <AccountTreeIcon fontSize="small" />, color: '#4527a0' },
  { to: '/dashboard', label: 'Dashboard & Reports', icon: <InsightsIcon fontSize="small" />, color: '#00695c' },
  { to: '/settings', label: 'Settings', icon: <SettingsIcon fontSize="small" />, color: '#546e7a' },
];

// Some screens share one tabbed workspace, so a single sidebar row must stay highlighted on
// every tab URL (the row points at the first tab).
const HUB_PATHS: Record<string, string[]> = {
  '/': ['/', '/returns', '/sales-invoices', '/prescriptions', '/controlled-register', '/rsd-reporting', '/incentives'],
  '/inventory': ['/inventory', '/items', '/manufacturers', '/dosages', '/wasfaty-mapping'],
  '/purchases': ['/purchases', '/purchase-returns', '/vendors', '/receiving', '/head-office-receiving'],
  '/cost-centers': ['/cost-centers', '/category-map', '/expenses'],
  '/dashboard': ['/dashboard', '/reports', '/incentive-report'],
  // The guided ZATCA setup screen is still configuration, so the Settings row stays highlighted.
  '/settings': ['/settings', '/zatca-setup'],
};

export default function AppLayout() {
  const tr = useT();
  const settings = useSettingsStore((s) => s.settings);
  const location = useLocation();
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const logout = useAuthStore((s) => s.logout);
  const shift = useShiftStore((s) => s.shift);
  const { locale, direction, toggleLocale, t } = useI18n();
  const [closeDrawerOpen, setCloseDrawerOpen] = useState(false);

  return (
    <>
      <Box
        component="a"
        href="#main-content"
        sx={{
          position: 'absolute',
          insetInlineStart: -9999,
          top: 0,
          zIndex: 9999,
          bgcolor: 'background.paper',
          p: 1,
          '&:focus': { insetInlineStart: 8, outline: '2px solid', outlineColor: 'primary.main' },
        }}
      >
        <T>Skip to main content</T>
      </Box>
      <Box sx={{ display: 'flex', height: '100vh' }}>
      <Box
        component="nav"
        aria-label={tr("Main navigation")}
        sx={{
          width: 236,
          flex: 'none',
          borderInlineEnd: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: direction === 'rtl' ? '-2px 0 8px rgba(20, 18, 10, 0.03)' : '2px 0 8px rgba(20, 18, 10, 0.03)',
        }}
      >
        <Box sx={{ px: 2.5, py: 2.5, display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Avatar sx={{ bgcolor: 'primary.main', width: 36, height: 36 }}>
            <LocalPharmacyIcon fontSize="small" />
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography component="h1" variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {settings.storeNameEn}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              <T>Pharmacy POS</T>
              {settings.branchCode ? ` · ${settings.branchCode}` : ''}
            </Typography>
          </Box>
          <Tooltip title={tr("العربية / English")}>
            <IconButton
              size="small"
              onClick={toggleLocale}
              aria-label={t('Switch language')}
              sx={{ marginInlineStart: 'auto', flex: 'none', color: 'text.secondary' }}
            >
              <LanguageIcon fontSize="small" />
              <Typography component="span" variant="caption" sx={{ marginInlineStart: 0.5, fontWeight: 700 }}>
                {locale === 'en' ? 'AR' : 'EN'}
              </Typography>
            </IconButton>
          </Tooltip>
        </Box>
        <Divider />
        <List sx={{ px: 1, py: 1 }}>
          {NAV.map((n) => (
            <ListItem key={n.to} disablePadding sx={{ mb: 0.5 }}>
              <ListItemButton
                component={NavLink}
                to={n.to}
                selected={
                  HUB_PATHS[n.to]?.includes(location.pathname) ?? location.pathname === n.to
                }
                sx={{ borderRadius: 2 }}
              >
                <ListItemIcon sx={{ minWidth: 34, color: n.color }}>{n.icon}</ListItemIcon>
                <ListItemText slotProps={{ primary: { sx: { fontSize: 14 } } }} primary={t(n.label)} />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
        <Box sx={{ mt: 'auto', px: 2.5, py: 2, color: 'text.secondary' }}>
          <Typography variant="caption" sx={{ display: 'block', fontWeight: 600 }}>
            {session?.fullName ?? settings.cashierName}
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1 }}><T>VAT</T> {settings.vatRegistrationNo}</Typography>
          {shift && (
            <Chip
              label={`${t('Drawer open • float')} ${formatMoney(shift.openingFloat)} ${t('SAR')}`}
              size="small"
              color="success"
              variant="outlined"
              sx={{ mb: 1, width: '100%' }}
            />
          )}
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {shift && (
              <Button size="small" variant="outlined" fullWidth onClick={() => setCloseDrawerOpen(true)}>
                <T>Close Drawer</T>
              </Button>
            )}
            <Button
              size="small"
              color="inherit"
              onClick={() => {
                logout();
                navigate('/login', { replace: true });
              }}
              title={t('Sign out')}
              aria-label={t('Sign out')}
            >
              <LogoutIcon fontSize="small" />
            </Button>
          </Box>
        </Box>
      </Box>
      <Box component="main" id="main-content" sx={{ flex: 1, minWidth: 0, overflow: 'auto', bgcolor: 'background.default' }}>
        <Outlet />
      </Box>
      </Box>
      {closeDrawerOpen && <CloseDrawerDialog onClose={() => setCloseDrawerOpen(false)} />}
    </>
  );
}
