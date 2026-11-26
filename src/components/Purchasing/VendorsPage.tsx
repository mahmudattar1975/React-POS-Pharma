// Party master ("بيانات الموردين والعملاء"), ported from the legacy FCODCSVN vendor file / the
// CustVendor screen in OpenMind-FrontEnd-React. Vendors (type_flag 1) and business customers
// (type_flag 2) are rows of the same table. The list keeps the source's useful columns
// (number, type, Arabic/English names, category, VAT/GLN, status) but derives the financial
// columns: purchase count/total come from posted invoices and item usage from Item.vendorNo, so
// the row can never drift from the documents.
//
// Deleting a party that still has purchase history or item-master links is refused - old invoices
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
import { useBranchPurchases } from '../../store/branchSelectors';
import type { Vendor } from '../../types/purchasing';
import { PARTY_TYPE_FLAG, type PartyTypeFlag } from '../../types/party';
import {
  formatCustomerNo, formatVendorNo, maxCustomerNumber, maxVendorNumber, nextCustomerNumber,
  nextVendorNumber,
} from '../../utils/purchasing';
import { formatMoney } from '../../utils/format';
import VendorFormDialog from './VendorFormDialog';

import { T, useT } from '../../i18n';
type StatusFilter = 'all' | 'active' | 'inactive';
type PartyFilter = 'all' | 'vendor' | 'customer';

