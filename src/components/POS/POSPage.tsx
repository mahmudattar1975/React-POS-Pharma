import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Box, TextField, Table, TableHead, TableRow, TableCell, TableBody, IconButton, Typography,
  Button, Snackbar, Alert, Chip, Stack, Paper,
  CircularProgress, InputAdornment, List, ListItemButton, ListItemText, Tooltip,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import DiscountOutlinedIcon from '@mui/icons-material/DiscountOutlined';
import type { Item, Batch } from '../../types/catalog';
import { useCartStore, type ScanResult } from '../../store/cartStore';
import { useCatalogStore } from '../../store/catalogStore';
import { useSalesStore } from '../../store/salesStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useCustomerStore } from '../../store/customerStore';
import { generateInvoiceQr } from '../../utils/zatcaQr';
import * as zatcaApi from '../../api/zatcaApi';
import { isNearExpiry } from '../../utils/fefo';
import { activeOfferFor } from '../../utils/pricing';
import { pointsEarnedFor, pointsToSar, sarToPoints } from '../../utils/loyalty';
import { round2 } from '../../utils/vat';
import type { SaleHeader, SaleLine, Payment, ZatcaSubmissionStatus, PrescriptionInfo } from '../../types/sales';
import * as posApi from '../../api/posApi';
import { POS_PAYMENT_METHOD } from '../../types/pos';
import BatchPickerDialog from './BatchPickerDialog';
import PaymentDialog from './PaymentDialog';
import ReceiptView from './ReceiptView';
import LineDiscountPopover from './LineDiscountPopover';
import CustomerLookupDialog from './CustomerLookupDialog';
import OtherBranchStockDialog from './OtherBranchStockDialog';
import PrescriptionCaptureDialog from './PrescriptionCaptureDialog';

