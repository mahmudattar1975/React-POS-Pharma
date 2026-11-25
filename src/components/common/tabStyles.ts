import { alpha } from '@mui/material/styles';

// One tab colour system for every workspace: the label, icon, hover/selected tint and active
// indicator all use the same semantic colour so a cashier or manager can recognise an area at a
// glance. Keep the colours reversible against the light theme background.
export function coloredTabSx(color: string) {
  return {
    minHeight: 44,
    color,
    '& .MuiTab-iconWrapper': { color },
    '&:hover': { color, backgroundColor: alpha(color, 0.05) },
    '&.Mui-selected': {
      color,
      fontWeight: 700,
      backgroundColor: alpha(color, 0.09),
    },
    '&.Mui-selected:hover': { backgroundColor: alpha(color, 0.12) },
  };
}

export function coloredTabsIndicatorSx(activeColor: string) {
  return {
    '& .MuiTabs-indicator': { backgroundColor: activeColor },
  };
}
