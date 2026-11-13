import { useMemo, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, FormControl, FormControlLabel, IconButton, InputLabel, MenuItem, Paper, Select, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import PrintIcon from '@mui/icons-material/Print';
import VisibilityIcon from '@mui/icons-material/Visibility';
import type { Item, PackLevel } from '../../types/catalog';
import type { PurchaseInvoice, PurchaseLine } from '../../types/purchasing';
import { PARTY_TYPE_FLAG, type PartyTypeFlag } from '../../types/party';
import { buildPartyTable } from '../../utils/party';
import { computePurchaseTotals, dilutedUnitCost, discountInputToFraction, formatDiscountInput, formatDiscountPercent, pricePurchaseLine } from '../../utils/purchasing';
import { itemCodes } from '../../utils/itemMaster';
import { PACK_LEVEL_LABEL_PLURAL, purchasePackLevels } from '../../utils/packUnits';
import { cleanVatNumberInput, isVatNumberComplete, isVatNumberEmptyOrComplete } from '../../utils/vat';
import { useCatalogStore } from '../../store/catalogStore';
import { usePurchasingStore } from '../../store/purchasingStore';
import { useCostCenterStore } from '../../store/costCenterStore';
import { useSettingsStore } from '../../store/settingsStore';
import PurchaseInvoiceDocument from './PurchaseInvoiceDocument';
import DiscountInput from '../common/DiscountInput';

// Posted invoices are final documents, but the owner can correct or remove one: the form below
// switches into edit mode, reversing the original stock receipt first. That reversal is refused
// when part of the delivery has already been sold - use a purchase return / credit note then.
export default function PurchaseInvoicePage() {
  const {
    vendors,
    invoices,
    addVendor,
    addCustomer,
    nextVendorNo,
    nextCustomerNo,
    nextPurchaseNo,
    isVendorInvoiceNoUsed,
    receivePurchaseInvoice,
    updatePurchaseInvoice,
    deletePurchaseInvoice,
  } = usePurchasingStore();
  const { items } = useCatalogStore();
  const cashierName = useSettingsStore((s) => s.settings.cashierName);
  // Branch (cost-center) tagging: defaults to this register's branch from settings; overridable
  // per invoice because one cash purchase (e.g. central-warehouse supplies) can belong to
  // another branch. Only ACTIVE, posting-enabled centers appear in the picker, and an invoice
  // may be posted without one - undefined rows land in the Expenses page's unassigned exception
  // list rather than blocking receiving (stock must never be blocked by accounting metadata).
  // Select the RAW center array (stable reference between store updates) - filtering inside the
  // selector itself would create a brand-new array on every read, and zustand v5's
  // useSyncExternalStore treats each "changed" snapshot as reason to re-render, looping forever
  // (page never opens). Derive filtered rows in useMemo instead, like ReportsPage does.
  const centers = useCostCenterStore((s) => s.centers);
  const defaultCostCenterId = useSettingsStore((s) => s.settings.costCenterId);
  const postingCenters = useMemo(() => centers.filter((c) => c.isActive && c.IsPostingAllowed), [centers]);

  // ---- header fields
  // The party can be either side of the legacy FCODCSVN master: a supplier (type_flag 1, the normal
  // purchase) or a real customer account (type_flag 2, e.g. a buy-back / customer return). The
  // POS walk-in placeholder is deliberately never offered - it is a till default, not an account.
  const [partyType, setPartyType] = useState<PartyTypeFlag>(PARTY_TYPE_FLAG.vendor);
  const [partyId, setPartyId] = useState('');
  const [costCenterId, setCostCenterId] = useState<string | undefined>(defaultCostCenterId);
  const [newPartyOpen, setNewPartyOpen] = useState(false);
  const [newPartyNameEn, setNewPartyNameEn] = useState('');
  const [newPartyNameAr, setNewPartyNameAr] = useState('');
  const [newPartyPhone, setNewPartyPhone] = useState('');
  const [newPartyVat, setNewPartyVat] = useState('');
  const [vendorInvoiceNo, setVendorInvoiceNo] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');

  // ---- line entry
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [qty, setQty] = useState('');
  const [bonusQty, setBonusQty] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [unitPurchasePrice, setUnitPurchasePrice] = useState('');
  // Packed items: which unit this delivery line is written in. Price/qty/bonus are all in it.
  const [receiveUnit, setReceiveUnit] = useState<PackLevel>('box');
  // Up to three cascading vendor discount tiers, entered as fractions like the legacy screen's
  // em_11-1..3 fields (0.1667 = 16.67%). All three inputs stay visible on screen (the vendor may
  // quote 1, 2 or 3 successive discounts on the same invoice); leaving one empty simply means
  // that tier is 0, so the cascade stops there.
  const [discountPercent1, setDiscountPercent1] = useState('');
  const [discountPercent2, setDiscountPercent2] = useState('');
  const [discountPercent3, setDiscountPercent3] = useState('');
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  // When set, the line-entry panel is editing this line instead of adding a new one.
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [posted, setPosted] = useState<PurchaseInvoice | null>(null);
  // The posted invoice currently loaded into the form for correction. Null = create mode.
  const [editing, setEditing] = useState<PurchaseInvoice | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PurchaseInvoice | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [viewing, setViewing] = useState<PurchaseInvoice | null>(null);
  // A4 goods-received document, printable from the row and from the quick-view dialog. Same
  // "reprint what was posted" rule as sales: the document is rebuilt from the stored invoice, never
  // from the current vendor/item master, so a later rename cannot rewrite history.
  const [printing, setPrinting] = useState<PurchaseInvoice | null>(null);
  const printingParty = printing
    ? vendors.find(
        (v) =>
          v.id === printing.vendorId &&
          v.typeFlag === (printing.partyType ?? PARTY_TYPE_FLAG.vendor)
      )
    : undefined;
  const printingCenter = printing?.costCenterId
    ? centers.find((c) => c.id === printing.costCenterId)
    : undefined;

  // One party table (legacy FCODCSVN): vendors and business customers are rows in the same array,
  // tagged with type_flag. The checkbox only filters this table by flag - it never switches to a
  // second, parallel list, which is what the legacy window's wcust_type switch did. POS patients
  // are a different master and never appear here.
  const partyTable = useMemo(() => buildPartyTable(vendors), [vendors]);
  const partyOptions = useMemo(
    () => partyTable.filter((p) => p.typeFlag === partyType),
    [partyTable, partyType]
  );
  const party = vendors.find((v) => v.id === partyId && v.typeFlag === partyType);

  const entryTiers = [discountPercent1, discountPercent2, discountPercent3].map(discountInputToFraction);
  // The per-RECEIVED-unit cost (paid + bonus) after the tier cascade - exactly what gets written to
  // Batch.costPrice when the line posts. qty 100 + bonus 10 @ 20 -> 18.182, so the preview moves
  // the moment the user types a bonus qty, which is the whole point of showing it here.
  const entryUnitCost = dilutedUnitCost({
    qty: Number(qty) || 0,
    bonusQty: Number(bonusQty) || 0,
    unitPurchasePrice: Number(unitPurchasePrice) || 0,
    discountTiers: entryTiers,
  });

  const tierValid = entryTiers.every((d) => d >= 0 && d <= 1);
  const lineValid =
    !!selectedItem && Number(qty) > 0 && Number(bonusQty || '0') >= 0 && !!batchNo.trim() && !!expiryDate &&
    Number(unitPurchasePrice) >= 0 && tierValid;

  const totals = useMemo(() => computePurchaseTotals(lines), [lines]);

  // Same double-post guard philosophy as HeadOfficeReceiving's transfer-number check: the vendor +
  // their own invoice number is the key that identifies a physical delivery, so re-entering it
  // would double-credit stock.
  const duplicateVendorInvoice =
    !!party && !!vendorInvoiceNo.trim() &&
    isVendorInvoiceNoUsed(party.id, vendorInvoiceNo, editing?.id);

  const invoiceHeaderValid = !!party && !!vendorInvoiceNo.trim() && !!date && lines.length > 0 && !duplicateVendorInvoice;

  function resetLineEntry() {
    setEditingLineId(null);
    setSelectedItem(null);
    setQty('');
    setBonusQty('');
    setBatchNo('');
    setExpiryDate('');
    setUnitPurchasePrice('');
    setReceiveUnit('box');
    setDiscountPercent1('');
    setDiscountPercent2('');
    setDiscountPercent3('');
  }

  function addLine() {
    if (!lineValid || !selectedItem) return;
    const line = pricePurchaseLine({
      item: selectedItem,
      qty: Number(qty),
      bonusQty: Number(bonusQty || '0'),
      batchNo: batchNo.trim(),
      expiryDate,
      unitPurchasePrice: Number(unitPurchasePrice),
      discountTiers: entryTiers,
      packLevel: selectedItem.pack ? receiveUnit : undefined,
    });
    if (editingLineId) {
      // Keep the row's id so React and any later stock reversal still see the same line.
      setLines((ls) => ls.map((existing) => (existing.id === editingLineId ? { ...line, id: editingLineId } : existing)));
    } else {
      setLines((ls) => [...ls, line]);
    }
    resetLineEntry();
  }

  // Load a line back into the entry panel, with its tier rates restored as the whole percentages
  // the user originally typed (0.1667 -> "16.67").
  function beginLineEdit(line: PurchaseLine) {
    setEditingLineId(line.id);
    setSelectedItem(items.find((item) => item.id === line.itemId) ?? null);
    setQty(String(line.qty));
    setBonusQty(line.bonusQty > 0 ? String(line.bonusQty) : '');
    setBatchNo(line.batchNo);
    setExpiryDate(line.expiryDate);
    setUnitPurchasePrice(String(line.unitPurchasePrice));
    setReceiveUnit(line.packLevel ?? 'box');
    setDiscountPercent1(formatDiscountInput(line.discount1Percent));
    setDiscountPercent2(formatDiscountInput(line.discount2Percent));
    setDiscountPercent3(formatDiscountInput(line.discount3Percent));
  }

  function saveParty() {
    const input = {
      nameEn: newPartyNameEn.trim(),
      nameAr: newPartyNameAr.trim() || newPartyNameEn.trim(),
      phone: newPartyPhone.trim(),
      // Null when left blank (non-registered party) rather than an empty string, so callers can
      // tell "no VAT number" apart from "number not fetched yet" if that distinction matters later.
      vatNumber: newPartyVat || undefined,
    };
    const saved = partyType === PARTY_TYPE_FLAG.customer ? addCustomer(input) : addVendor(input);
    setNewPartyOpen(false);
    setNewPartyNameEn('');
    setNewPartyNameAr('');
    setNewPartyPhone('');
    setNewPartyVat('');
    setPartyId(saved.id);
  }

  const newPartyValid = !!newPartyNameEn.trim() && isVatNumberEmptyOrComplete(newPartyVat);

  function post() {
    if (!invoiceHeaderValid || !party) return;
    try {
      const invoice: PurchaseInvoice = {
        id: editing?.id ?? `pur-${Date.now()}`,
        invoiceNo: editing?.invoiceNo ?? nextPurchaseNo(),
        vendorInvoiceNo: vendorInvoiceNo.trim(),
        // Snapshot which side of the party master this came from (legacy type_flag). The
        // vendor* fields below then describe that party by id/number/name, whichever it is.
        partyType,
        vendorId: party.id,
        // Snapshot the vendor's system number on the posted document: the vendor master row may
        // later be renamed (or even removed), but the invoice must keep showing who it came from.
        vendorNo: party.vendorNo,
        vendorNameAr: party.nameAr,
        vendorNameEn: party.nameEn,
        date,
        costCenterId,
        notes: notes.trim() || undefined,
        // The receipt stamp belongs to the original posting; an edit must not pretend the goods
        // were received again.
        receivedAt: editing?.receivedAt ?? new Date().toISOString(),
        receivedBy: editing?.receivedBy ?? cashierName,
        lines,
        ...totals,
      };
      if (editing) updatePurchaseInvoice(editing.id, invoice);
      else receivePurchaseInvoice(invoice);
      setPosted(invoice);
      setEditing(null);
      setLines([]);
      resetLineEntry();
      setVendorInvoiceNo('');
      setNotes('');
    } catch (err) {
      // The store validates every line and checks the old stock is still on hand before touching
      // anything, so reaching here means nothing moved and the entered form is preserved for retry.
      alert(String(err));
    }
  }

  // Load a posted invoice into the form. The stock is not reversed until the user saves, so
  // cancelling leaves the original receipt untouched.
  function beginEdit(invoice: PurchaseInvoice) {
    setEditing(invoice);
    setViewing(null);
    setPosted(null);
    resetLineEntry();
    setPartyType(invoice.partyType ?? PARTY_TYPE_FLAG.vendor);
    setPartyId(invoice.vendorId);
    setCostCenterId(invoice.costCenterId);
    setVendorInvoiceNo(invoice.vendorInvoiceNo);
    setDate(invoice.date);
    setNotes(invoice.notes ?? '');
    setLines(invoice.lines);
    setSelectedItem(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditing(null);
    setLines([]);
    resetLineEntry();
    setVendorInvoiceNo('');
    setNotes('');
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    try {
      deletePurchaseInvoice(deleteTarget.id);
      setDeleteTarget(null);
      setDeleteError(null);
      if (editing?.id === deleteTarget.id) cancelEdit();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Box>
      <Stack spacing={2}>
        {posted && (
          <Alert severity="success" onClose={() => setPosted(null)}>
            {posted.partyType === PARTY_TYPE_FLAG.customer ? 'Customer document' : 'Vendor invoice'}{' '}
            {posted.vendorInvoiceNo} · {posted.invoiceNo} received from {posted.vendorNameEn} - {posted.lines.length} line(s),
            SAR {posted.totalInclVat.toFixed(2)} incl. VAT. Stock has been posted.
          </Alert>
        )}

        {editing && (
          <Alert
            severity="info"
            action={<Button color="inherit" size="small" onClick={cancelEdit}>Cancel edit</Button>}
          >
            Editing {editing.partyType === PARTY_TYPE_FLAG.customer ? 'customer document' : 'vendor invoice'}{' '}
            {editing.vendorInvoiceNo} · {editing.invoiceNo} · {editing.vendorNameEn}. Saving reverses the original stock
            receipt and posts the corrected lines; cancelling leaves it untouched.
          </Alert>
        )}

        {/* ---- party (vendor or customer) + document header */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>Vendor / Customer & Invoice</Typography>
          <Stack spacing={2}>
            {/* Legacy FCODCSVN type_flag switch: a purchase normally comes from a vendor (1), but a
                buy-back / customer return is booked against a real customer account (2). */}
            <FormControlLabel
              control={
                <Checkbox
                  checked={partyType === PARTY_TYPE_FLAG.customer}
                  onChange={(e) => {
                    setPartyType(e.target.checked ? PARTY_TYPE_FLAG.customer : PARTY_TYPE_FLAG.vendor);
                    setPartyId('');
                    setNewPartyOpen(false);
                  }}
                />
              }
              label="Customer (type_flag = 2) — unchecked means vendor (type_flag = 1)"
            />
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Select
                labelId="party-label"
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                displayEmpty
                fullWidth
                size="small"
                disabled={newPartyOpen}
              >
                <MenuItem value="">
                  <em>{partyType === PARTY_TYPE_FLAG.customer ? 'Select customer' : 'Select vendor'}</em>
                </MenuItem>
                {partyOptions.map((p) => (
                  <MenuItem key={`${p.typeFlag}-${p.id}`} value={p.id}>
                    {`${p.no} — ${p.nameEn}`}
                    {p.vatNumber ? ` · VAT ${p.vatNumber}` : ''}
                    {!p.isActive ? ' (inactive)' : ''}
                  </MenuItem>
                ))}
              </Select>
              <Button
                variant={newPartyOpen ? 'text' : 'outlined'}
                size="small"
                startIcon={<AddIcon />}
                onClick={() => { setNewPartyOpen((o) => !o); setPartyId(''); }}
              >
                {partyType === PARTY_TYPE_FLAG.customer ? 'New customer' : 'New vendor'}
              </Button>
            </Stack>

            {newPartyOpen && (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={1.5}>
                  {/* The party number is system-assigned (VEN-/CUS-000001...), never typed. Showing
                      the preview here makes it obvious the number exists before saving, while
                      addVendor/addCustomer remains the only place that actually assigns it - so two
                      users saving at once can never pick the same number. */}
                  <TextField
                    label={partyType === PARTY_TYPE_FLAG.customer ? 'Customer No.' : 'Vendor No.'}
                    value={partyType === PARTY_TYPE_FLAG.customer ? nextCustomerNo() : nextVendorNo()}
                    size="small"
                    fullWidth
                    slotProps={{ input: { readOnly: true } }}
                    helperText={`Assigned automatically when the ${partyType === PARTY_TYPE_FLAG.customer ? 'customer' : 'vendor'} is saved.`}
                  />
                  <TextField
                    label={partyType === PARTY_TYPE_FLAG.customer ? 'Customer name (English)' : 'Vendor name (English)'}
                    value={newPartyNameEn}
                    onChange={(e) => setNewPartyNameEn(e.target.value)}
                    size="small"
                    fullWidth
                  />
                  <TextField
                    label={`${partyType === PARTY_TYPE_FLAG.customer ? 'Customer' : 'Vendor'} name (Arabic - عربي, optional)`}
                    value={newPartyNameAr}
                    onChange={(e) => setNewPartyNameAr(e.target.value)}
                    size="small"
                    dir="rtl"
                    fullWidth
                  />
                  <TextField label="Phone" value={newPartyPhone} onChange={(e) => setNewPartyPhone(e.target.value)} size="small" fullWidth />
                  {/* VAT is OPTIONAL (blank is legal for a non-registered party) but when typed
                      it is exactly 15 digits (KSA rule). onChange sanitizes as you type, so a
                      16th digit is simply not accepted and letters/spaces never get in; the error
                      message counts the digits entered so a short number is obvious before save,
                      and Save is disabled until it is complete or cleared. */}
                  <TextField
                    label="VAT number (optional)"
                    value={newPartyVat}
                    onChange={(e) => setNewPartyVat(cleanVatNumberInput(e.target.value))}
                    size="small"
                    type="text"
                    error={newPartyVat !== '' && !isVatNumberComplete(newPartyVat)}
                    helperText={
                      newPartyVat !== '' && !isVatNumberComplete(newPartyVat)
                        ? `VAT no. has 15 digits — ${newPartyVat.length}/15 entered.`
                        : newPartyVat === ''
                          ? `Leave empty if the ${partyType === PARTY_TYPE_FLAG.customer ? 'customer' : 'vendor'} has no VAT number; if entered, it must be 15 digits.`
                          : "From the party's own invoice - verify before paying recoverable input tax."
                    }
                    slotProps={{ htmlInput: { maxLength: 15, inputMode: 'numeric' } }}
                    fullWidth
                  />
                  <Button variant="contained" size="small" disabled={!newPartyValid} onClick={saveParty} sx={{ alignSelf: 'flex-start' }}>
                    {partyType === PARTY_TYPE_FLAG.customer ? 'Save customer' : 'Save vendor'}
                  </Button>
                </Stack>
              </Paper>
            )}

            {party && partyType === PARTY_TYPE_FLAG.vendor && !newPartyOpen && (
              <Typography variant="caption" color="text.secondary">
                {party.vendorNo} · {party.nameAr} · Phone {party.phone} · VAT {party.vatNumber || '—'}
              </Typography>
            )}
            {party && partyType === PARTY_TYPE_FLAG.customer && (
              <Typography variant="caption" color="text.secondary">
                Customer account · {party.vendorNo} · {party.nameAr} · Phone {party.phone} · VAT {party.vatNumber || '—'}
                {party.category ? ` · ${party.category}` : ''}
              </Typography>
            )}

            <Stack direction="row" spacing={1.5}>
              <TextField
                label={partyType === PARTY_TYPE_FLAG.customer ? 'Customer document no' : "Vendor's invoice no"}
                value={vendorInvoiceNo}
                onChange={(e) => setVendorInvoiceNo(e.target.value)}
                size="small"
                helperText={
                  partyType === PARTY_TYPE_FLAG.customer
                    ? "The reference printed on the customer's own document - used to detect double-posting."
                    : "The number printed on the vendor's paper invoice - used to detect double-posting."
                }
                fullWidth
              />
              <TextField
                label="Invoice seq."
                value={editing?.invoiceNo ?? nextPurchaseNo()}
                size="small"
                helperText="System-assigned PUR number - separate from the vendor's own document no."
                slotProps={{ input: { readOnly: true } }}
                fullWidth
              />
              <TextField
                label="Invoice date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                size="small"
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />
            </Stack>
            {duplicateVendorInvoice && (
              <Alert severity="warning" icon={false}>
                A purchase invoice from this {partyType === PARTY_TYPE_FLAG.customer ? 'customer' : 'vendor'} with this
                number was already received - receiving it again would double the stock. Check the history below.
              </Alert>
            )}
            <TextField
              label="Notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              size="small"
              fullWidth
            />
            <Select
              labelId="cost-center-label"
              value={costCenterId ?? ''}
              onChange={(e) => setCostCenterId(e.target.value || undefined)}
              displayEmpty
              size="small"
              sx={{ maxWidth: 420 }}
            >
              <MenuItem value="">
                <em>No cost center (unassigned exception)</em>
              </MenuItem>
              {postingCenters.map((c) => (
                <MenuItem key={c.id} value={c.id}>{c.code} — {c.nameEn}</MenuItem>
              ))}
            </Select>
            <Typography variant="caption" color="text.secondary">
              Attributed branch/department for this invoice (defaults to this register's branch).
            </Typography>
          </Stack>
        </Paper>

        {/* ---- line entry */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>Add Line</Typography>
          <Stack spacing={2}>
            <Autocomplete
              options={items}
              value={selectedItem}
              onChange={(_, v) => setSelectedItem(v)}
              getOptionLabel={(o) => o.nameEn}
              isOptionEqualToValue={(o, v) => o.id === v.id}
              renderOption={(props, o) => (
                <Box component="li" {...props} key={o.id}>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2">{o.nameEn}</Typography>
                    <Typography variant="caption" color="text.secondary">{o.nameAr} · {itemCodes(o).join(' / ')}</Typography>
                  </Box>
                  <Chip
                    size="small"
                    label={o.vatRate > 0 ? `VAT ${(o.vatRate * 100).toFixed(0)}%` : 'Zero-rated'}
                    color={o.vatRate > 0 ? 'default' : 'success'}
                    variant="outlined"
                  />
                </Box>
              )}
              renderInput={(params) => (
                <TextField {...params} label="Item (name or scroll)" size="small" fullWidth />
              )}
            />
            <Stack direction="row" spacing={1.5}>
              {selectedItem?.pack && (
                <FormControl size="small" sx={{ minWidth: 130 }}>
                  <InputLabel id="purchase-unit-label">Invoice unit</InputLabel>
                  <Select
                    labelId="purchase-unit-label"
                    label="Invoice unit"
                    value={receiveUnit}
                    onChange={(e) => setReceiveUnit(e.target.value as PackLevel)}
                  >
                    {purchasePackLevels(selectedItem.pack).map((level) => (
                      <MenuItem key={level} value={level}>{PACK_LEVEL_LABEL_PLURAL[level]}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              <TextField
                label={selectedItem?.pack ? `Qty (paid, ${PACK_LEVEL_LABEL_PLURAL[receiveUnit].toLowerCase()})` : 'Qty (paid)'}
                type="number"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                size="small"
                helperText={selectedItem?.pack ? 'Stock converts to tablets on posting' : 'Chargeable units'}
                fullWidth
              />
              <TextField
                label="Bonus (free)"
                type="number"
                value={bonusQty}
                onChange={(e) => setBonusQty(e.target.value)}
                size="small"
                helperText="Free goods, never priced or taxed"
                fullWidth
              />
            </Stack>
            <Stack direction="row" spacing={1.5}>
              <TextField label="Batch / Lot No." value={batchNo} onChange={(e) => setBatchNo(e.target.value)} size="small" fullWidth />
              <TextField
                label="Expiry Date"
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                size="small"
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />
            </Stack>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
              <TextField
                label="Unit purchase price (excl. VAT)"
                type="number"
                value={unitPurchasePrice}
                onChange={(e) => setUnitPurchasePrice(e.target.value)}
                size="small"
                slotProps={{ htmlInput: { step: '0.001', min: 0 } }}
                fullWidth
              />
              <TextField
                label="Unit cost (computed)"
                value={lineValid ? entryUnitCost.toFixed(3) : ''}
                disabled
                size="small"
                helperText="Per unit received (paid + bonus), after discounts"
                fullWidth
              />
            </Stack>
            {/* All three vendor discount tiers are always shown, like the legacy screen's
                em_11-1..3 masks. They cascade: #1 comes off the paid gross, #2 off what is left,
                #3 off what is left after that - so any subset can be used without re-laying out
                the form. Empty = 0 for that tier. */}
            <Typography variant="caption" color="text.secondary">
              Enter percentages (16.67% = 0.1667). Tiers cascade: #1 off the paid gross, #2 off what&apos;s
              left, #3 off what&apos;s left after that.
            </Typography>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <DiscountInput
                label="Discount 1"
                value={discountPercent1}
                onChange={setDiscountPercent1}
                size="small"
                sx={{ flex: '1 1 190px', minWidth: 190 }}
              />
              <DiscountInput
                label="Discount 2"
                value={discountPercent2}
                onChange={setDiscountPercent2}
                size="small"
                sx={{ flex: '1 1 190px', minWidth: 190 }}
              />
              <DiscountInput
                label="Discount 3"
                value={discountPercent3}
                onChange={setDiscountPercent3}
                size="small"
                sx={{ flex: '1 1 190px', minWidth: 190 }}
              />
            </Stack>
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" startIcon={<AddIcon />} disabled={!lineValid} onClick={addLine}>
                {editingLineId ? 'Update line' : 'Add line to invoice'}
              </Button>
              {editingLineId && (
                <Button color="inherit" onClick={resetLineEntry}>Cancel line edit</Button>
              )}
            </Stack>

            {lines.length > 0 && (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Item</TableCell>
                      <TableCell align="right">Qty</TableCell>
                      <TableCell>Batch</TableCell>
                      <TableCell>Expiry</TableCell>
                      <TableCell align="right">Unit price</TableCell>
                      <TableCell align="right">Unit cost</TableCell>
                      <TableCell align="right">Discount 1</TableCell>
                      <TableCell align="right">Discount 2</TableCell>
                      <TableCell align="right">Discount 3</TableCell>
                      <TableCell align="right">Net (excl. VAT)</TableCell>
                      <TableCell align="right">Input VAT</TableCell>
                      <TableCell align="right">Total</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {lines.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell>{l.itemNameEn}</TableCell>
                        <TableCell align="right">
                          {l.qty}
                          {l.bonusQty > 0 && (
                            <Typography variant="caption" color="text.secondary"> + {l.bonusQty} bonus</Typography>
                          )}
                        </TableCell>
                        <TableCell>{l.batchNo}</TableCell>
                        <TableCell>{l.expiryDate}</TableCell>
                        <TableCell align="right">{l.unitPurchasePrice.toFixed(3)}</TableCell>
                        <TableCell align="right">
                          {lineUnitCost(l).toFixed(3)}
                          {l.bonusQty > 0 && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              paid-unit {l.unitCostPrice.toFixed(3)}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">
                          <LineDiscount percent={l.discount1Percent} amount={l.discount1Amount} />
                        </TableCell>
                        <TableCell align="right">
                          <LineDiscount percent={l.discount2Percent} amount={l.discount2Amount} />
                        </TableCell>
                        <TableCell align="right">
                          <LineDiscount percent={l.discount3Percent} amount={l.discount3Amount} />
                        </TableCell>
                        <TableCell align="right">{l.netExclVat.toFixed(2)}</TableCell>
                        <TableCell align="right">{l.vatAmount.toFixed(2)}</TableCell>
                        <TableCell align="right">{l.totalInclVat.toFixed(2)}</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          <IconButton size="small" onClick={() => beginLineEdit(l)} aria-label="Modify line">
                            <EditOutlinedIcon fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => {
                              setLines((ls) => ls.filter((x) => x.id !== l.id));
                              if (editingLineId === l.id) resetLineEntry();
                            }}
                            aria-label="Remove line"
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {lines.length > 0 && (
              <Box sx={{ alignSelf: 'flex-end', minWidth: 300 }}>
                <Stack spacing={0.5} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                  <Row label="Subtotal (excl. VAT)" value={totals.subtotalExclVat.toFixed(2)} />
                  <Row label="Purchase discounts" value={`-${totals.totalDiscount.toFixed(2)}`} />
                  {totals.totalBonusValue > 0 && (
                    <Row
                      label="Bonus goods (free - not charged or taxed)"
                      value={totals.totalBonusValue.toFixed(2)}
                    />
                  )}
                  <Row label="Net before VAT" value={totals.netExclVat.toFixed(2)} />
                  {totals.vatByRate.map((b) => (
                    <Row
                      key={b.rate}
                      label={`Input VAT ${b.rate > 0 ? `(${(b.rate * 100).toFixed(0)}%)` : '(zero-rated)'}`}
                      value={b.vatAmount.toFixed(2)}
                    />
                  ))}
                  <Divider />
                  <Row label="Total incl. VAT (SAR)" value={totals.totalInclVat.toFixed(2)} bold />
                </Stack>
              </Box>
            )}
          </Stack>
        </Paper>

        <Stack direction="row" spacing={1.5}>
          <Button
            variant="contained"
            size="large"
            onClick={post}
            disabled={!invoiceHeaderValid}
          >
            {editing
              ? `Save changes to ${editing.invoiceNo} (${lines.length} line${lines.length === 1 ? '' : 's'}) · SAR ${totals.totalInclVat.toFixed(2)}`
              : `Receive into stock (${lines.length} line${lines.length === 1 ? '' : 's'}) · SAR ${totals.totalInclVat.toFixed(2)}`}
          </Button>
          {editing && (
            <Button size="large" color="inherit" onClick={cancelEdit}>
              Cancel
            </Button>
          )}
        </Stack>

        {/* ---- posted history */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>Posted Invoices</Typography>
          {/* Returns are posted documents too, but they are not purchases: editing or deleting one
              through this form would move stock in the wrong direction. They live on the Purchase
              Returns tab and are filtered out here. */}
          {invoices.filter((inv) => !inv.isReturn).length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No purchase invoices posted yet.
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Vendor / customer doc. no</TableCell>
                    <TableCell>Party No.</TableCell>
                    <TableCell>Invoice seq.</TableCell>
                    <TableCell>Date</TableCell>
                    <TableCell>Center</TableCell>
                    <TableCell align="right">Lines</TableCell>
                    <TableCell align="right">Total (SAR)</TableCell>
                    <TableCell align="right">Input VAT</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {invoices.filter((inv) => !inv.isReturn).reverse().map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell>{inv.vendorInvoiceNo}</TableCell>
                      <TableCell>
                        {/* Invoices posted before party numbering existed have no snapshot; fall
                            back to the current master row so history still reads consistently.
                            Both sides now carry a number (VEN- for a vendor, CUS- for a customer). */}
                        {inv.vendorNo ?? vendors.find((v) => v.id === inv.vendorId)?.vendorNo ?? '—'}
                      </TableCell>
                      <TableCell>{inv.invoiceNo}</TableCell>
                      <TableCell>{inv.date}</TableCell>
                      <TableCell>
                        {inv.costCenterId
                          ? centers.find((c) => c.id === inv.costCenterId)?.code ?? '—'
                          : '—'}
                      </TableCell>
                      <TableCell align="right">{inv.lines.length}</TableCell>
                      <TableCell align="right">{inv.totalInclVat.toFixed(2)}</TableCell>
                      <TableCell align="right">{inv.totalVatAmount.toFixed(2)}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <IconButton size="small" onClick={() => setViewing(inv)} aria-label="View invoice">
                          <VisibilityIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => setPrinting(inv)}
                          aria-label="Print purchase invoice"
                        >
                          <PrintIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => beginEdit(inv)}
                          aria-label="Modify purchase invoice"
                        >
                          <EditOutlinedIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => { setDeleteError(null); setDeleteTarget(inv); }}
                          aria-label="Delete purchase invoice"
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      </Stack>

      <Dialog open={!!viewing} onClose={() => setViewing(null)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {viewing?.invoiceNo}
          <IconButton size="small" onClick={() => setViewing(null)} aria-label="Close">
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {viewing && (
            <Stack spacing={1}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                <Chip
                  size="small"
                  variant="outlined"
                  label={viewing.partyType === PARTY_TYPE_FLAG.customer ? 'Customer' : 'Vendor'}
                  sx={{ mr: 1 }}
                />
                {viewing.vendorNo ?? vendors.find((v) => v.id === viewing.vendorId)?.vendorNo ?? '—'}
                {' · '}
                {viewing.vendorNameAr}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {viewing.partyType === PARTY_TYPE_FLAG.customer ? 'Customer document no' : 'Vendor invoice no'}:{' '}
                <strong>{viewing.vendorInvoiceNo}</strong>
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {viewing.vendorNameEn} · {viewing.date} · received by {viewing.receivedBy}
                {viewing.notes ? ` · ${viewing.notes}` : ''}
              </Typography>
              <Divider />
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Item</TableCell>
                    <TableCell align="right">Qty</TableCell>
                    <TableCell>Batch / expiry</TableCell>
                    <TableCell align="right">Unit price</TableCell>
                    <TableCell align="right">Unit cost</TableCell>
                    <TableCell align="right">Discount 1</TableCell>
                    <TableCell align="right">Discount 2</TableCell>
                    <TableCell align="right">Discount 3</TableCell>
                    <TableCell align="right">Total</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {viewing.lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>{l.itemNameEn}</TableCell>
                      <TableCell align="right">
                        {l.qty}
                        {l.bonusQty > 0 && (
                          <Typography variant="caption" color="text.secondary"> + {l.bonusQty} bonus</Typography>
                        )}
                      </TableCell>
                      <TableCell>{l.batchNo} · {l.expiryDate}</TableCell>
                      <TableCell align="right">{l.unitPurchasePrice.toFixed(3)}</TableCell>
                      <TableCell align="right">
                        {lineUnitCost(l).toFixed(3)}
                        {l.bonusQty > 0 && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            paid-unit {l.unitCostPrice.toFixed(3)}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <LineDiscount percent={l.discount1Percent} amount={l.discount1Amount} />
                      </TableCell>
                      <TableCell align="right">
                        <LineDiscount percent={l.discount2Percent} amount={l.discount2Amount} />
                      </TableCell>
                      <TableCell align="right">
                        <LineDiscount percent={l.discount3Percent} amount={l.discount3Amount} />
                      </TableCell>
                      <TableCell align="right">{l.totalInclVat.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Divider />
              <Row label="Subtotal (excl. VAT)" value={viewing.subtotalExclVat.toFixed(2)} />
              <Row label="Purchase discounts" value={`-${viewing.totalDiscount.toFixed(2)}`} />
              {viewing.totalBonusValue > 0 && (
                <Row label="Bonus goods (free - not charged or taxed)" value={viewing.totalBonusValue.toFixed(2)} />
              )}
              {viewing.vatByRate.map((b) => (
                <Row
                  key={b.rate}
                  label={`Input VAT ${b.rate > 0 ? `(${(b.rate * 100).toFixed(0)}%)` : '(zero-rated)'}`}
                  value={b.vatAmount.toFixed(2)}
                />
              ))}
              <Row label="Total incl. VAT (SAR)" value={viewing.totalInclVat.toFixed(2)} bold />
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            variant="outlined"
            startIcon={<PrintIcon />}
            onClick={() => {
              setPrinting(viewing);
              setViewing(null);
            }}
          >
            Print A4
          </Button>
          <Button
            startIcon={<EditOutlinedIcon />}
            onClick={() => { if (viewing) beginEdit(viewing); }}
          >
            Modify
          </Button>
          <Button onClick={() => setViewing(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete {deleteTarget?.invoiceNo}?</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            {deleteError && <Alert severity="error" onClose={() => setDeleteError(null)}>{deleteError}</Alert>}
            <Typography variant="body2">
              This removes the invoice from history and takes its received stock back out of the
              batches it created.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              If any of that delivery has already been sold or moved, deletion is refused - post a
              purchase return / credit note instead.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={confirmDelete}>Delete Invoice</Button>
        </DialogActions>
      </Dialog>

      <PurchaseInvoiceDocument
        open={printing !== null}
        invoice={printing}
        party={printingParty}
        costCenterLabel={printingCenter ? `${printingCenter.code} · ${printingCenter.nameEn}` : undefined}
        onClose={() => setPrinting(null)}
      />
    </Box>
  );
}

// Invoices posted before bonus-diluted costing existed carry only the per-paid-unit cost, so fall
// back to it rather than rendering undefined for history rows.
function lineUnitCost(l: PurchaseLine): number {
  return l.dilutedUnitCostPrice ?? l.unitCostPrice;
}

// One discount tier on a line, exactly as it was entered: the rate first, the SAR amount under it.
// A tier the vendor did not use shows a dash so every line keeps the same three columns.
function LineDiscount({ percent, amount }: { percent: number; amount: number }) {
  if (!(percent > 0)) {
    return (
      <Typography variant="caption" color="text.secondary">
        —
      </Typography>
    );
  }
  return (
    <>
      <Typography variant="caption" sx={{ display: 'block' }}>
        {formatDiscountPercent(percent)}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {amount.toFixed(2)}
      </Typography>
    </>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
      <Typography variant={bold ? 'body2' : 'caption'} color={bold ? 'text.primary' : 'text.secondary'} sx={bold ? { fontWeight: 700 } : undefined}>
        {label}
      </Typography>
      <Typography variant={bold ? 'body2' : 'caption'} sx={bold ? { fontWeight: 700 } : undefined}>
        {value}
      </Typography>
    </Stack>
  );
}