export default function POSPage() {
  const { lines, customer, setCustomer, scan, pickItem, addLineForBatch, updateQty, setLineDiscount, removeLine, totals, clear } = useCartStore();
  const { items, offers, decrementBatch, itemById } = useCatalogStore();
  const { nextInvoiceNo, recordSale } = useSalesStore();
  const settings = useSettingsStore((s) => s.settings);
  const { earnPoints, redeemPoints, pointsBalanceFor } = useCustomerStore();
  const customerPointsBalance = pointsBalanceFor(customer.id);

  const [scanValue, setScanValue] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // Same substring match as the Inventory & Expiry page's search (name AR/EN or barcode) - lets
  // the cashier find an item by typing its name, not just its exact barcode, without turning the
  // scan field into a full lookup UI. Capped short since it's a dropdown under a single input.
  const suggestions = useMemo(() => {
    const q = scanValue.trim().toLowerCase();
    if (!q) return [];
    return items
      .filter((i) => i.nameEn.toLowerCase().includes(q) || i.nameAr.includes(q) || i.barcode.includes(q))
      .slice(0, 8);
  }, [items, scanValue]);
  const dropdownOpen = isSearchFocused && suggestions.length > 0;

  const [picker, setPicker] = useState<{ open: boolean; item: Item | null; batches: Batch[] }>({ open: false, item: null, batches: [] });
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [prescriptionDialogOpen, setPrescriptionDialogOpen] = useState(false);
  const [prescription, setPrescription] = useState<PrescriptionInfo | null>(null);
  const [isSubmittingSale, setIsSubmittingSale] = useState(false);
  const [receipt, setReceipt] = useState<SaleHeader | null>(null);
  const [branchStockItem, setBranchStockItem] = useState<Item | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    severity: 'warning' | 'success';
    action?: { label: string; onClick: () => void };
  } | null>(null);
  // MUI's Snackbar only restarts its autoHideDuration timer when `open` itself flips false->true -
  // if a second notice arrives while the first is still showing, `open` never changes and the
  // FIRST notice's stale timer silently closes the second one early. Keying the Snackbar forces a
  // fresh instance (and timer) per notice, even back-to-back ones for the same item/offer.
  const toastSeq = useRef(0);
  const [toastKey, setToastKey] = useState(0);
  const [discountEditor, setDiscountEditor] = useState<{ anchorEl: HTMLElement; lineId: string } | null>(null);

  const t = totals();

  // Recomputed from the live cart every render (not cached in state) - if the cashier removes the
  // one controlled item after a prescription was already captured, the gate below re-evaluates
  // against an empty list rather than trusting stale state.
  const controlledLines = useMemo(
    () =>
      lines
        .map((l) => ({ itemNameEn: l.itemNameEn, controlledStatus: itemById(l.itemId)?.controlledStatus }))
        .filter((l): l is { itemNameEn: string; controlledStatus: NonNullable<typeof l.controlledStatus> } => !!l.controlledStatus),
    [lines, itemById]
  );

  function notify(message: string, severity: 'warning' | 'success', action?: { label: string; onClick: () => void }) {
    toastSeq.current += 1;
    setToastKey(toastSeq.current);
    setToast({ message, severity, action });
  }

  // Flags a promo the moment its item is added, not just via the cart row's chip - the cashier
  // is looking at the scan field right then, not necessarily the cart table, and this is the
  // natural moment to mention the deal to the customer before ringing up the rest of the order.
  function noteOfferIfAny(item: Item) {
    const today = new Date().toISOString().slice(0, 10);
    const offer = activeOfferFor(item, offers, today);
    if (offer) notify(`Offer on ${item.nameEn}: ${offer.label} — let the customer know.`, 'success');
  }

  function applyScanResult(result: ScanResult) {
    if (result.type === 'not-found') notify('Item not found for that barcode.', 'warning');
    else if (result.type === 'out-of-stock') {
      // Only an ERP-sourced item (id 'erp-<itemNo>') has a real XPH item number to check other
      // branches for - a local seed item has no such record, so no action is offered for those.
      const isErpItem = result.item.id.startsWith('erp-');
      notify(
        `${result.item.nameEn} has no stock in any batch.`,
        'warning',
        isErpItem ? { label: 'Check other branches', onClick: () => setBranchStockItem(result.item) } : undefined
      );
    } else if (result.type === 'no-batch-matched') notify(`Scanned batch/expiry doesn't match stock on hand for ${result.itemNameEn}.`, 'warning');
    else if (result.type === 'choose-batch') setPicker({ open: true, item: result.item, batches: result.batches });
    else if (result.type === 'added') noteOfferIfAny(result.item);
  }

  async function handleScanSubmit() {
    if (!scanValue.trim() || isScanning) return;
    setIsScanning(true);
    const value = scanValue;
    setScanValue('');
    try {
      applyScanResult(await scan(value));
    } finally {
      setIsScanning(false);
      inputRef.current?.focus();
    }
  }

  function pickFromSuggestions(item: Item) {
    if (isScanning) return;
    setScanValue('');
    setHighlightedIndex(-1);
    applyScanResult(pickItem(item));
    inputRef.current?.focus();
  }

  function handleScanKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (dropdownOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setHighlightedIndex((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
        if (next < 0) return suggestions.length - 1;
        if (next >= suggestions.length) return 0;
        return next;
      });
      return;
    }
    if (e.key === 'Enter') {
      if (dropdownOpen && highlightedIndex >= 0 && suggestions[highlightedIndex]) {
        e.preventDefault();
        pickFromSuggestions(suggestions[highlightedIndex]);
        return;
      }
      handleScanSubmit();
      return;
    }
    if (e.key === 'Escape') setIsSearchFocused(false);
  }

  function pickBatch(batch: Batch) {
    if (picker.item) {
      addLineForBatch(picker.item, batch, 1);
      noteOfferIfAny(picker.item);
    }
    setPicker({ open: false, item: null, batches: [] });
    inputRef.current?.focus();
  }

  // ZATCA's UBL PaymentMeans is a single code per invoice, but a split sale can have several
  // tender legs (cash/card/insurance) - report the largest leg as the representative method
  // rather than rejecting split payments outright. The full breakdown is still stored on the
  // invoice itself (SaleHeader.payments) and shown on the receipt.
  // ZATCA has no "loyalty points" payment means, so points legs never count toward this - only
  // the largest of the ZATCA-reportable legs (cash/card/insurance) is picked, defaulting to cash
  // for the edge case of a sale paid entirely in points.
  function primaryPaymentMethod(payments: Payment[]): 'cash' | 'card' | 'insurance' {
    const reportable = payments.filter((p): p is Payment & { method: 'cash' | 'card' | 'insurance' } => p.method !== 'points');
    if (reportable.length === 0) return 'cash';
    return reportable.reduce((largest, p) => (p.amount > largest.amount ? p : largest), reportable[0]).method;
  }

  async function completeSale(payments: Payment[]) {
    setIsSubmittingSale(true);
    const invoiceType = customer.vatNumber ? 'standard' : 'simplified';
    const invoiceNo = nextInvoiceNo(invoiceType);
    const date = new Date().toISOString();

    // Points are phone-linked, like the legacy patient ledger - an anonymous walk-in sale never
    // earns, and only ever redeems if the till happened to have a real customer selected.
    const pointsRedeemedSar = round2(payments.filter((p) => p.method === 'points').reduce((s, p) => s + p.amount, 0));
    const pointsRedeemed = pointsRedeemedSar > 0 ? sarToPoints(pointsRedeemedSar) : 0;
    const pointsEarned = customer.phone ? pointsEarnedFor(t.totalInclVat, customer.tier) : 0;

    const saleLines: SaleLine[] = lines.map((l) => ({
      id: l.id,
      itemId: l.itemId,
      itemNameAr: l.itemNameAr,
      itemNameEn: l.itemNameEn,
      batchId: l.batchId,
      batchNo: l.batchNo,
      expiryDate: l.expiryDate,
      qty: l.qty,
      unitPrice: l.unitPrice,
      vatRate: l.vatRate,
      offerLabel: l.offerLabel,
      manualDiscountType: l.manualDiscountType,
      manualDiscountValue: l.manualDiscountValue,
      discountAmount: l.discountAmount,
      netExclVat: l.netExclVat,
      vatAmount: l.vatAmount,
      totalInclVat: l.totalInclVat,
      returnedQty: 0,
      controlledStatus: itemById(l.itemId)?.controlledStatus,
    }));

    // Try the real ZATCA Phase 2 flow (server-side signing + clearance/reporting submission)
    // first. A POS cannot block a sale on that backend being reachable or onboarded, though - if
    // it fails for any reason, fall back to the Phase 1 client-side QR so the cashier can still
    // complete the sale, and flag the invoice for later resubmission (see types/sales.ts).
    let zatcaQrBase64: string;
    let zatcaStatus: ZatcaSubmissionStatus;
    try {
      const result = await zatcaApi.submitInvoice({
        invoiceNo,
        invoiceType,
        date,
        customerName: customer.nameEn || customer.nameAr,
        customerVatNumber: customer.vatNumber,
        paymentMethod: primaryPaymentMethod(payments),
        lines: lines.map((l) => ({
          id: l.id,
          itemNameEn: l.itemNameEn,
          qty: l.qty,
          unitPrice: l.unitPrice,
          vatRate: l.vatRate,
          discountAmount: l.discountAmount,
        })),
      });
      zatcaQrBase64 = result.qrBase64;
      zatcaStatus = result.status === 'cleared' ? 'phase2_cleared' : 'phase2_reported';
    } catch {
      zatcaQrBase64 = generateInvoiceQr({
        sellerName: settings.storeNameEn,
        vatRegistrationNo: settings.vatRegistrationNo,
        isoTimestamp: date,
        totalInclVat: t.totalInclVat,
        totalVatAmount: t.totalVatAmount,
      });
      zatcaStatus = 'phase1_fallback';
    }

    // Best-effort mirror into dotnet-pos for cashier commission/shift tracking - this sale is
    // already final (ZATCA/receipt/loyalty are all settled above), so a failure here (backend
    // down, network) must never undo or block it. It just means this sale earns no commission.
    let posSaleId: number | undefined;
    const posItemIdByLineId = new Map<string, number>();
    try {
      const posResult = await posApi.createSale({
        invoiceNo,
        customerName: customer.nameEn || customer.nameAr,
        payments: payments.map((p) => ({ method: POS_PAYMENT_METHOD[p.method], amount: p.amount })),
        items: lines.map((l) => ({
          barcode: itemById(l.itemId)?.barcode ?? l.itemId,
          name: l.itemNameEn,
          qty: l.qty,
          unitPrice: round2(l.netExclVat / l.qty),
          vatRate: l.vatRate,
          lineTotal: l.totalInclVat,
        })),
      });
      posSaleId = posResult.id;
      lines.forEach((l, i) => {
        const posItemId = posResult.items[i]?.id;
        if (posItemId != null) posItemIdByLineId.set(l.id, posItemId);
      });
    } catch (err) {
      console.warn('dotnet-pos sale mirror failed (no commission tracked for this sale):', err);
    }
    saleLines.forEach((l) => {
      l.posItemId = posItemIdByLineId.get(l.id);
    });

    const invoice: SaleHeader = {
      id: crypto.randomUUID(),
      invoiceNo,
      invoiceType,
      date,
      customerId: customer.id,
      customerNameAr: customer.nameAr,
      customerNameEn: customer.nameEn,
      lines: saleLines,
      subtotalExclVat: t.subtotalExclVat,
      totalDiscount: t.totalDiscount,
      totalVatAmount: t.totalVatAmount,
      totalInclVat: t.totalInclVat,
      payments,
      zatcaQrBase64,
      zatcaStatus,
      status: 'completed',
      cashierName: settings.cashierName,
      pointsEarned: pointsEarned || undefined,
      pointsRedeemed: pointsRedeemed || undefined,
      prescription: prescription ?? undefined,
      posSaleId,
    };

    lines.forEach((l) => decrementBatch(l.batchId, l.qty));
    if (pointsRedeemed > 0) redeemPoints(customer.id, pointsRedeemed);
    if (pointsEarned > 0) earnPoints(customer.id, pointsEarned);
    recordSale(invoice);
    clear();
    setPrescription(null);
    setIsSubmittingSale(false);
    setPaymentOpen(false);
    setReceipt(invoice);
  }

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
        <Box sx={{ position: 'relative', flex: 1 }}>
          <TextField
            inputRef={inputRef}
            autoFocus
            fullWidth
            label="Scan barcode or type item name / SKU, then Enter"
            value={scanValue}
            disabled={isScanning}
            onChange={(e) => {
              setScanValue(e.target.value);
              setHighlightedIndex(-1);
            }}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            onKeyDown={handleScanKeyDown}
            slotProps={{
              input: {
                endAdornment: isScanning ? (
                  <InputAdornment position="end">
                    <CircularProgress size={18} />
                  </InputAdornment>
                ) : undefined,
              },
            }}
          />
          {dropdownOpen && (
            <Paper
              elevation={4}
              sx={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, mt: 0.5, maxHeight: 320, overflow: 'auto' }}
            >
              <List dense disablePadding>
                {suggestions.map((item, i) => (
                  <ListItemButton
                    key={item.id}
                    selected={i === highlightedIndex}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickFromSuggestions(item)}
                  >
                    <ListItemText
                      primary={item.nameEn}
                      secondary={`${item.nameAr} · ${item.barcode}`}
                    />
                  </ListItemButton>
                ))}
              </List>
            </Paper>
          )}
        </Box>
        <Stack spacing={0.5} sx={{ alignItems: 'flex-start', minWidth: 220 }}>
          <Button
            variant="outlined"
            fullWidth
            aria-label="Select customer"
            sx={{ justifyContent: 'flex-start', textTransform: 'none', py: 1 }}
            onClick={() => setCustomerDialogOpen(true)}
          >
            <Stack sx={{ alignItems: 'flex-start' }}>
              <Typography variant="body2">
                {customer.nameEn} {customer.tier !== 'normal' ? `(${customer.tier})` : ''}
              </Typography>
              {customer.phone && (
                <Typography variant="caption" color="text.secondary">
                  {customer.phone} · {customerPointsBalance} pts (SAR {pointsToSar(customerPointsBalance).toFixed(2)})
                </Typography>
              )}
            </Stack>
          </Button>
        </Stack>
      </Stack>

      <CustomerLookupDialog
        open={customerDialogOpen}
        onClose={() => setCustomerDialogOpen(false)}
        onSelect={setCustomer}
      />

      <Paper variant="outlined" sx={{ flex: 1, overflow: 'auto' }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <TableCell>Item</TableCell>
              <TableCell>Batch / Expiry</TableCell>
              <TableCell align="right">Qty</TableCell>
              <TableCell align="right">Unit Price</TableCell>
              <TableCell align="right">Discount</TableCell>
              <TableCell align="right">VAT</TableCell>
              <TableCell align="right">Total</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.length === 0 && (
              <TableRow>
                <TableCell colSpan={8}>
                  <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                    Cart is empty — scan an item to begin a sale.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {lines.map((l) => (
              <TableRow key={l.id} hover>
                <TableCell>
                  <Typography variant="body2">{l.itemNameEn}</Typography>
                  {l.offerLabel && <Chip size="small" color="secondary" variant="outlined" label={l.offerLabel} sx={{ mt: 0.5 }} />}
                </TableCell>
                <TableCell>
                  <Typography variant="caption">
                    {l.batchNo} · {l.expiryDate}
                  </Typography>
                  {isNearExpiry(l.expiryDate) && <Chip size="small" color="warning" label="Near expiry" sx={{ ml: 0.5 }} />}
                </TableCell>
                <TableCell align="right">
                  <TextField
                    type="number"
                    size="small"
                    value={l.qty}
                    onChange={(e) => {
                      const requested = Number(e.target.value) || 1;
                      const { appliedQty } = updateQty(l.id, requested);
                      if (appliedQty < requested) {
                        const lineItem = itemById(l.itemId);
                        const isErpItem = lineItem?.id.startsWith('erp-');
                        notify(
                          `Only ${appliedQty} in stock for ${l.itemNameEn} (requested ${requested}).`,
                          'warning',
                          isErpItem && lineItem ? { label: 'Check other branches', onClick: () => setBranchStockItem(lineItem) } : undefined
                        );
                      }
                    }}
                    slotProps={{ htmlInput: { min: 1, max: l.qtyAvailable, style: { width: 50, textAlign: 'right' } } }}
                  />
                </TableCell>
                <TableCell align="right">{l.unitPrice.toFixed(2)}</TableCell>
                <TableCell align="right">
                  {/* A promotional offer and a cashier-entered manual discount stacking on the
                      same line lets the till under-charge well past what either discount alone
                      allows - so once a line is actively earning its offer, manual discount is
                      off the table for it rather than stacking on top. */}
                  <Tooltip title={l.offerLabel ? 'Manual discount is unavailable while this item has an active offer.' : ''}>
                    <span>
                      <Button
                        size="small"
                        color={l.manualDiscountValue ? 'secondary' : 'inherit'}
                        startIcon={<DiscountOutlinedIcon fontSize="small" />}
                        disabled={!!l.offerLabel}
                        onClick={(e) => setDiscountEditor({ anchorEl: e.currentTarget, lineId: l.id })}
                      >
                        {l.discountAmount > 0 ? `-${l.discountAmount.toFixed(2)}` : '—'}
                      </Button>
                    </span>
                  </Tooltip>
                </TableCell>
                <TableCell align="right">{l.vatAmount.toFixed(2)}</TableCell>
                <TableCell align="right">
                  <Typography sx={{ fontWeight: 600 }}>{l.totalInclVat.toFixed(2)}</Typography>
                </TableCell>
                <TableCell>
                  <IconButton size="small" onClick={() => removeLine(l.id)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={3} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Stack spacing={0.25} sx={{ minWidth: 220 }}>
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
              <Typography variant="body2" color="text.secondary">Subtotal</Typography>
              <Typography variant="body2">{t.subtotalExclVat.toFixed(2)}</Typography>
            </Stack>
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
              <Typography variant="body2" color="text.secondary">Discount</Typography>
              <Typography variant="body2">-{t.totalDiscount.toFixed(2)}</Typography>
            </Stack>
            {t.vatByRate.map((b) => (
              <Stack key={b.rate} direction="row" sx={{ justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">
                  VAT {b.rate > 0 ? `(${(b.rate * 100).toFixed(0)}%)` : '(zero-rated)'}
                </Typography>
                <Typography variant="body2">{b.vatAmount.toFixed(2)}</Typography>
              </Stack>
            ))}
          </Stack>
          <Stack spacing={1} sx={{ alignItems: 'flex-end' }}>
            <Typography variant="h4" sx={{ fontWeight: 700 }}>
              SAR {t.totalInclVat.toFixed(2)}
            </Typography>
            <Button
              variant="contained"
              size="large"
              disabled={lines.length === 0}
              onClick={() => {
                if (controlledLines.length > 0 && !prescription) setPrescriptionDialogOpen(true);
                else setPaymentOpen(true);
              }}
            >
              Checkout
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <BatchPickerDialog
        open={picker.open}
        item={picker.item}
        batches={picker.batches}
        onPick={pickBatch}
        onClose={() => setPicker({ open: false, item: null, batches: [] })}
      />
      <PaymentDialog
        open={paymentOpen}
        totalDue={t.totalInclVat}
        pointsBalance={customerPointsBalance}
        isSubmitting={isSubmittingSale}
        onCancel={() => setPaymentOpen(false)}
        onConfirm={completeSale}
      />
      <ReceiptView open={!!receipt} invoice={receipt} onClose={() => setReceipt(null)} />
      <OtherBranchStockDialog open={!!branchStockItem} item={branchStockItem} onClose={() => setBranchStockItem(null)} />
      <PrescriptionCaptureDialog
        open={prescriptionDialogOpen}
        lines={controlledLines}
        patientNationalId={customer.nationalId}
        onCancel={() => setPrescriptionDialogOpen(false)}
        onConfirm={(info) => {
          setPrescription(info);
          setPrescriptionDialogOpen(false);
          setPaymentOpen(true);
        }}
      />
      {discountEditor && (
        <LineDiscountPopover
          anchorEl={discountEditor.anchorEl}
          type={lines.find((l) => l.id === discountEditor.lineId)?.manualDiscountType}
          value={lines.find((l) => l.id === discountEditor.lineId)?.manualDiscountValue}
          onApply={(discount) => setLineDiscount(discountEditor.lineId, discount)}
          onClose={() => setDiscountEditor(null)}
        />
      )}

      <Snackbar
        key={toastKey}
        open={!!toast}
        autoHideDuration={4500}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? (
          <Alert
            severity={toast.severity}
            onClose={() => setToast(null)}
            sx={{ width: '100%' }}
            action={
              toast.action ? (
                <Button
                  variant="contained"
                  size="small"
                  onClick={() => {
                    toast.action!.onClick();
                    setToast(null);
                  }}
                  sx={{
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    '&:hover': { bgcolor: 'primary.dark' },
                  }}
                >
                  {toast.action.label}
                </Button>
              ) : undefined
            }
          >
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}
