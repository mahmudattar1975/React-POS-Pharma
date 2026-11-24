import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Box, CircularProgress, Alert, Button, Stack } from '@mui/material';
import { useShiftStore } from '../../store/shiftStore';
import OpenDrawerDialog from './OpenDrawerDialog';

// Sits inside AppLayout's <Outlet/> - every page requires the logged-in cashier to have an open
// shift, same rule the backend enforces server-side on every sale/return.
export default function DrawerGate() {
  const { shift, loading, error, refresh, lastClose } = useShiftStore();

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
        <Stack spacing={2} sx={{ alignItems: 'center' }}>
          <Alert severity="error">{error}</Alert>
          <Button variant="outlined" onClick={() => refresh()}>Retry</Button>
        </Stack>
      </Box>
    );
  }

  if (!shift) {
    // Right after Close Drawer, the shift briefly goes null while CloseDrawerDialog (mounted
    // separately, from AppLayout) is still showing the post-close summary on top of this. Don't
    // stack the Open Drawer dialog underneath it - wait for that summary to be acknowledged
    // (lastClose cleared) before prompting to open the next one.
    if (lastClose) return null;
    return <OpenDrawerDialog />;
  }

  return <Outlet />;
}
