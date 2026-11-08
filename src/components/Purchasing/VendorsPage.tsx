// Vendor master ("بيانات الموردين"), ported from the legacy FCODCSVN vendor file / the
// CustVendor screen in OpenMind-FrontEnd-React. The list keeps the source's useful columns
// (number, Arabic/English names, category, VAT/GLN, status) but derives the financial columns:
// purchase count/total come from posted invoices and item usage from Item.vendorNo, so the vendor
// row can never drift from the documents.
//
// Deleting a vendor that still has purchase history or item-master links is refused - old invoices
// and catalogue rows must keep resolving. Mark it inactive instead.
import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  IconButton, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import SearchIcon from '@mui/icons-material/Search';
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined';
import { useCatalogStore } from '../../store/catalogStore';
import { usePurchasingStore } from '../../store/purchasingStore';
import type { Vendor } from '../../types/purchasing';
import { formatVendorNo, maxVendorNumber, nextVendorNumber } from '../../utils/purchasing';
import VendorFormDialog from './VendorFormDialog';

type StatusFilter = 'all' | 'active' | 'inactive';

export default function VendorsPage() {
  const vendors = usePurchasingStore((s) => s.vendors);
  const invoices = usePurchasingStore((s) => s.invoices);
  const addVendor = usePurchasingStore((s) => s.addVendor);
  const updateVendor = usePurchasingStore((s) => s.updateVendor);
  const removeVendor = usePurchasingStore((s) => s.removeVendor);
  const items = useCatalogStore((s) => s.items);

  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dialog, setDialog] = useState<{ open: boolean; vendor: Vendor | null }>({ open: false, vendor: null });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Vendor | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Item-master usage per vendor number (Item.vendorNo stores the system number).
  const itemCountByVendor = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const key = (item.vendorNo ?? '').trim();
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  // Posted-invoice count/value per vendor. vendorId is the stable key; vendorNo is the fallback for
  // invoices saved before the id snapshot existed.
  const purchaseStats = useMemo(() => {
    const stats = new Map<string, { count: number; total: number }>();
    for (const invoice of invoices) {
      const vendor = vendors.find((v) => v.id === invoice.vendorId)
        ?? vendors.find((v) => v.vendorNo === invoice.vendorNo);
      const key = vendor?.id ?? invoice.vendorId;
      const current = stats.get(key) ?? { count: 0, total: 0 };
      stats.set(key, { count: current.count + 1, total: current.total + invoice.totalInclVat });
    }
    return stats;
  }, [invoices, vendors]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return vendors
      .filter((vendor) => {
        if (statusFilter === 'active' && vendor.isActive === false) return false;
        if (statusFilter === 'inactive' && vendor.isActive !== false) return false;
        if (!q) return true;
        return [
          vendor.vendorNo,
          vendor.nameAr,
          vendor.nameEn,
          vendor.phone,
          vendor.vatNumber ?? '',
          vendor.category ?? '',
          vendor.glnNo ?? '',
          vendor.notes ?? '',
          String(vendor.vatType ?? ''),
        ].some((value) => value.toLowerCase().includes(q));
      })
      .map((vendor) => ({
        vendor,
        items: itemCountByVendor.get(vendor.vendorNo) ?? 0,
        purchases: purchaseStats.get(vendor.id) ?? { count: 0, total: 0 },
      }))
      .sort((a, b) => a.vendor.vendorNo.localeCompare(b.vendor.vendorNo));
  }, [vendors, filter, statusFilter, itemCountByVendor, purchaseStats]);

  const activeCount = vendors.filter((v) => v.isActive !== false).length;
  // Same header as the company/item masters: the last vendor number in use and the next one a
  // saved vendor will get, so the owner can see the sequence without opening the form.
  const lastNumber = maxVendorNumber(vendors);
  const totalPurchases = invoices.reduce((sum, invoice) => sum + invoice.totalInclVat, 0);

  function openCreate() {
    setSaveError(null);
    setDialog({ open: true, vendor: null });
  }

  function openEdit(vendor: Vendor) {
    setSaveError(null);
    setDialog({ open: true, vendor });
  }

  function save(input: Omit<Vendor, 'id' | 'vendorNo'>) {
    try {
      if (dialog.vendor) updateVendor(dialog.vendor.id, input);
      else addVendor(input);
      setDialog({ open: false, vendor: null });
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const linkedItems = itemCountByVendor.get(deleteTarget.vendorNo) ?? 0;
    const purchaseCount = purchaseStats.get(deleteTarget.id)?.count ?? 0;
    if (linkedItems > 0 || purchaseCount > 0) {
      const parts: string[] = [];
      if (purchaseCount > 0) parts.push(`${purchaseCount} purchase invoice(s)`);
      if (linkedItems > 0) parts.push(`${linkedItems} item(s)`);
      setDeleteError(
        `This vendor is still referenced by ${parts.join(' and ')}. ` +
        'Mark it inactive instead so the history and item links keep resolving.'
      );
      return;
    }
    removeVendor(deleteTarget.id);
    setDeleteTarget(null);
    setDeleteError(null);
  }

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, gap: 2 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip
            size="small"
            variant="outlined"
            icon={<StorefrontOutlinedIcon />}
            label={`${vendors.length} vendors`}
          />
          <Chip size="small" variant="outlined" color="success" label={`${activeCount} active`} />
          <Chip size="small" variant="outlined" label={`Last number ${lastNumber ? formatVendorNo(lastNumber) : '—'}`} />
          <Chip size="small" variant="outlined" color="primary" label={`Next number ${nextVendorNumber(vendors)}`} />
          <Chip size="small" variant="outlined" label={`Purchases ${totalPurchases.toFixed(2)} SAR`} />
        </Stack>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} sx={{ flexShrink: 0 }}>
          Add Vendor
        </Button>
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
        بيانات الموردين — vendor number, Arabic/English names, tax IDs, credit terms and status
      </Typography>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField
          fullWidth
          size="small"
          label="Search vendor no / name / phone / VAT / GLN / category / notes"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          slotProps={{
            input: {
              startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />,
            },
          }}
        />
        <Select
          size="small"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          sx={{ minWidth: 170 }}
        >
          <MenuItem value="all">All vendors</MenuItem>
          <MenuItem value="active">Active only</MenuItem>
          <MenuItem value="inactive">Inactive only</MenuItem>
        </Select>
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 130, whiteSpace: 'nowrap' }}>Vendor No</TableCell>
              <TableCell>Vendor</TableCell>
              <TableCell>Category</TableCell>
              <TableCell>Phone</TableCell>
              <TableCell>Tax IDs</TableCell>
              <TableCell align="center">Items</TableCell>
              <TableCell align="right">Purchases</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Updated</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={10}>
                  <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                    No vendors match this search. Add a vendor to start building the supplier file.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {rows.map(({ vendor, items: linkedItems, purchases }) => (
              <TableRow
                key={vendor.id}
                hover
                sx={{ cursor: 'pointer' }}
                onClick={() => openEdit(vendor)}
              >
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {vendor.vendorNo}
                  </Typography>
                </TableCell>
                <TableCell sx={{ minWidth: 230 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{vendor.nameEn}</Typography>
                  <Typography variant="caption" color="text.secondary" dir="rtl" sx={{ display: 'block', textAlign: 'left' }}>
                    {vendor.nameAr}
                  </Typography>
                </TableCell>
                <TableCell>{vendor.category || '—'}</TableCell>
                <TableCell>
                  <Typography variant="body2">{vendor.phone || '—'}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="caption" sx={{ display: 'block', fontFamily: 'monospace' }}>
                    VAT {vendor.vatNumber || '—'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontFamily: 'monospace' }}>
                    GLN {vendor.glnNo || '—'}
                  </Typography>
                </TableCell>
                <TableCell align="center">
                  {linkedItems > 0 ? (
                    <Chip size="small" variant="outlined" label={linkedItems} />
                  ) : (
                    <Typography variant="caption" color="text.secondary">—</Typography>
                  )}
                </TableCell>
                <TableCell align="right">
                  {purchases.count > 0 ? (
                    <>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{purchases.total.toFixed(2)}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {purchases.count} invoice{purchases.count === 1 ? '' : 's'}
                      </Typography>
                    </>
                  ) : (
                    <Typography variant="caption" color="text.secondary">—</Typography>
                  )}
                </TableCell>
                <TableCell>
                  {vendor.isActive === false ? (
                    <Chip size="small" color="default" label="Inactive" />
                  ) : (
                    <Chip size="small" color="success" variant="outlined" label="Active" />
                  )}
                </TableCell>
                <TableCell>
                  <Typography variant="caption" color="text.secondary">
                    {vendor.updatedAt ? new Date(vendor.updatedAt).toLocaleDateString() : '—'}
                  </Typography>
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <IconButton
                    size="small"
                    title="Edit vendor"
                    onClick={(e) => { e.stopPropagation(); openEdit(vendor); }}
                  >
                    <EditOutlinedIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    title="Delete vendor"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteError(null);
                      setDeleteTarget(vendor);
                    }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {dialog.open && (
        <VendorFormDialog
          // Remount per row so the form initialises from that vendor (no setState-in-effect reset).
          key={dialog.vendor?.id ?? 'new-vendor'}
          open
          vendor={dialog.vendor}
          vendors={vendors}
          onSave={save}
          onClose={() => setDialog({ open: false, vendor: null })}
          error={saveError}
        />
      )}

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete vendor?</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            {deleteError && <Alert severity="error" onClose={() => setDeleteError(null)}>{deleteError}</Alert>}
            <DialogContentText>
              This permanently removes <strong>{deleteTarget?.nameEn}</strong>{' '}
              ({deleteTarget?.vendorNo}) from the vendor master.
            </DialogContentText>
            <DialogContentText>
              A vendor with purchase invoices or item-master links cannot be deleted - mark it
              inactive instead so those records keep their vendor reference.
            </DialogContentText>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={confirmDelete}>Delete Vendor</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