export default function VendorsPage() {
  const tr = useT();
  const vendors = usePurchasingStore((s) => s.vendors);
  const invoices = useBranchPurchases();
  const addVendor = usePurchasingStore((s) => s.addVendor);
  const addCustomer = usePurchasingStore((s) => s.addCustomer);
  const updateVendor = usePurchasingStore((s) => s.updateVendor);
  const removeVendor = usePurchasingStore((s) => s.removeVendor);
  const items = useCatalogStore((s) => s.items);

  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [partyFilter, setPartyFilter] = useState<PartyFilter>('all');
  const [dialog, setDialog] = useState<{ open: boolean; vendor: Vendor | null; typeFlag: PartyTypeFlag }>({
    open: false, vendor: null, typeFlag: PARTY_TYPE_FLAG.vendor,
  });
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
        if (partyFilter === 'vendor' && vendor.typeFlag !== PARTY_TYPE_FLAG.vendor) return false;
        if (partyFilter === 'customer' && vendor.typeFlag !== PARTY_TYPE_FLAG.customer) return false;
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
  }, [vendors, filter, statusFilter, partyFilter, itemCountByVendor, purchaseStats]);

  const vendorCount = vendors.filter((v) => v.typeFlag === PARTY_TYPE_FLAG.vendor).length;
  const customerCount = vendors.filter((v) => v.typeFlag === PARTY_TYPE_FLAG.customer).length;
  const activeCount = vendors.filter((v) => v.isActive !== false).length;
  // Same header as the company/item masters: the last number in use and the next one a saved row
  // will get on each side, so the owner can see both sequences without opening the form.
  const lastVendorNumber = maxVendorNumber(vendors);
  const lastCustomerNumber = maxCustomerNumber(vendors);
  const totalPurchases = invoices.reduce((sum, invoice) => sum + invoice.totalInclVat, 0);

  function openCreate(typeFlag: PartyTypeFlag) {
    setSaveError(null);
    setDialog({ open: true, vendor: null, typeFlag });
  }

  function openEdit(vendor: Vendor) {
    setSaveError(null);
    setDialog({ open: true, vendor, typeFlag: vendor.typeFlag });
  }

  function save(input: Omit<Vendor, 'id' | 'vendorNo' | 'typeFlag'>) {
    try {
      if (dialog.vendor) updateVendor(dialog.vendor.id, input);
      else if (dialog.typeFlag === PARTY_TYPE_FLAG.customer) addCustomer(input);
      else addVendor(input);
      setDialog({ open: false, vendor: null, typeFlag: PARTY_TYPE_FLAG.vendor });
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const noun = deleteTarget.typeFlag === PARTY_TYPE_FLAG.customer ? 'customer' : 'vendor';
    const linkedItems = itemCountByVendor.get(deleteTarget.vendorNo) ?? 0;
    const purchaseCount = purchaseStats.get(deleteTarget.id)?.count ?? 0;
    if (linkedItems > 0 || purchaseCount > 0) {
      const parts: string[] = [];
      if (purchaseCount > 0) parts.push(`${purchaseCount} purchase invoice(s)`);
      if (linkedItems > 0) parts.push(`${linkedItems} item(s)`);
      setDeleteError(
        `This ${noun} is still referenced by ${parts.join(' and ')}. ` +
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
            label={`${vendorCount} vendors · ${customerCount} customers`}
          />
          <Chip size="small" variant="outlined" color="success" label={`${activeCount} active`} />
          <Chip size="small" variant="outlined" label={`Last vendor ${lastVendorNumber ? formatVendorNo(lastVendorNumber) : '—'}`} />
          <Chip size="small" variant="outlined" color="primary" label={`Next vendor ${nextVendorNumber(vendors)}`} />
          <Chip size="small" variant="outlined" label={`Last customer ${lastCustomerNumber ? formatCustomerNo(lastCustomerNumber) : '—'}`} />
          <Chip size="small" variant="outlined" color="secondary" label={`Next customer ${nextCustomerNumber(vendors)}`} />
          <Chip size="small" variant="outlined" label={`Purchases ${formatMoney(totalPurchases)} SAR`} />
        </Stack>
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={() => openCreate(PARTY_TYPE_FLAG.customer)}>
            <T>Add Customer</T>
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => openCreate(PARTY_TYPE_FLAG.vendor)}>
            <T>Add Vendor</T>
          </Button>
        </Stack>
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
        <T>بيانات الموردين والعملاء — one FCODCSVN-style party file: vendor number, Arabic/English names,
        tax IDs, credit terms and status, with type_flag separating vendors from business customers</T>
      </Typography>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField
          fullWidth
          size="small"
          label={tr('Search number / name / phone / VAT / GLN / category / notes')}
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
          inputProps={{ 'aria-label': 'Filter parties' }}
          value={partyFilter}
          onChange={(e) => setPartyFilter(e.target.value as PartyFilter)}
          sx={{ minWidth: 170 }}
        >
          <MenuItem value="all"><T>All parties</T></MenuItem>
          <MenuItem value="vendor"><T>Vendors only</T></MenuItem>
          <MenuItem value="customer"><T>Customers only</T></MenuItem>
        </Select>
        <Select
          size="small"
          inputProps={{ 'aria-label': 'Filter parties by status' }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          sx={{ minWidth: 170 }}
        >
          <MenuItem value="all"><T>All statuses</T></MenuItem>
          <MenuItem value="active"><T>Active only</T></MenuItem>
          <MenuItem value="inactive"><T>Inactive only</T></MenuItem>
        </Select>
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 130, whiteSpace: 'nowrap' }}><T>Number</T></TableCell>
              <TableCell><T>Type</T></TableCell>
              <TableCell><T>Name</T></TableCell>
              <TableCell><T>Category</T></TableCell>
              <TableCell><T>Phone</T></TableCell>
              <TableCell><T>Tax IDs</T></TableCell>
              <TableCell align="center"><T>Items</T></TableCell>
              <TableCell align="right"><T>Purchases</T></TableCell>
              <TableCell><T>Status</T></TableCell>
              <TableCell><T>Updated</T></TableCell>
              <TableCell align="right"><T>Actions</T></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={11}>
                  <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                    <T>No parties match this search. Add a vendor or a business customer to start
                    building the party file.</T>
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
                <TableCell>
                  {vendor.typeFlag === PARTY_TYPE_FLAG.customer ? (
                    <Chip size="small" color="secondary" variant="outlined" label={tr('Customer')} />
                  ) : (
                    <Chip size="small" color="primary" variant="outlined" label={tr('Vendor')} />
                  )}
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
                    <T>VAT</T> {vendor.vatNumber || '—'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontFamily: 'monospace' }}>
                    <T>GLN</T> {vendor.glnNo || '—'}
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
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatMoney(purchases.total)}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {purchases.count} <T>invoice</T>{purchases.count === 1 ? '' : 's'}
                      </Typography>
                    </>
                  ) : (
                    <Typography variant="caption" color="text.secondary">—</Typography>
                  )}
                </TableCell>
                <TableCell>
                  {vendor.isActive === false ? (
                    <Chip size="small" color="default" label={tr('Inactive')} />
                  ) : (
                    <Chip size="small" color="success" variant="outlined" label={tr('Active')} />
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
                    title={tr('Edit party')}
                    onClick={(e) => { e.stopPropagation(); openEdit(vendor); }}
                  >
                    <EditOutlinedIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    title={tr('Delete party')}
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
          key={dialog.vendor?.id ?? `new-${dialog.typeFlag}`}
          open
          vendor={dialog.vendor}
          vendors={vendors}
          typeFlag={dialog.typeFlag}
          onSave={save}
          onClose={() => setDialog({ open: false, vendor: null, typeFlag: PARTY_TYPE_FLAG.vendor })}
          error={saveError}
        />
      )}

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          <T>Delete</T> {deleteTarget?.typeFlag === PARTY_TYPE_FLAG.customer ? 'customer' : 'vendor'}?
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            {deleteError && <Alert severity="error" onClose={() => setDeleteError(null)}>{deleteError}</Alert>}
            <DialogContentText>
              <T>This permanently removes</T> <strong>{deleteTarget?.nameEn}</strong>{' '}
              ({deleteTarget?.vendorNo}<T>) from the party file.</T>
            </DialogContentText>
            <DialogContentText>
              <T>A party with purchase invoices or item-master links cannot be deleted - mark it
              inactive instead so those records keep their reference.</T>
            </DialogContentText>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDeleteTarget(null)}><T>Cancel</T></Button>
          <Button color="error" variant="contained" onClick={confirmDelete}><T>Delete</T></Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
