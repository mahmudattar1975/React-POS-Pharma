import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, TextField, Table, TableHead, TableRow, TableCell, TableBody, IconButton, Typography,
  Button, Snackbar, Alert, Chip, Stack, Paper,
  CircularProgress, InputAdornment, List, ListItemButton, ListItemText, Tooltip, MenuItem, Select,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import DiscountOutlinedIcon from '@mui/icons-material/DiscountOutlined';
import MedicationOutlinedIcon from '@mui/icons-material/MedicationOutlined';
import LocalPharmacyOutlinedIcon from '@mui/icons-material/LocalPharmacyOutlined';
import type { Item, Batch, PackLevel } from '../../types/catalog';
import { useCartStore, type ScanResult } from '../../store/cartStore';
import { useCatalogStore } from '../../store/catalogStore';
import { useSalesStore } from '../../store/salesStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useCustomerStore } from '../../store/customerStore';
import { useCostCenterStore } from '../../store/costCenterStore';
import { resolveCenterForCategory } from '../../utils/costCenters';
import { generateInvoiceQr } from '../../utils/zatcaQr';
import {
  primaryPaymentMethod as primaryPaymentMethodFor,
  statusFromSubmission,
  zatcaPatchFromSubmission,
} from '../../utils/zatcaInvoice';
import * as zatcaApi from '../../api/zatcaApi';
import { isNearExpiry } from '../../utils/fefo';
import { itemCodes } from '../../utils/itemMaster';
import { activeOfferFor } from '../../utils/pricing';
import { formatUnitPrice, PACK_LEVEL_LABEL_PLURAL, PACK_LEVEL_UNIT_CODE, SELLABLE_PACK_LEVELS } from '../../utils/packUnits';
import { pointsEarnedFor, sarToPoints } from '../../utils/loyalty';
import { round2 } from '../../utils/vat';
import { formatMoney, formatQty } from '../../utils/format';
import type { SaleHeader, SaleLine, Payment, ZatcaSubmissionStatus, PrescriptionInfo } from '../../types/sales';
import type { WasfatyDispenseLineInput } from '../../types/wasfaty';
import { hasDosages } from '../../utils/dosages';
import { maskNationalId, unmappedWasfatyLines } from '../../utils/wasfaty';
import * as posApi from '../../api/posApi';
import * as wasfatyApi from '../../api/wasfatyApi';
import { usePendingSyncStore } from '../../store/pendingSyncStore';
import { POS_PAYMENT_METHOD } from '../../types/pos';
import BatchPickerDialog from './BatchPickerDialog';
import PaymentDialog from './PaymentDialog';
import ReceiptView from './ReceiptView';
import DosagePickerDialog from './DosagePickerDialog';
import DosagePrintView from './DosagePrintView';
import DirectionsCheckoutDialog, { type DosagePatch } from './DirectionsCheckoutDialog';
import LineDiscountPopover from './LineDiscountPopover';
import CustomerLookupDialog from './CustomerLookupDialog';
import OtherBranchStockDialog from './OtherBranchStockDialog';
import PrescriptionCaptureDialog from './PrescriptionCaptureDialog';
import WasfatyCaptureDialog from './WasfatyCaptureDialog';

