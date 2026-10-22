import { Dialog, DialogTitle, DialogContent, List, ListItemButton, ListItemText, Chip, Stack, Typography } from '@mui/material';
import type { Item, Batch } from '../../types/catalog';
import { isNearExpiry } from '../../utils/fefo';

interface Props {
  open: boolean;
  item: Item | null;
  batches: Batch[];
  onPick: (batch: Batch) => void;
  onClose: () => void;
}

export default function BatchPickerDialog({ open, item, batches, onPick, onClose }: Props) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        Multiple batches available
        {item && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {item.nameEn}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <List disablePadding>
          {batches.map((b, idx) => (
            <ListItemButton key={b.id} onClick={() => onPick(b)} divider>
              <ListItemText
                primary={`Batch ${b.batchNo}`}
                secondary={`Expires ${b.expiryDate} · ${b.qtyOnHand} in stock`}
              />
              <Stack direction="row" spacing={1}>
                {idx === 0 && <Chip size="small" color="primary" label="FEFO suggested" />}
                {isNearExpiry(b.expiryDate) && <Chip size="small" color="warning" label="Near expiry" />}
              </Stack>
            </ListItemButton>
          ))}
        </List>
      </DialogContent>
    </Dialog>
  );
}
