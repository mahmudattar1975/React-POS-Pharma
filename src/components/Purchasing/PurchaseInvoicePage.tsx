import { useMemo, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Chip, Dialog, DialogContent, DialogTitle, Divider, FormControl,
  IconButton, InputLabel, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import VisibilityIcon from '@mui/icons-material/Visibility';
import type { Item, PackLevel } from '../../types/catalog';
import type { PurchaseInvoice, PurchaseLine } from '../../types/purchasing';
import { computePurchaseTotals, dilutedUnitCost, pricePurchaseLine } from '../../utils/purchasing';
import { itemCodes } from '../../utils/itemMaster';
import { PACK_LEVEL_LABEL_PLURAL, purchasePackLevels } from '../../utils/packUnits';
import { cleanVatNumberInput, isVatNumberComplete, isVatNumberEmptyOrComplete } from '../../utils/vat';
import { useCatalogStore } from '../../store/catalogStore';
import { usePurchasingStore } from '../../store/purchasingStore';
import { useCostCenterStore } from '../../store/costCenterStore';
import { useSettingsStore } from '../../store/settingsStore';

// Same status/badge pattern as the other entry screens - a posted invoice is final (stock moved);
// correcting a number means receiving a proper return/credit note against the vendor, not
// editing history. So the form below is create-only, and posted invoices are read-only history.
export default function PurchaseInvoicePage() {
  const {
    vendors,
    invoices,
    addVendor,
    nextVendorNo,
    nextPurchaseNo,
    isVendorInvoiceNoUsed,
    receivePurchaseInvoice,
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
  const [vendorId, setVendorId] = useState('');
  const [costCenterId, setCostCenterId] = useState<string | undefined>(defaultCostCenterId);
  const [newVendorOpen, setNewVendorOpen] = useState(false);
  const [newVendorNameEn, setNewVendorNameEn] = useState('');
  const [newVendorNameAr, setNewVendorNameAr] = useState('');
  const [newVendorPhone, setNewVendorPhone] = useState('');
  const [newVendorVat, setNewVendorVat] = useState('');
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
  // Up to three cascading vendor discount tiers, entered as whole percentage points like the
  // legacy screen's em_11-1..3 fields. All three inputs stay visible on screen (the vendor may
  // quote 1, 2 or 3 successive discounts on the same invoice); leaving one empty simply means
  // that tier is 0, so the cascade stops there.
  const [discountPercent1, setDiscountPercent1] = useState('');
  const [discountPercent2, setDiscountPercent2] = useState('');
  const [discountPercent3, setDiscountPercent3] = useState('');
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [posted, setPosted] = useState<PurchaseInvoice | null>(null);

  const [viewing, setViewing] = useState<PurchaseInvoice | null>(null);

  const vendor = vendors.find((v) => v.id === vendorId);

  const entryTiers = [discountPercent1, discountPercent2, discountPercent3].map((d) => (Number(d) || 0) / 100);
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
    !!vendor && !!vendorInvoiceNo.trim() && isVendorInvoiceNoUsed(vendor.id, vendorInvoiceNo);

  const invoiceHeaderValid = !!vendor && !!vendorInvoiceNo.trim() && !!date && lines.length > 0 && !duplicateVendorInvoice;

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
    setLines((ls) => [...ls, line]);
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

  function saveVendor() {
    const saved = addVendor({
      nameEn: newVendorNameEn.trim(),
      nameAr: newVendorNameAr.trim() || newVendorNameEn.trim(),
      phone: newVendorPhone.trim(),
      // Null when left blank (non-registered vendor) rather than an empty string, so callers can
      // tell "no VAT number" apart from "number not fetched yet" if that distinction matters later.
      vatNumber: newVendorVat || undefined,
    });
    setNewVendorOpen(false);
    setNewVendorNameEn('');
    setNewVendorNameAr('');
    setNewVendorPhone('');
    setNewVendorVat('');
    setVendorId(saved.id);
  }

  const newVendorValid = !!newVendorNameEn.trim() && isVatNumberEmptyOrComplete(newVendorVat);

  function post() {
    if (!invoiceHeaderValid || !vendor) return;
    try {
      const invoice: PurchaseInvoice = {
        id: `pur-${Date.now()}`,
        invoiceNo: nextPurchaseNo(),
        vendorInvoiceNo: vendorInvoiceNo.trim(),
        vendorId: vendor.id,
        // Snapshot the vendor's system number on the posted document: the vendor master row may
        // later be renamed (or even removed), but the invoice must keep showing who it came from.
        vendorNo: vendor.vendorNo,
        vendorNameAr: vendor.nameAr,
        vendorNameEn: vendor.nameEn,
        date,
        costCenterId,
        notes: notes.trim() || undefined,
        receivedAt: new Date().toISOString(),
        receivedBy: cashierName,
        lines,
        ...totals,
      };
      receivePurchaseInvoice(invoice);
      setPosted(invoice);
      setLines([]);
      setVendorInvoiceNo('');
      setNotes('');
    } catch (err) {
      // receivePurchaseInvoice refuses to half-post (it validates every line's item first), so
      // reaching here means nothing moved and the entered form is preserved as-is for retry.
      alert(String(err));
    }
  }

  return (
    <Box sx={{ maxWidth: 960 }}>
      <Stack spacing={2}>
        {posted && (
          <Alert severity="success" onClose={() => setPosted(null)}>
            {posted.invoiceNo} received from {posted.vendorNameEn} - {posted.lines.length} line(s),
            SAR {posted.totalInclVat.toFixed(2)} incl. VAT. Stock has been posted.
          </Alert>
        )}

        {/* ---- vendor + document header */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>Vendor & Invoice</Typography>
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Select
                labelId="vendor-label"
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                displayEmpty
                fullWidth
                size="small"
                disabled={newVendorOpen}
              >
                <MenuItem value="">
                  <em>Select vendor</em>
                </MenuItem>
                {vendors.map((v) => (
                  <MenuItem key={v.id} value={v.id}>
                    {v.vendorNo} — {v.nameEn}
                    {v.isActive === false ? ' (inactive)' : ''}
                  </MenuItem>
                ))}
              </Select>
              <Button
                variant={newVendorOpen ? 'text' : 'outlined'}
                size="small"
                startIcon={<AddIcon />}
                onClick={() => { setNewVendorOpen((o) => !o); setVendorId(''); }}
              >
                New vendor
              </Button>
            </Stack>

            {newVendorOpen && (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={1.5}>
                  {/* The vendor number is system-assigned (VEN-000001...), never typed. Showing the
                      preview here makes it obvious the number exists before saving, while addVendor
                      remains the only place that actually assigns it - so two users saving at once
                      can never pick the same number. */}
                  <TextField
                    label="Vendor No."
                    value={nextVendorNo()}
                    size="small"
                    fullWidth
                    slotProps={{ input: { readOnly: true } }}
                    helperText="Assigned automatically when the vendor is saved."
                  />
                  <TextField label="Vendor name (English)" value={newVendorNameEn} onChange={(e) => setNewVendorNameEn(e.target.value)} size="small" fullWidth />
                  <TextField label="Vendor name (Arabic - عربي, optional)" value={newVendorNameAr} onChange={(e) => setNewVendorNameAr(e.target.value)} size="small" dir="rtl" fullWidth />
                  <TextField label="Phone" value={newVendorPhone} onChange={(e) => setNewVendorPhone(e.target.value)} size="small" fullWidth />
                  {/* VAT is OPTIONAL (blank is legal for a non-registered vendor) but when typed
                      it is exactly 15 digits (KSA rule). onChange sanitizes as you type, so a
                      16th digit is simply not accepted and letters/spaces never get in; the error
                      message counts the digits entered so a short number is obvious before save,
                      and Save is disabled until it is complete or cleared. */}
                  <TextField
                    label="VAT number (optional)"
                    value={newVendorVat}
                    onChange={(e) => setNewVendorVat(cleanVatNumberInput(e.target.value))}
                    size="small"
                    type="text"
                    error={newVendorVat !== '' && !isVatNumberComplete(newVendorVat)}
                    helperText={
                      newVendorVat !== '' && !isVatNumberComplete(newVendorVat)
                        ? `VAT no. has 15 digits — ${newVendorVat.length}/15 entered.`
                        : newVendorVat === ''
                          ? 'Leave empty if the vendor has no VAT number; if entered, it must be 15 digits.'
                          : "From the vendor's own invoice - verify before paying recoverable input tax."
                    }
                    slotProps={{ htmlInput: { maxLength: 15, inputMode: 'numeric' } }}
                    fullWidth
                  />
                  <Button variant="contained" size="small" disabled={!newVendorValid} onClick={saveVendor} sx={{ alignSelf: 'flex-start' }}>
                    Save vendor
                  </Button>
                </Stack>
              </Paper>
            )}

            {vendor && !newVendorOpen && (
              <Typography variant="caption" color="text.secondary">
                {vendor.vendorNo} · {vendor.nameAr} · Phone {vendor.phone} · VAT {vendor.vatNumber || '—'}
              </Typography>
            )}

            <Stack direction="row" spacing={1.5}>
              <TextField
                label="Vendor's invoice no"
                value={vendorInvoiceNo}
                onChange={(e) => setVendorInvoiceNo(e.target.value)}
                size="small"
                helperText="The number printed on the vendor's paper invoice - used to detect double-posting."
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
                A purchase invoice from this vendor with this number was already received - receiving
                it again would double the stock. Check the history below.
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
                the form. Empty = 0% for that tier. */}
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <TextField
                label="Vendor discount 1"
                type="number"
                value={discountPercent1}
                onChange={(e) => setDiscountPercent1(e.target.value)}
                size="small"
                helperText="% off the paid gross"
                slotProps={{ htmlInput: { min: 0, max: 100, step: '0.1' } }}
                sx={{ flex: '1 1 190px', minWidth: 190 }}
              />
              <TextField
                label="Vendor discount 2"
                type="number"
                value={discountPercent2}
                onChange={(e) => setDiscountPercent2(e.target.value)}
                size="small"
                helperText="% off what's left"
                slotProps={{ htmlInput: { min: 0, max: 100, step: '0.1' } }}
                sx={{ flex: '1 1 190px', minWidth: 190 }}
              />
              <TextField
                label="Vendor discount 3"
                type="number"
                value={discountPercent3}
                onChange={(e) => setDiscountPercent3(e.target.value)}
                size="small"
                helperText="% off what's left"
                slotProps={{ htmlInput: { min: 0, max: 100, step: '0.1' } }}
                sx={{ flex: '1 1 190px', minWidth: 190 }}
              />
            </Stack>
            <Button variant="outlined" startIcon={<AddIcon />} disabled={!lineValid} onClick={addLine} sx={{ alignSelf: 'flex-start' }}>
              Add line to invoice
            </Button>

            {lines.length > 0 && (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Item</TableCell>
                      <TableCell align="right">Qty</TableCell>
                      <TableCell>Batch</TableCell>
                      <TableCell>Expiry</TableCell>
                      <TableCell align="right">Unit cost</TableCell>
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
                        <TableCell align="right">
                          {lineUnitCost(l).toFixed(3)}
                          {l.bonusQty > 0 && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              paid-unit {l.unitCostPrice.toFixed(3)}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">{l.netExclVat.toFixed(2)}</TableCell>
                        <TableCell align="right">{l.vatAmount.toFixed(2)}</TableCell>
                        <TableCell align="right">{l.totalInclVat.toFixed(2)}</TableCell>
                        <TableCell>
                          <IconButton size="small" onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))} aria-label="Remove line">
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
                  <Row label="Vendor discounts" value={`-${totals.totalDiscount.toFixed(2)}`} />
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

        <Button
          variant="contained"
          size="large"
          onClick={post}
          disabled={!invoiceHeaderValid}
        >
          Receive into stock ({lines.length} line{lines.length === 1 ? '' : 's'}) · SAR {totals.totalInclVat.toFixed(2)}
        </Button>

        {/* ---- posted history */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>Posted Invoices</Typography>
          {invoices.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No purchase invoices posted yet.
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>No.</TableCell>
                    <TableCell>Date</TableCell>
                    <TableCell>Vendor</TableCell>
                    <TableCell>Vendor No.</TableCell>
                    <TableCell>Vendor inv. no</TableCell>
                    <TableCell>Center</TableCell>
                    <TableCell align="right">Lines</TableCell>
                    <TableCell align="right">Total (SAR)</TableCell>
                    <TableCell align="right">Input VAT</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {[...invoices].reverse().map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell>{inv.invoiceNo}</TableCell>
                      <TableCell>{inv.date}</TableCell>
                      <TableCell>{inv.vendorNameEn}</TableCell>
                      <TableCell>
                        {/* Invoices posted before vendor numbering existed have no snapshot; fall
                            back to the current master row so history still reads consistently. */}
                        {inv.vendorNo ?? vendors.find((v) => v.id === inv.vendorId)?.vendorNo ?? '—'}
                      </TableCell>
                      <TableCell>{inv.vendorInvoiceNo}</TableCell>
                      <TableCell>
                        {inv.costCenterId
                          ? centers.find((c) => c.id === inv.costCenterId)?.code ?? '—'
                          : '—'}
                      </TableCell>
                      <TableCell align="right">{inv.lines.length}</TableCell>
                      <TableCell align="right">{inv.totalInclVat.toFixed(2)}</TableCell>
                      <TableCell align="right">{inv.totalVatAmount.toFixed(2)}</TableCell>
                      <TableCell align="right">
                        <IconButton size="small" onClick={() => setViewing(inv)} aria-label="View invoice">
                          <VisibilityIcon fontSize="small" />
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

      <Dialog open={!!viewing} onClose={() => setViewing(null)} maxWidth="sm" fullWidth>
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
                {viewing.vendorNo ?? vendors.find((v) => v.id === viewing.vendorId)?.vendorNo ?? '—'}
                {' · '}
                {viewing.vendorNameAr}
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
                    <TableCell align="right">Unit cost</TableCell>
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
                      <TableCell align="right">
                        {lineUnitCost(l).toFixed(3)}
                        {l.bonusQty > 0 && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            paid-unit {l.unitCostPrice.toFixed(3)}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">{l.totalInclVat.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Divider />
              <Row label="Subtotal (excl. VAT)" value={viewing.subtotalExclVat.toFixed(2)} />
              <Row label="Vendor discounts" value={`-${viewing.totalDiscount.toFixed(2)}`} />
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
      </Dialog>
    </Box>
  );
}

// Invoices posted before bonus-diluted costing existed carry only the per-paid-unit cost, so fall
// back to it rather than rendering undefined for history rows.
function lineUnitCost(l: PurchaseLine): number {
  return l.dilutedUnitCostPrice ?? l.unitCostPrice;
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
