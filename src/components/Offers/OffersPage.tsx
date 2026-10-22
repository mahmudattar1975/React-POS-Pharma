import { useState } from 'react';
import {
  Box, Typography, Button, Paper, Table, TableHead, TableRow, TableCell, TableBody, Chip,
  IconButton, Stack,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { useCatalogStore } from '../../store/catalogStore';
import type { Offer } from '../../types/catalog';
import OfferFormDialog from './OfferFormDialog';

function offerDetails(offer: Offer): string {
  if (offer.type === 'percent') return `${Math.round((offer.percent ?? 0) * 100)}% off`;
  if (offer.type === 'value') return `SAR ${(offer.value ?? 0).toFixed(2)} off per unit`;
  return `Buy ${offer.buyQty} Get ${offer.freeQty} Free`;
}

function offerStatus(offer: Offer, today: string): { label: string; color: 'success' | 'info' | 'default' } {
  if (today > offer.activeTo) return { label: 'Expired', color: 'default' };
  if (today < offer.activeFrom) return { label: 'Upcoming', color: 'info' };
  return { label: 'Active', color: 'success' };
}

export default function OffersPage() {
  const { items, offers, addOffer, updateOffer, deleteOffer } = useCatalogStore();
  const [dialog, setDialog] = useState<{ open: boolean; offer: Offer | null }>({ open: false, offer: null });

  const today = new Date().toISOString().slice(0, 10);
  const itemName = (itemId: string) => items.find((i) => i.id === itemId)?.nameEn ?? itemId;

  function save(input: Omit<Offer, 'id'>) {
    if (dialog.offer) updateOffer(dialog.offer.id, input);
    else addOffer(input);
    setDialog({ open: false, offer: null });
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Offers &amp; Promotions</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({ open: true, offer: null })}>
          Add Offer
        </Button>
      </Stack>

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Item</TableCell>
              <TableCell>Offer</TableCell>
              <TableCell>Label</TableCell>
              <TableCell>Active From</TableCell>
              <TableCell>Active To</TableCell>
              <TableCell>Status</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {offers.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                    No offers yet — add one to start promoting an item at checkout.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {offers.map((offer) => {
              const status = offerStatus(offer, today);
              return (
                <TableRow key={offer.id} hover>
                  <TableCell>{itemName(offer.itemId)}</TableCell>
                  <TableCell>{offerDetails(offer)}</TableCell>
                  <TableCell>{offer.label}</TableCell>
                  <TableCell>{offer.activeFrom}</TableCell>
                  <TableCell>{offer.activeTo}</TableCell>
                  <TableCell>
                    <Chip size="small" color={status.color} label={status.label} />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => setDialog({ open: true, offer })}>
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={() => deleteOffer(offer.id)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>

      <OfferFormDialog
        open={dialog.open}
        items={items}
        offer={dialog.offer}
        onSave={save}
        onClose={() => setDialog({ open: false, offer: null })}
      />
    </Box>
  );
}
