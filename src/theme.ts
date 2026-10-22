import { createTheme, alpha } from '@mui/material/styles';

// A designed system, not MUI's bare defaults: a cool neutral background instead of pure white/gray,
// soft shadows instead of flat borders on cards, a tighter type scale for headings, and consistent
// motion on every interactive element (buttons, nav links, table rows, stat cards) so the app feels
// responsive to the cursor rather than static.
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
const BORDER = '#dfe4ec';
const TEXT_SECONDARY = '#5a6472';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1565c0', light: '#3d84d6', dark: '#0d3f7a', contrastText: '#ffffff' },
    secondary: { main: '#c4762a', light: '#d99757', dark: '#94581c' },
    background: { default: '#f2f5fa', paper: '#ffffff' },
    error: { main: '#b3261e' },
    warning: { main: '#b8862c' },
    success: { main: '#2f7a52' },
    divider: BORDER,
    text: { primary: '#1c2430', secondary: TEXT_SECONDARY },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: '"Roboto", "Segoe UI", sans-serif',
    h4: { fontWeight: 700, letterSpacing: -0.5 },
    h5: { fontWeight: 700, letterSpacing: -0.3 },
    h6: { fontWeight: 700 },
    subtitle1: { fontWeight: 600 },
    subtitle2: { fontWeight: 600 },
    button: { fontWeight: 600, textTransform: 'none' },
  },
  transitions: {
    duration: { shortest: 120, shorter: 160, short: 200, standard: 240 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: { body: { backgroundColor: '#f2f5fa' } },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
        outlined: { borderColor: BORDER, boxShadow: '0 1px 2px rgba(20, 18, 10, 0.04)' },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 10,
          paddingInline: 16,
          transition: `transform ${EASE} 150ms, box-shadow ${EASE} 150ms, background-color ${EASE} 150ms`,
          '&:hover': { transform: 'translateY(-1px)' },
          '&:active': { transform: 'translateY(0)' },
        },
        contained: {
          boxShadow: '0 1px 2px rgba(0,0,0,0.10)',
          '&:hover': { boxShadow: '0 4px 10px rgba(0,0,0,0.14)' },
        },
        outlined: {
          '&:hover': { boxShadow: '0 2px 6px rgba(0,0,0,0.08)' },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          transition: `transform ${EASE} 150ms, background-color ${EASE} 150ms`,
          '&:hover': { transform: 'scale(1.08)' },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          backgroundColor: '#fff',
          transition: `box-shadow ${EASE} 150ms`,
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontWeight: 700,
          fontSize: 12,
          textTransform: 'uppercase',
          letterSpacing: '0.4px',
          color: TEXT_SECONDARY,
          backgroundColor: '#f2f5fa',
        },
        root: { borderBottom: `1px solid ${BORDER}` },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          transition: `background-color ${EASE} 120ms`,
          '&:last-child td': { borderBottom: 0 },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600, borderRadius: 8 },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: ({ theme }) => ({
          transition: `background-color ${EASE} 150ms, color ${EASE} 150ms, padding-left ${EASE} 150ms`,
          '&:hover': { paddingLeft: 14, backgroundColor: alpha(theme.palette.primary.main, 0.06) },
          '&.Mui-selected': {
            backgroundColor: alpha(theme.palette.primary.main, 0.1),
            color: theme.palette.primary.main,
            fontWeight: 600,
            '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.14) },
          },
        }),
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 16 },
      },
    },
    MuiLink: {
      styleOverrides: {
        root: {
          transition: `color ${EASE} 150ms`,
        },
      },
    },
  },
});
