import { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, List, ListItem, ListItemText,
  Typography, CircularProgress, Alert, Stack,
} from '@mui/material';
import * as erpApi from '../../api/erpApi';
import type { Item } from '../../types/catalog';

interface Props {
  open: boolean;
  item: Item | null;
  onClose: () => void;
}

// ERP-sourced items are namespaced 'erp-<itemNo>' by catalogStore.upsertErpItem - only those have
// a real XPH item number to look up cross-branch stock for. A local seed item has no such record.
function erpItemNoOf(item: Item | null): number | null {
  if (!item || !item.id.startsWith('erp-')) return null;
  const n = Number(item.id.slice('erp-'.length));
  return Number.isFinite(n) ? n : null;
}

// Not confirmed working against the real ERP backend yet (see server/src/erp/items.ts's
// getOtherBranchStock) - shown as an optional lookup, not a load-bearing one, so a failure here
// reads as "can't check right now" rather than blocking the cashier from anything.
export default function OtherBranchStockDialog({ open, item, onClose }: Props) {
  const [state, setState] = useState<{ loading: boolean; error: string | null; branches: erpApi.BranchStock[] }>({
    loading: false,
    error: null,
    branches: [],
  });

  useEffect(() => {
    if (!open) return;
    const itemNo = erpItemNoOf(item);
    if (!itemNo) {
      setState({ loading: false, error: "This item isn't tracked in the ERP, so other branches can't be checked.", branches: [] });
      return;
    }
    setState({ loading: true, error: null, branches: [] });
    erpApi
      .getOtherBranchStock(itemNo)
      .then((branches) => setState({ loading: false, error: null, branches }))
      .catch((err) => setState({ loading: false, error: err instanceof Error ? err.message : String(err), branches: [] }));
  }, [open, item]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Check Other Branches</DialogTitle>
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
              <Typography variant="body2" color="text.secondary">Checking other branches…</Typography>
            </Stack>
          )}

          {!state.loading && state.error && <Alert severity="warning">{state.error}</Alert>}

          {!state.loading && !state.error && state.branches.length === 0 && (
            <Alert severity="info">No stock found at any other branch.</Alert>
          )}

          {!state.loading && !state.error && state.branches.length > 0 && (
            <List dense disablePadding>
              {state.branches.map((b) => (
                <ListItem key={b.storeNo} disableGutters sx={{ justifyContent: 'space-between' }}>
                  <ListItemText primary={b.storeNameEn} secondary={b.storeNameAr} />
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{b.qtyOnHand}</Typography>
                </ListItem>
              ))}
            </List>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
