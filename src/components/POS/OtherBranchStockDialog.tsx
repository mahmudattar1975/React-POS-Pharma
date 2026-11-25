import { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, List, ListItem, ListItemText,
  Typography, CircularProgress, Alert, Stack, Chip,
} from '@mui/material';
import { getOtherBranchStock } from '../../api/branchApi';
import type { BranchStock } from '../../types/branch';
import type { Item } from '../../types/catalog';
import { formatQty } from '../../utils/format';

import { T } from '../../i18n';
interface Props {
  open: boolean;
  item: Item | null;
  onClose: () => void;
}

// Reads OUR shared PharmaDB, not the read-only ERP, so it works for every catalogue item - local
// seed items included. A server failure is advisory: the cashier simply cannot check right now.
export default function OtherBranchStockDialog({ open, item, onClose }: Props) {
  const [state, setState] = useState<{ loading: boolean; error: string | null; branches: BranchStock[] }>({
    loading: false,
    error: null,
    branches: [],
  });

  useEffect(() => {
    if (!open || !item) return;
    setState({ loading: true, error: null, branches: [] });
    let active = true;
    getOtherBranchStock(item.id)
      .then((branches) => {
        if (active) setState({ loading: false, error: null, branches });
      })
      .catch((err: unknown) => {
        if (active) setState({ loading: false, error: err instanceof Error ? err.message : String(err), branches: [] });
      });
    return () => {
      active = false;
    };
  }, [open, item]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle><T>Check Other Branches</T></DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {item && (
            <Typography variant="body2" color="text.secondary">
              {item.nameEn} · {item.nameAr}
            </Typography>
          )}

          {state.loading && (
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 2 }}>
              <CircularProgress size={20} />
              <Typography variant="body2" color="text.secondary"><T>Checking other branches…</T></Typography>
            </Stack>
          )}

          {!state.loading && state.error && (
            <Alert severity="warning"><T>Can't check other branches right now:</T> {state.error}</Alert>
          )}

          {!state.loading && !state.error && state.branches.length === 0 && (
            <Alert severity="info"><T>No stock found at any other branch.</T></Alert>
          )}

          {!state.loading && !state.error && state.branches.length > 0 && (
            <List dense disablePadding>
              {state.branches.map((b) => (
                <ListItem key={b.branchId} disableGutters sx={{ justifyContent: 'space-between', gap: 1 }}>
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Chip label={b.code} size="small" />
                        <Typography variant="body2">{b.nameEn}</Typography>
                      </Stack>
                    }
                    secondary={b.nameAr}
                  />
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatQty(b.qtyOnHand)}</Typography>
                </ListItem>
              ))}
            </List>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose}><T>Close</T></Button>
      </DialogActions>
    </Dialog>
  );
}