export default function POSPage() {
  const navigate = useNavigate();
  const {
    lines, customer, wasfatySession, startWasfaty, endWasfaty, setCustomer, scan, pickItem,
    addLineForBatch, setLinePackLevel, setLineDosage, updateQty, setLineDiscount, removeLine,
    totals, clear,
  } = useCartStore();
  const { items, offers, decrementBatch, itemById } = useCatalogStore();
  const { nextInvoiceNo, recordSale, updateInvoiceDosages, patchInvoiceWasfaty } = useSalesStore();
  const settings = useSettingsStore((s) => s.settings);
  const { earnPoints, redeemPoints, pointsBalanceFor } = useCustomerStore();
  const customerPointsBalance = pointsBalanceFor(customer.id);
  // Phase B.1: the category -> center map decides each LINE's department. Both slices are read
  // directly (never rebuilt in the selector) - Zustand v5 returns a fresh array from the selector
  // on every store read, which is the infinite-render trap this codebase has hit before.
  const categoryMap = useCostCenterStore((s) => s.categoryMap);
  const costCenters = useCostCenterStore((s) => s.centers);

  const [scanValue, setScanValue] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // Same substring match as the Inventory & Expiry page's search (name AR/EN or ANY barcode) - lets
  // the cashier find an item by typing its name or one of its printed codes, not just the main
  // barcode, without turning the scan field into a full lookup UI. Capped short since it's a
  // dropdown under a single input.
  const suggestions = useMemo(() => {
    const q = scanValue.trim().toLowerCase();
    if (!q) return [];
    return items
      .filter(
        (i) =>
          i.nameEn.toLowerCase().includes(q) ||
          i.nameAr.includes(q) ||
          itemCodes(i).some((code) => code.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [items, scanValue]);
  const dropdownOpen = isSearchFocused && suggestions.length > 0;

  const [picker, setPicker] = useState<{ open: boolean; item: Item | null; batches: Batch[] }>({ open: false, item: null, batches: [] });
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [wasfatyDialogOpen, setWasfatyDialogOpen] = useState(false);
  const [prescriptionDialogOpen, setPrescriptionDialogOpen] = useState(false);
  const [prescription, setPrescription] = useState<PrescriptionInfo | null>(null);
  const [isSubmittingSale, setIsSubmittingSale] = useState(false);
  const [receipt, setReceipt] = useState<SaleHeader | null>(null);
  // Post-payment directions step (sale paid, receipt not yet shown). Kept separate from `receipt`
  // so the two dialogs never overlap.
  const [directionsSale, setDirectionsSale] = useState<SaleHeader | null>(null);
  // Kept separate from `receipt` on purpose: the two print surfaces must never be mounted at the
  // same time, so choosing the direction sheet closes the receipt dialog first.
  const [dosageInvoice, setDosageInvoice] = useState<SaleHeader | null>(null);
  // True only for the after-invoice chain: the sheet then prints itself once, no extra click.
  const [dosageAutoPrint, setDosageAutoPrint] = useState(false);
  const [dosageLineId, setDosageLineId] = useState<string | null>(null);
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
  // Option A split: covered lines are invoiced at the NUPCO-approved value and settled by the
  // `wasfaty` tender, so only the remainder is collected from the patient. The invoice total itself
  // stays the full NUPCO value - that is what NUPCO reimburses against.
  const coveredLines = useMemo(() => lines.filter((l) => l.wasfaty), [lines]);
  const coveredTotal = useMemo(
    () => round2(coveredLines.reduce((sum, line) => sum + line.totalInclVat, 0)),
    [coveredLines],
  );
  const patientDue = round2(t.totalInclVat - coveredTotal);
  const unmappedWasfaty = useMemo(
    () => unmappedWasfatyLines(lines),
    [lines],
  );
  // Derived from the line id (not a copied line object) so the picker always shows the live line.
  const dosageLine = dosageLineId ? lines.find((l) => l.id === dosageLineId) : undefined;
  const dosageItem = dosageLine ? itemById(dosageLine.itemId) ?? null : null;

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
  // 'other' legs count as reportable ZATCA payment means - the server maps them to UNCL4461's
  // "Instrument not defined" code, which is literally what an unknown tender is. Only points
  // redemption is excluded: ZATCA has no "loyalty points" payment means, so points legs never
  // count toward this - only the largest of the remaining legs is picked, defaulting to cash for
  // Tender to report to ZATCA - shared with the resubmission path (utils/zatcaInvoice.ts) so a retry
  // can never disagree with what the original report said.
  function primaryPaymentMethod(payments: Payment[]): 'cash' | 'card' | 'insurance' | 'other' {
    return primaryPaymentMethodFor(payments);
  }

  async function completeSale(patientPayments: Payment[]) {
    setIsSubmittingSale(true);
    const invoiceType = customer.vatNumber ? 'standard' : 'simplified';
    const invoiceNo = nextInvoiceNo(invoiceType);
    const date = new Date().toISOString();
    const activeSession = wasfatySession;
    // The coverage leg is added here, not typed by the cashier: the invoice is issued at the
    // NUPCO-approved value and settled 100% by Wasfaty on the covered lines. `patientPayments` is
    // exactly what PaymentDialog collected, which is the non-covered remainder.
    const coveredTotal = round2(
      lines.filter((l) => l.wasfaty).reduce((sum, l) => sum + l.totalInclVat, 0),
    );
    const payments: Payment[] =
      coveredTotal > 0
        ? [...patientPayments.filter((p) => p.method !== 'wasfaty'), { method: 'wasfaty', amount: coveredTotal }]
        : patientPayments;

    // Points are phone-linked, like the legacy patient ledger - an anonymous walk-in sale never
    // earns, and only ever redeems if the till happened to have a real customer selected. On a
    // Wasfaty sale, points accrue on the patient's own spend, not on the government-covered part.
    const pointsRedeemedSar = round2(patientPayments.filter((p) => p.method === 'points').reduce((s, p) => s + p.amount, 0));
    const pointsRedeemed = pointsRedeemedSar > 0 ? sarToPoints(pointsRedeemedSar) : 0;
    const pointsEarned = customer.phone ? pointsEarnedFor(patientDue, customer.tier) : 0;

    const saleLines: SaleLine[] = lines.map((l) => ({
      id: l.id,
      itemId: l.itemId,
      itemNameAr: l.itemNameAr,
      itemNameEn: l.itemNameEn,
      batchId: l.batchId,
      batchNo: l.batchNo,
      expiryDate: l.expiryDate,
      qty: l.qty,
      packLevel: l.packLevel,
      baseQty: l.baseQty,
      unit: l.unit,
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
      // The directions as chosen for this line - frozen on the sale, so a later library edit or a
      // reprint cannot silently change what this patient was told.
      dosage: l.dosage,
      // Department attribution for this line, resolved from the item's category (costcenter.md
      // §9.1). Unmapped categories fall back to the store's branch center, so the line is never
      // left blank by a stale map; the cashier still answers nothing (§7.4 zero-friction rule).
      costCenterId: resolveCenterForCategory(
        itemById(l.itemId)?.category,
        categoryMap,
        costCenters,
        date,
        settings.costCenterId,
      ).costCenterId,
      // Frozen coverage snapshot (Option A). `nupcoUnitPrice` is the VAT-exclusive price actually
      // invoiced; `claimAmount` is the VAT-inclusive line total NUPCO/supplier reimburses; the
      // patient share on a covered line is exactly 0.00. None of these are ever re-derived later.
      nupcoCode: l.wasfaty ? l.nupcoCode : undefined,
      nupcoUnitPrice: l.wasfaty ? l.unitPrice : undefined,
      patientShare: l.wasfaty ? 0 : undefined,
      claimAmount: l.wasfaty ? l.totalInclVat : undefined,
      wasfatyLineId: l.wasfaty ? l.id : undefined,
    }));

    // Try the real ZATCA Phase 2 flow (server-side signing + clearance/reporting submission)
    // first. A POS cannot block a sale on that backend being reachable or onboarded, though - if
    // it fails for any reason, fall back to the Phase 1 client-side QR so the cashier can still
    // complete the sale, and record WHY so the Sales invoices tab can tell an unsubmitted sale apart
    // from one ZATCA actually rejected (see types/sales.ts).
    let zatcaQrBase64: string;
    let zatcaStatus: ZatcaSubmissionStatus;
    let zatcaEvidence: Partial<SaleHeader> = {};
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
          unitCode: l.packLevel ? PACK_LEVEL_UNIT_CODE[l.packLevel] : undefined,
          unitPrice: l.unitPrice,
          vatRate: l.vatRate,
          discountAmount: l.discountAmount,
        })),
      });
      zatcaQrBase64 = result.qrBase64;
      zatcaStatus = statusFromSubmission(result, invoiceType);
      zatcaEvidence = zatcaPatchFromSubmission(result, invoiceType, new Date().toISOString());
    } catch (err) {
      zatcaQrBase64 = generateInvoiceQr({
        sellerName: settings.storeNameEn,
        vatRegistrationNo: settings.vatRegistrationNo,
        isoTimestamp: date,
        totalInclVat: t.totalInclVat,
        totalVatAmount: t.totalVatAmount,
      });
      zatcaStatus = 'pending_submission';
      zatcaEvidence = {
        zatcaFailureReason: err instanceof Error ? err.message : String(err),
      };
    }
    // Keep the Phase 1 QR unless the server returned a stamped one (zatcaEvidence carries it only
    // on success), so a failed attempt never erases the QR the receipt already printed.
    const zatcaQrFinal = zatcaEvidence.zatcaQrBase64 ?? zatcaQrBase64;

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
      // Buyer VAT number is part of the DOCUMENT on a standard invoice (ZATCA clears against it),
      // not just customer-master metadata - so it is snapshotted onto the sale like everything else
      // that must never change after the fact.
      customerVatNumber: customer.vatNumber || undefined,
      lines: saleLines,
      subtotalExclVat: t.subtotalExclVat,
      totalDiscount: t.totalDiscount,
      totalVatAmount: t.totalVatAmount,
      totalInclVat: t.totalInclVat,
      payments,
      // Phase 2 evidence (UUID, ICV, invoice hash, environment) from the submission attempt above;
      // the QR is the stamped one when ZATCA answered, otherwise the Phase 1 fallback.
      ...zatcaEvidence,
      zatcaQrBase64: zatcaQrFinal,
      zatcaStatus,
      status: 'completed',
      cashierName: settings.cashierName,
      // Branch tagging by default from the "current store" setting - the cashier never answers
      // a cost-center question (zero POS friction, costcenter.md §7.4); clicks land on the
      // branch automatically.
      costCenterId: settings.costCenterId,
      pointsEarned: pointsEarned || undefined,
      pointsRedeemed: pointsRedeemed || undefined,
      prescription: prescription ?? undefined,
      channel: activeSession ? 'wasfaty' : undefined,
      wasfaty: activeSession
        ? {
            ...activeSession,
            provider: 'manual',
            status: 'manual_recorded',
            pharmacistId: activeSession.pharmacistId ?? settings.cashierName,
            dispensedAt: date,
            claimStatus: 'pending',
            claimMonth: date.slice(0, 7),
            totalClaimAmount: coveredTotal,
            totalPatientShare: 0,
            // The sale is final locally. This only says the server mirror has not answered yet.
            syncState: 'queued',
          }
        : undefined,
      posSaleId,
    };

    lines.forEach((l) => decrementBatch(l.batchId, l.baseQty ?? l.qty));
    if (pointsRedeemed > 0) redeemPoints(customer.id, pointsRedeemed);
    if (pointsEarned > 0) earnPoints(customer.id, pointsEarned);
    recordSale(invoice);

    // Mirror the dispense to this app's provider-neutral Wasfaty API. The sale is already final:
    // this is best-effort and a failure is queued, never reversed (same rule as the sale backup).
    if (activeSession) {
      const dispenseLines: WasfatyDispenseLineInput[] = saleLines
        .filter((line) => line.nupcoCode !== undefined && line.claimAmount !== undefined)
        .map((line) => ({
          lineId: line.id,
          nupcoCode: line.nupcoCode!,
          itemId: line.itemId,
          itemNameEn: line.itemNameEn,
          itemNameAr: line.itemNameAr,
          batchNo: line.batchNo,
          expiryDate: line.expiryDate,
          qty: line.qty,
          unit: line.unit,
          nupcoUnitPrice: line.nupcoUnitPrice ?? line.unitPrice,
          patientShare: line.patientShare ?? 0,
          claimAmount: line.claimAmount ?? 0,
        }));
      const dispenseInput = {
        saleId: invoice.id,
        invoiceNo,
        session: activeSession,
        lines: dispenseLines,
        invoiceTotalInclVat: invoice.totalInclVat,
        claimTotal: coveredTotal,
        currency: settings.currency,
      };
      wasfatyApi.createWasfatyDispense(dispenseInput)
        .then((result) => {
          patchInvoiceWasfaty(invoice.id, {
            dispenseId: result.dispense.id,
            nupcoPrescriptionId: result.dispense.nupcoPrescriptionId,
            nupcoDispenseId: result.dispense.nupcoDispenseId,
            status: result.dispense.status,
            claimStatus: result.claim?.status,
            claimMonth: result.claim?.month,
            syncState: 'synced',
          });
        })
        .catch((err) => {
          console.warn('Wasfaty dispense mirror failed, queued for retry:', err);
          patchInvoiceWasfaty(invoice.id, { syncState: 'queued' });
          usePendingSyncStore.getState().enqueue({
            kind: 'wasfatyDispense',
            payload: { invoiceId: invoice.id, input: dispenseInput },
          });
        });
    }

    clear();
    setPrescription(null);
    setIsSubmittingSale(false);
    setPaymentOpen(false);
    // The money is settled, but directions are often prepared after payment in a real pharmacy.
    // When at least one sold item has suitable directions linked (or one was already chosen in the
    // cart), show the dedicated step before the receipt; otherwise go straight to the receipt.
    const wantsDirections =
      hasDosages(invoice.lines) ||
      invoice.lines.some((line) => (itemById(line.itemId)?.dosageIds?.length ?? 0) > 0);
    if (wantsDirections) setDirectionsSale(invoice);
    else setReceipt(invoice);
  }

  // Rebuilds the immediately-shown receipt from the same patches the store just applied, so the
  // receipt/print sheet in this session match the saved sale without a second store read.
  function applyDosagePatches(invoice: SaleHeader, patches: DosagePatch[]): SaleHeader {
    const dosageByLine = new Map(patches.map((patch) => [patch.lineId, patch.dosage]));
    return {
      ...invoice,
      lines: invoice.lines.map((line) =>
        dosageByLine.has(line.id) ? { ...line, dosage: dosageByLine.get(line.id) } : line,
      ),
    };
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
                      secondary={`${item.nameAr} · ${itemCodes(item).join(' / ')}`}
                    />
                  </ListItemButton>
                ))}
              </List>
            </Paper>
          )}
        </Box>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'stretch', justifyContent: 'flex-end', flexWrap: 'wrap' }}
        >
          {/* Customer and Wasfaty describe WHO the basket is for, so they sit beside the scan field
              as two equal-height controls. Keeping them one row high leaves the vertical space to
              the cart, where the cashier actually works. */}
          <Button
            variant="outlined"
            aria-label="Select customer"
            sx={{ justifyContent: 'flex-start', textTransform: 'none', minWidth: 200, height: 56, py: 0, px: 1.5 }}
            onClick={() => setCustomerDialogOpen(true)}
          >
            <Stack sx={{ alignItems: 'flex-start', minWidth: 0 }}>
              <Typography variant="body2" noWrap sx={{ fontWeight: 600, maxWidth: 180 }}>
                {customer.nameEn} {customer.tier !== 'normal' ? `(${customer.tier})` : ''}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 180 }}>
                {customer.phone
                  ? `${customer.phone} · ${customerPointsBalance} pts`
                  : 'Walk-in sale'}
              </Typography>
            </Stack>
          </Button>
          <Button
            variant={wasfatySession ? 'contained' : 'outlined'}
            color={wasfatySession ? 'primary' : 'inherit'}
            startIcon={<LocalPharmacyOutlinedIcon />}
            aria-label={wasfatySession ? 'Wasfaty dispense in progress' : 'Start Wasfaty dispense'}
            sx={{ justifyContent: 'flex-start', textTransform: 'none', minWidth: 200, height: 56, py: 0, px: 1.5 }}
            onClick={() => setWasfatyDialogOpen(true)}
          >
            <Stack sx={{ alignItems: 'flex-start', minWidth: 0 }}>
              <Typography variant="body2" noWrap sx={{ fontWeight: 600, maxWidth: 165 }}>
                {wasfatySession ? `Wasfaty · ${wasfatySession.prescriptionNo}` : 'Wasfaty / وصفتي'}
              </Typography>
              <Typography
                variant="caption"
                noWrap
                color={wasfatySession ? 'inherit' : 'text.secondary'}
                sx={{ maxWidth: 165, opacity: wasfatySession ? 0.85 : 1 }}
              >
                {wasfatySession
                  ? `Patient ${maskNationalId(wasfatySession.patientNationalId)} · ${coveredLines.length} covered`
                  : 'NUPCO covered sale'}
              </Typography>
            </Stack>
          </Button>
        </Stack>
      </Stack>

      {wasfatySession && (
        <Alert
          severity="info"
          icon={<LocalPharmacyOutlinedIcon fontSize="small" />}
          action={
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
              {unmappedWasfaty.length > 0 && (
                <Button
                  color="warning"
                  size="small"
                  variant="contained"
                  onClick={() => navigate('/wasfaty-mapping')}
                >
                  Map items
                </Button>
              )}
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  endWasfaty();
                  notify('Wasfaty dispense cancelled — the basket is now a normal retail sale.', 'warning');
                }}
                sx={{ textTransform: 'none' }}
              >
                Cancel Wasfaty
              </Button>
            </Stack>
          }
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Wasfaty dispense in progress · prescription {wasfatySession.prescriptionNo}
          </Typography>
          <Typography variant="caption" component="div">
            {coveredLines.length > 0
              ? `${coveredLines.length} line(s) covered by NUPCO · SAR ${formatMoney(coveredTotal)}; the patient pays SAR ${formatMoney(patientDue)}.`
              : 'No item on the counter is on the NUPCO approved list yet — covered items are invoiced at the approved price and paid by Wasfaty.'}
          </Typography>
          {unmappedWasfaty.length > 0 && (
            <Typography variant="caption" component="div" color="warning.dark" sx={{ mt: 0.5 }}>
              Blocked until mapped: {unmappedWasfaty.join(', ')}. Checkout will not charge the patient for these.
            </Typography>
          )}
        </Alert>
      )}

      <CustomerLookupDialog
        open={customerDialogOpen}
        onClose={() => setCustomerDialogOpen(false)}
        onSelect={setCustomer}
      />
      <WasfatyCaptureDialog
        open={wasfatyDialogOpen}
        initialPatientId={customer.nationalId}
        onClose={() => setWasfatyDialogOpen(false)}
        onStart={(session) => {
          startWasfaty({ ...session, pharmacistId: settings.cashierName });
          setWasfatyDialogOpen(false);
          notify(
            `Wasfaty dispense started for prescription ${session.prescriptionNo}. Covered items are settled by NUPCO.`,
            'success',
          );
        }}
      />

      <Paper variant="outlined" sx={{ flex: 1, overflow: 'auto' }}>
        <Table stickyHeader size="small" sx={{ '& th, & td': { px: 1.25 } }}>
          <TableHead>
            <TableRow sx={{ '& th': { whiteSpace: 'nowrap' } }}>
              <TableCell>Item</TableCell>
              <TableCell sx={{ minWidth: 160 }}>Directions</TableCell>
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
                <TableCell colSpan={9}>
                  <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                    Cart is empty — scan an item to begin a sale.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {lines.map((l) => (
              <TableRow key={l.id} hover sx={{ '& td': { py: 1.25 } }}>
                <TableCell sx={{ minWidth: 240 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{l.itemNameEn}</Typography>
                  {l.itemNameAr && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      dir="rtl"
                      sx={{ display: 'block', textAlign: 'left' }}
                    >
                      {l.itemNameAr}
                    </Typography>
                  )}
                  {(l.offerLabel || l.wasfaty) && (
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.75, flexWrap: 'wrap' }}>
                      {l.offerLabel && <Chip size="small" color="secondary" variant="outlined" label={l.offerLabel} />}
                      {l.wasfaty && (
                        <Chip
                          size="small"
                          color={l.nupcoCode ? 'primary' : 'warning'}
                          variant="outlined"
                          label={l.nupcoCode ? `Wasfaty · ${l.nupcoCode}` : 'Wasfaty · no NUPCO code'}
                        />
                      )}
                    </Stack>
                  )}
                </TableCell>
                <TableCell>
                  {l.dosage ? (
                    <Stack spacing={0.25} sx={{ maxWidth: 240 }}>
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        {l.dosage.textEn}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        dir="rtl"
                        sx={{ display: 'block', textAlign: 'left' }}
                      >
                        {l.dosage.textAr}
                      </Typography>
                      <Button
                        size="small"
                        onClick={() => setDosageLineId(l.id)}
                        sx={{ alignSelf: 'flex-start', minWidth: 0, px: 0.5 }}
                      >
                        Change
                      </Button>
                    </Stack>
                  ) : (
                    <Tooltip
                      title={
                        (itemById(l.itemId)?.dosageIds?.length ?? 0) === 0
                          ? 'No dosage instructions are linked to this item.'
                          : 'Optional — choose the patient directions for this line.'
                      }
                    >
                      <span>
                        <Button
                          size="small"
                          startIcon={<MedicationOutlinedIcon fontSize="small" />}
                          disabled={(itemById(l.itemId)?.dosageIds?.length ?? 0) === 0}
                          onClick={() => setDosageLineId(l.id)}
                          sx={{ whiteSpace: 'nowrap' }}
                        >
                          Directions
                        </Button>
                      </span>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  <Typography variant="caption">
                    {l.batchNo} · {l.expiryDate}
                  </Typography>
                  {isNearExpiry(l.expiryDate) && <Chip size="small" color="warning" label="Near expiry" sx={{ ml: 0.5 }} />}
                </TableCell>
                <TableCell align="right">
                  {/* Packed items: the cashier can sell a box, a strip or loose tablets from the
                      same line. Switching unit keeps the physical quantity and re-derives the
                      price from the box price (see cartStore.setLinePackLevel). */}
                  {itemById(l.itemId)?.pack && (
                    <Select
                      size="small"
                      variant="standard"
                      value={l.packLevel ?? 'box'}
                      onChange={(e) => setLinePackLevel(l.id, e.target.value as PackLevel)}
                      aria-label={`Selling unit for ${l.itemNameEn}`}
                      inputProps={{ 'aria-label': `Selling unit for ${l.itemNameEn}` }}
                      sx={{ fontSize: 12, display: 'block', ml: 'auto', mb: 0.25, minWidth: 72 }}
                    >
                      {SELLABLE_PACK_LEVELS.map((level) => (
                        <MenuItem key={level} value={level} sx={{ fontSize: 13 }}>
                          {PACK_LEVEL_LABEL_PLURAL[level]}
                        </MenuItem>
                      ))}
                    </Select>
                  )}
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
                        const levelLabel = l.packLevel ? PACK_LEVEL_LABEL_PLURAL[l.packLevel] : 'units';
                        notify(
                          `Only ${formatQty(appliedQty)} ${levelLabel.toLowerCase()} in stock for ${l.itemNameEn} (requested ${formatQty(requested)}).`,
                          'warning',
                          isErpItem && lineItem ? { label: 'Check other branches', onClick: () => setBranchStockItem(lineItem) } : undefined
                        );
                      }
                    }}
                    slotProps={{ htmlInput: { min: 1, max: l.qtyAvailable, style: { width: 50, textAlign: 'right' } } }}
                  />
                  {l.packLevel && l.packLevel !== 'tablet' && l.baseQty > 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      = {formatQty(l.baseQty)} tablets
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="right">{formatUnitPrice(l.unitPrice)}</TableCell>
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
                        aria-label={`Line discount for ${l.itemNameEn}`}
                        onClick={(e) => setDiscountEditor({ anchorEl: e.currentTarget, lineId: l.id })}
                      >
                        {l.discountAmount > 0 ? `-${formatMoney(l.discountAmount)}` : '—'}
                      </Button>
                    </span>
                  </Tooltip>
                </TableCell>
                <TableCell align="right">{formatMoney(l.vatAmount)}</TableCell>
                <TableCell align="right">
                  <Typography sx={{ fontWeight: 600 }}>{formatMoney(l.totalInclVat)}</Typography>
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
              <Typography variant="body2">{formatMoney(t.subtotalExclVat)}</Typography>
            </Stack>
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
              <Typography variant="body2" color="text.secondary">Discount</Typography>
              <Typography variant="body2">-{formatMoney(t.totalDiscount)}</Typography>
            </Stack>
            {t.vatByRate.map((b) => (
              <Stack key={b.rate} direction="row" sx={{ justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">
                  VAT {b.rate > 0 ? `(${(b.rate * 100).toFixed(0)}%)` : '(zero-rated)'}
                </Typography>
                <Typography variant="body2">{formatMoney(b.vatAmount)}</Typography>
              </Stack>
            ))}
            {wasfatySession && coveredTotal > 0 && (
              <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                <Typography variant="body2" color="primary">
                  Wasfaty coverage
                </Typography>
                <Typography variant="body2" color="primary">{formatMoney(coveredTotal)}</Typography>
              </Stack>
            )}
          </Stack>
          <Stack spacing={1} sx={{ alignItems: 'flex-end' }}>
            <Typography variant="h4" sx={{ fontWeight: 700 }}>
              SAR {formatMoney(t.totalInclVat)}
            </Typography>
            {wasfatySession && (
              <Typography variant="body2" color="text.secondary">
                Patient pays SAR {formatMoney(patientDue)}
              </Typography>
            )}
            <Button
              variant="contained"
              size="large"
              disabled={lines.length === 0}
              onClick={() => {
                // A covered line with no NUPCO code must never be quietly charged to the patient:
                // the cashier is sent to the mapping screen instead of being allowed to checkout.
                if (unmappedWasfaty.length > 0) {
                  notify(
                    `Map these items before dispensing: ${unmappedWasfaty.join(', ')}.`,
                    'warning',
                    { label: 'Map items', onClick: () => navigate('/wasfaty-mapping') },
                  );
                  return;
                }
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
        totalDue={wasfatySession ? patientDue : t.totalInclVat}
        pointsBalance={customerPointsBalance}
        wasfaty={
          wasfatySession
            ? { session: wasfatySession, coveredAmount: coveredTotal, invoiceTotal: t.totalInclVat }
            : null
        }
        isSubmitting={isSubmittingSale}
        onCancel={() => setPaymentOpen(false)}
        onConfirm={completeSale}
      />
      <DosagePickerDialog
        open={!!dosageLineId}
        item={dosageItem}
        selectedCode={dosageLine?.dosage?.code}
        onPick={(dosage) => {
          if (dosageLineId) setLineDosage(dosageLineId, dosage);
          setDosageLineId(null);
        }}
        onClose={() => setDosageLineId(null)}
      />
      <DirectionsCheckoutDialog
        key={directionsSale?.id ?? 'directions'}
        open={!!directionsSale}
        invoice={directionsSale}
        onConfirm={(patches) => {
          if (!directionsSale) return;
          updateInvoiceDosages(directionsSale.id, patches);
          const updated = applyDosagePatches(directionsSale, patches);
          setDirectionsSale(null);
          setReceipt(updated);
        }}
        onSkip={() => {
          const current = directionsSale;
          setDirectionsSale(null);
          if (current) setReceipt(current);
        }}
      />
      <ReceiptView
        open={!!receipt}
        invoice={receipt}
        onOpenDosages={(autoPrint) => {
          // Close the receipt FIRST: the direction label is its own print job, and two visible
          // print areas would otherwise be sent to the printer together.
          const current = receipt;
          if (!current) return;
          setReceipt(null);
          setDosageInvoice(current);
          setDosageAutoPrint(autoPrint);
        }}
        onClose={() => setReceipt(null)}
      />
      <DosagePrintView
        open={!!dosageInvoice}
        invoice={dosageInvoice}
        autoPrint={dosageAutoPrint}
        onClose={() => {
          setDosageInvoice(null);
          setDosageAutoPrint(false);
        }}
      />
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
