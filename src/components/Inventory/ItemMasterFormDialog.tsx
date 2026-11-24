// Create/edit form for the Item Master page. Field order follows the legacy PowerBuilder window
// `w_scrn_stock_data` (phstock.pbl) closely enough that a user migrating from it can find the same
// blocks: identification (item no / barcode / GTIN / registration / customs / scientific name),
// names, classification (category / unit / location / carton / manufacturer / vendor), pricing and
// tax, then stock limits and status. The stock figures at the bottom are read-only and always
// derived from batches/movements - the legacy screen stored them on the item row, which is exactly
// the drift this app avoids.
//
// Presentation: each block is a titled card so a long master-data form stays scannable, the header
// and footer are pinned (only the body scrolls), and the pack ladder shows the derived strip/tablet
// prices as tiles rather than as a sentence - the owner can see what the POS will charge before
// saving. Labels and field ids are unchanged from the flat version so existing habits and any UI
// automation keep working.
import { useMemo, useState, type ReactNode } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl,
  FormHelperText, IconButton, InputAdornment, InputLabel, MenuItem, Paper, Select, Stack, Switch,
  TextField, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import CloseIcon from '@mui/icons-material/Close';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import QrCode2RoundedIcon from '@mui/icons-material/QrCode2Rounded';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import CategoryOutlinedIcon from '@mui/icons-material/CategoryOutlined';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import SellOutlinedIcon from '@mui/icons-material/SellOutlined';
import WarehouseOutlinedIcon from '@mui/icons-material/WarehouseOutlined';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import MedicationOutlinedIcon from '@mui/icons-material/MedicationOutlined';
import type { Batch, Item } from '../../types/catalog';
import type { Vendor } from '../../types/purchasing';
import type { Manufacturer } from '../../types/manufacturer';
import type { ReceivingEvent } from '../../store/catalogStore';
import {
  EMPTY_ITEM_FORM, ITEM_VAT_RATES, codeConflictMessage, formPack, formToItemInput, isValidBarcode,
  itemMovementTotals, itemNumberOf, itemToForm, validateItemForm, type ItemMasterFormValues,
} from '../../utils/itemMaster';
import {
  describePack, formatPackBreakdown, formatUnitPrice, priceForLevel, tabletsPerUnit, PACK_LEVELS,
  PACK_LEVEL_LABEL_PLURAL,
} from '../../utils/packUnits';
import { CONTROLLED_STATUS_LABEL, CONTROLLED_STATUS_OPTIONS } from '../../utils/controlledSubstances';
import { formatMoney, formatQty } from '../../utils/format';
import DosageLinkEditor from './DosageLinkEditor';

interface Props {
  open: boolean;
  item: Item | null; // null = creating a new item
  items: Item[];
  vendors: Vendor[];
  manufacturers: Manufacturer[];
  batches: Batch[];
  receivingLog: ReceivingEvent[];
  saleLines: { itemId: string; qty: number; returnedQty: number }[];
  onSave: (input: Omit<Item, 'id' | 'itemNo'>, stockFactor?: number) => void;
  onClose: () => void;
  error?: string | null;
}

// Two reusable field grids: most sections read best at three short columns on a wide dialog,
// while the identity/name rows are naturally pairs.
const FIELD_GRID = {
  display: 'grid',
  gap: 2,
  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' },
};
const PAIR_GRID = {
  display: 'grid',
  gap: 2,
  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
};

export default function ItemMasterFormDialog({
  open, item, items, vendors, manufacturers, batches, receivingLog, saleLines, onSave, onClose, error,
}: Props) {
  const [values, setValues] = useState<ItemMasterFormValues>(() => (item ? itemToForm(item) : EMPTY_ITEM_FORM));
  const [submitted, setSubmitted] = useState(false);
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  const errors = useMemo(
    () => validateItemForm(values, items, item?.id),
    [values, items, item?.id]
  );
  const hasErrors = Object.keys(errors).length > 0;
  const errorCount = Object.keys(errors).length;

  // Live price ladder for the pack block: the owner types the box price once and sees the strip /
  // tablet prices the POS will charge (exact division, no per-level rounding).
  const packPreview = formPack(values);
  const boxPrice = Number(values.basePrice) || 0;
  const stripPrice = packPreview ? priceForLevel(boxPrice, packPreview, 'strip') : 0;
  const tabletPrice = packPreview ? priceForLevel(boxPrice, packPreview, 'tablet') : 0;

  function patch<K extends keyof ItemMasterFormValues>(key: K, value: ItemMasterFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  // Errors appear only after the first save attempt, so a fresh blank form is not covered in red
  // before anything has been entered. Save stays clickable so the message can point at the fields.
  function errorFor(key: keyof ItemMasterFormValues): string | undefined {
    return submitted ? errors[key] : undefined;
  }

  function save() {
    setSubmitted(true);
    if (hasErrors) {
      // The form is taller than the viewport, so the first problem could be off-screen after the
      // owner clicks Save at the bottom. Once the error classes are painted, bring that field back
      // into view and focus it.
      requestAnimationFrame(() => {
        const field = document.querySelector<HTMLElement>(
          '.MuiDialog-root .Mui-error input, .MuiDialog-root .Mui-error textarea, .MuiDialog-root .Mui-error .MuiSelect-select'
        );
        field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        field?.focus({ preventScroll: true });
      });
      return;
    }
    // `stockFactor` is non-undefined only when an unpacked item is being converted to a packed one
    // and the owner picked the unit its current shelf is counted in; the page applies it after the
    // item row has been updated (see ItemMasterPage.save).
    onSave(formToItemInput(values), stockFactor > 1 ? stockFactor : undefined);
  }

  // The list is the single source of truth in the UI; row 0 is the canonical `barcode`, the rest
  // live in `barcodes`. Keeping the write in one place means adding/removing rows can never leave
  // the primary code stale.
  function updateBarcodeRow(index: number, code: string) {
    setValues((v) => {
      const rows = [v.barcode, ...v.barcodes];
      rows[index] = code;
      const [first = '', ...rest] = rows;
      return { ...v, barcode: first, barcodes: rest };
    });
  }

  function addBarcodeRow() {
    setValues((v) => ({ ...v, barcodes: [...v.barcodes, ''] }));
  }

  function removeBarcodeRow(index: number) {
    setValues((v) => ({ ...v, barcodes: v.barcodes.filter((_, i) => i !== index - 1) }));
  }

  // Barcodes are checked WHILE they are typed, not only on Save: the moment a code already printed
  // on another item is entered, that row turns red and names its owner. Two codes can never point
  // at the same product, and one item cannot repeat a code in its own list either.
  const barcodeRows = [values.barcode, ...values.barcodes];
  const codeCount = barcodeRows.filter((code) => code.trim() !== '').length;
  function barcodeRowIssue(index: number): string | undefined {
    const code = barcodeRows[index]?.trim() ?? '';
    if (!code) return undefined;
    const conflict = codeConflictMessage(items, code, item?.id);
    if (conflict) return conflict;
    const repeats = barcodeRows.filter((row) => row.trim().toLowerCase() === code.toLowerCase()).length;
    return repeats > 1 ? 'This code is already listed above for this item.' : undefined;
  }

  const totals = item ? itemMovementTotals(item, batches, receivingLog, saleLines) : null;
  const vendorMissing = !!values.vendorNo && !vendors.some((v) => v.vendorNo === values.vendorNo);
  const manufacturerMissing =
    !!values.manufacturerNo && !manufacturers.some((m) => String(m.companyNo) === values.manufacturerNo);

  // Giving a pack ladder to an item that already has shelf stock: that stock was counted in the
  // item's old unit, while a packed item is counted in tablets. The owner confirms the old unit here
  // so the batches can be converted (qty x factor, prices / factor) instead of being silently read
  // as tablets - e.g. 138 strips must become 2,760 tablets, not 138 tablets.
  const onHandBefore = totals?.onHandQty ?? 0;
  const canConvertStock = !!item && !item.pack && !!packPreview && onHandBefore > 0;
  const stockFactor =
    canConvertStock && packPreview && values.stockUnit ? tabletsPerUnit(packPreview, values.stockUnit) : 1;
  const convertedQty = Math.round(onHandBefore * stockFactor);
  // Pack-aware limit wording is only honest once the item already counts stock in tablets. During
  // the one-off conversion the numbers on screen are still in the OLD unit, so the plain wording is
  // kept and the conversion warning explains that reorder/max will read as tablets after saving.
  const showPackLimits = !!packPreview && !canConvertStock;
  const movementUnit = showPackLimits ? 'tablets' : 'units';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      fullScreen={fullScreen}
      slotProps={{ paper: { sx: { maxHeight: fullScreen ? '100%' : '92vh' } } }}
    >
      <DialogTitle
        component="div"
        sx={{
          position: 'relative',
          pr: 7,
          py: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: '#f8fafc',
        }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box
            sx={(t) => ({
              width: 42,
              height: 42,
              flexShrink: 0,
              borderRadius: 2,
              display: 'grid',
              placeItems: 'center',
              bgcolor: alpha(t.palette.primary.main, 0.1),
              color: 'primary.main',
            })}
          >
            <WarehouseOutlinedIcon />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="h6" noWrap sx={{ lineHeight: 1.2 }}>
              {item ? 'Edit item' : 'New item'}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
              {item
                ? `${item.nameEn} · ${itemNumberOf(item) ?? item.id} · ${codeCount} code${codeCount === 1 ? '' : 's'}`
                : 'Item master · item number is assigned on save'}
            </Typography>
          </Box>
          {item ? (
            <Chip
              size="small"
              label={values.isActive ? 'Active' : 'Discontinued'}
              color={values.isActive ? 'success' : 'default'}
              variant={values.isActive ? 'outlined' : 'filled'}
              sx={{ flexShrink: 0 }}
            />
          ) : (
            <Chip size="small" label="New" variant="outlined" sx={{ flexShrink: 0 }} />
          )}
        </Stack>
        <IconButton
          aria-label="Close"
          onClick={onClose}
          size="small"
          sx={{ position: 'absolute', right: 12, top: 12 }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ bgcolor: 'background.default', px: { xs: 2, sm: 3 }, py: 2.5 }}>
        <Stack spacing={2}>
          {error && <Alert severity="error" onClose={onClose}>{error}</Alert>}

          <Section
            icon={<QrCode2RoundedIcon />}
            title="Identification"
            caption="Every code this pack prints — scanning any of them finds the item"
          >
            <Stack spacing={1.25}>
              {barcodeRows.map((code, index) => {
                const issue = barcodeRowIssue(index);
                const formError = errorFor(index === 0 ? 'barcode' : 'barcodes');
                const helper =
                  issue ??
                  formError ??
                  (index === 0
                    ? code.trim() === ''
                      ? 'Main scannable code — usually the box barcode'
                      : isValidBarcode(code)
                        ? 'Available — no other item uses this code.'
                        : 'Use 4-32 letters, digits, dots, dashes or underscores.'
                    : undefined);
                return (
                  <TextField
                    key={index}
                    label={index === 0 ? 'Barcode / GTIN 1 (main)' : `Barcode / GTIN ${index + 1}`}
                    value={code}
                    onChange={(e) => updateBarcodeRow(index, e.target.value)}
                    error={!!issue || !!formError}
                    helperText={helper}
                    size="small"
                    fullWidth
                    autoFocus={index === 0}
                    required={index === 0}
                    slotProps={{
                      input: {
                        endAdornment: (
                          <InputAdornment position="end">
                            {index === 0 ? (
                              <Chip size="small" label="Main" variant="outlined" sx={{ height: 22, fontSize: 11 }} />
                            ) : (
                              <IconButton
                                size="small"
                                edge="end"
                                onClick={() => removeBarcodeRow(index)}
                                title="Remove barcode"
                                aria-label={`Remove barcode ${index + 1}`}
                              >
                                <DeleteOutlineIcon fontSize="small" />
                              </IconButton>
                            )}
                          </InputAdornment>
                        ),
                      },
                    }}
                  />
                );
              })}
              <Box>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={addBarcodeRow}
                  sx={{
                    borderStyle: 'dashed',
                    borderColor: 'divider',
                    color: 'text.secondary',
                    '&:hover': { borderColor: 'primary.main', color: 'primary.main' },
                  }}
                >
                  Add another barcode / GTIN
                </Button>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                  Barcode and GTIN are the same key here, so one item can carry as many codes as its
                  pack prints — box, strip, carton or old packaging.
                </Typography>
              </Box>
            </Stack>

            <Box sx={{ ...PAIR_GRID, mt: 2 }}>
              <TextField
                label="Item No"
                value={item ? (itemNumberOf(item) ?? '—') : 'Assigned on save'}
                size="small"
                disabled
                helperText={item ? 'System number — not editable' : 'Created automatically when you save'}
                fullWidth
              />
              <TextField
                label="Registration No"
                value={values.registrationNo}
                onChange={(e) => patch('registrationNo', e.target.value)}
                error={!!errorFor('registrationNo')}
                helperText={errorFor('registrationNo') ?? 'SFDA / drug registration number'}
                size="small"
                fullWidth
              />
              <TextField
                label="Customs No"
                value={values.customsNo}
                onChange={(e) => patch('customsNo', e.target.value)}
                error={!!errorFor('customsNo')}
                helperText={errorFor('customsNo') ?? 'Customs tariff number'}
                size="small"
                fullWidth
              />
              <TextField
                label="Scientific Name"
                value={values.scientificName}
                onChange={(e) => patch('scientificName', e.target.value)}
                error={!!errorFor('scientificName')}
                helperText={errorFor('scientificName') ?? 'Active ingredient'}
                size="small"
                fullWidth
              />
            </Box>
          </Section>

          <Section
            icon={<BadgeOutlinedIcon />}
            title="Names"
            caption="Shown on receipts, the POS search and every printed document"
          >
            <Box sx={PAIR_GRID}>
              <TextField
                label="Name (English)"
                value={values.nameEn}
                onChange={(e) => patch('nameEn', e.target.value)}
                error={!!errorFor('nameEn')}
                helperText={errorFor('nameEn')}
                size="small"
                fullWidth
                required
              />
              <TextField
                label="Name (Arabic - عربي)"
                value={values.nameAr}
                onChange={(e) => patch('nameAr', e.target.value)}
                size="small"
                helperText="Optional, but shown on receipts and the POS search"
                fullWidth
                slotProps={{ htmlInput: { dir: 'rtl', style: { textAlign: 'right' } } }}
              />
            </Box>
          </Section>

          <Section
            icon={<CategoryOutlinedIcon />}
            title="Classification & ordering"
            caption="How the item is grouped, stored and sourced"
          >
            <Box sx={FIELD_GRID}>
              <TextField
                label="Category"
                value={values.category}
                onChange={(e) => patch('category', e.target.value)}
                size="small"
                helperText="e.g. Analgesics, Antibiotics"
                fullWidth
              />
              <TextField
                label="Unit"
                value={values.unit}
                onChange={(e) => patch('unit', e.target.value)}
                size="small"
                helperText="e.g. Box, Strip, Bottle"
                fullWidth
              />
              <TextField
                label="Carton Qty"
                type="number"
                value={values.cartonQty}
                onChange={(e) => patch('cartonQty', e.target.value)}
                error={!!errorFor('cartonQty')}
                helperText={errorFor('cartonQty') ?? 'Units per carton'}
                size="small"
                slotProps={{ htmlInput: { min: 1, step: '1' } }}
                fullWidth
              />
              <FormControl fullWidth size="small">
                <InputLabel id="item-manufacturer-label">Manufacturer / company</InputLabel>
                <Select
                  labelId="item-manufacturer-label"
                  label="Manufacturer / company"
                  value={values.manufacturerNo}
                  onChange={(e) => patch('manufacturerNo', e.target.value)}
                >
                  <MenuItem value="">
                    <em>None</em>
                  </MenuItem>
                  {manufacturerMissing && (
                    <MenuItem value={values.manufacturerNo}>
                      {values.manufacturerNo} (not in company master)
                    </MenuItem>
                  )}
                  {[...manufacturers]
                    .sort((a, b) => Number(a.companyNo) - Number(b.companyNo))
                    .map((m) => (
                      <MenuItem key={m.id} value={String(m.companyNo)}>
                        {m.companyNo} — {m.nameEn}
                        {m.isActive === false ? ' (inactive)' : ''}
                      </MenuItem>
                    ))}
                </Select>
                <FormHelperText error={!!errorFor('manufacturerNo')}>
                  {errorFor('manufacturerNo') ??
                    (manufacturerMissing
                      ? 'This number is not in the company master.'
                      : 'Picked from Companies (Manufacturers) — رقم الشركة')}
                </FormHelperText>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel id="item-vendor-label">Preferred vendor</InputLabel>
                <Select
                  labelId="item-vendor-label"
                  label="Preferred vendor"
                  value={values.vendorNo}
                  onChange={(e) => patch('vendorNo', e.target.value)}
                >
                  <MenuItem value="">
                    <em>None</em>
                  </MenuItem>
                  {vendorMissing && (
                    <MenuItem value={values.vendorNo}>{values.vendorNo} (not in vendor master)</MenuItem>
                  )}
                  {vendors.map((v) => (
                    <MenuItem key={v.id} value={v.vendorNo}>
                      {v.vendorNo} — {v.nameEn}
                      {v.isActive === false ? ' (inactive)' : ''}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                label="Location"
                value={values.location}
                onChange={(e) => patch('location', e.target.value)}
                size="small"
                helperText="Shelf / store location"
                fullWidth
              />
            </Box>
          </Section>

          <Section
            icon={<LayersOutlinedIcon />}
            title="Pack ladder (optional)"
            caption="Leave blank for a product sold as one unit — fill it and stock is counted in tablets"
            action={
              packPreview ? (
                <Chip size="small" color="primary" variant="outlined" label="Multi-level" />
              ) : undefined
            }
          >
            <Box sx={FIELD_GRID}>
              <TextField
                label="Boxes per carton (optional)"
                type="number"
                value={values.packCarton}
                onChange={(e) => patch('packCarton', e.target.value)}
                error={!!errorFor('packCarton')}
                helperText={errorFor('packCarton') ?? 'Blank = no carton level'}
                size="small"
                slotProps={{ htmlInput: { min: 1, step: '1' } }}
                fullWidth
              />
              <TextField
                label="Strips per box"
                type="number"
                value={values.packBox}
                onChange={(e) => patch('packBox', e.target.value)}
                error={!!errorFor('packBox')}
                helperText={errorFor('packBox') ?? 'e.g. 3'}
                size="small"
                slotProps={{ htmlInput: { min: 1, step: '1' } }}
                fullWidth
              />
              <TextField
                label="Tablets per strip"
                type="number"
                value={values.packStrip}
                onChange={(e) => patch('packStrip', e.target.value)}
                error={!!errorFor('packStrip')}
                helperText={errorFor('packStrip') ?? 'e.g. 4'}
                size="small"
                slotProps={{ htmlInput: { min: 1, step: '1' } }}
                fullWidth
              />
            </Box>

            {packPreview && (
              <Box
                sx={(t) => ({
                  mt: 2,
                  p: 1.5,
                  borderRadius: 2,
                  border: '1px dashed',
                  borderColor: 'divider',
                  bgcolor: alpha(t.palette.primary.main, 0.03),
                })}
              >
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={0.5}
                  sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
                >
                  <Typography variant="caption" color="text.secondary">
                    {describePack(packPreview)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Prices VAT-exclusive, split exactly from the box price
                  </Typography>
                </Stack>
                <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', mt: 1 }}>
                  <LadderTile label="Box" price={boxPrice} hint="base price" highlight />
                  <LadderTile label="Strip" price={stripPrice} hint={`${packPreview.boxSize} per box`} />
                  <LadderTile label="Tablet" price={tabletPrice} hint={`${packPreview.stripSize} per strip`} />
                </Box>
              </Box>
            )}

            {canConvertStock && (
              <Alert severity="warning" icon={false} sx={{ mt: 2 }}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1.5}
                  sx={{ alignItems: { sm: 'center' } }}
                >
                  <FormControl size="small" sx={{ minWidth: 210 }}>
                    <InputLabel id="item-stock-unit-label">Current stock is counted in</InputLabel>
                    <Select
                      labelId="item-stock-unit-label"
                      label="Current stock is counted in"
                      value={values.stockUnit}
                      onChange={(e) => patch('stockUnit', e.target.value as ItemMasterFormValues['stockUnit'])}
                    >
                      <MenuItem value="">
                        <em>Don&apos;t convert</em>
                      </MenuItem>
                      {PACK_LEVELS.map((level) => (
                        <MenuItem key={level} value={level}>
                          {PACK_LEVEL_LABEL_PLURAL[level]}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Typography variant="caption">
                    {values.stockUnit === '' ? (
                      <>
                        {onHandBefore} on-hand unit{onHandBefore === 1 ? '' : 's'} are currently counted in
                        the old unit. Pick it here or they will simply be read as tablets.
                      </>
                    ) : stockFactor <= 1 ? (
                      <>On hand is already {onHandBefore} tablets — nothing to convert.</>
                    ) : (
                      <>
                        <strong>
                          {onHandBefore} {PACK_LEVEL_LABEL_PLURAL[values.stockUnit].toLowerCase()}
                        </strong>{' '}
                        × {stockFactor} = <strong>{convertedQty.toLocaleString()} tablets</strong> on save.
                        Batch cost is divided by {stockFactor}, so the stock value does not change.
                        Reorder / max levels are <strong>not</strong> rescaled — they will read as tablets.
                      </>
                    )}
                  </Typography>
                </Stack>
              </Alert>
            )}
          </Section>

          <Section
            icon={<SellOutlinedIcon />}
            title="Pricing & tax"
            caption="The price is VAT-exclusive; with a pack ladder it is the price of one box"
          >
            <Box sx={FIELD_GRID}>
              <TextField
                label={packPreview ? 'Box Sale Price' : 'Sale Price'}
                type="number"
                value={values.basePrice}
                onChange={(e) => patch('basePrice', e.target.value)}
                error={!!errorFor('basePrice')}
                helperText={
                  errorFor('basePrice') ??
                  (packPreview ? 'VAT-exclusive price per box' : 'VAT-exclusive price per unit')
                }
                size="small"
                required
                slotProps={{
                  htmlInput: { min: 0, step: 'any' },
                  input: { endAdornment: <InputAdornment position="end">SAR</InputAdornment> },
                }}
                fullWidth
              />
              <FormControl fullWidth size="small">
                <InputLabel id="item-vat-label">VAT rate</InputLabel>
                <Select
                  labelId="item-vat-label"
                  label="VAT rate"
                  value={values.vatRate}
                  onChange={(e) => patch('vatRate', e.target.value)}
                >
                  {ITEM_VAT_RATES.map((rate) => (
                    <MenuItem key={rate} value={String(rate)}>
                      {rate === 0 ? '0% — zero-rated (medicines)' : `${Math.round(rate * 100)}% — standard-rated`}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel id="item-controlled-label">Controlled substance</InputLabel>
                <Select
                  labelId="item-controlled-label"
                  label="Controlled substance"
                  value={values.controlledStatus}
                  onChange={(e) => patch('controlledStatus', e.target.value as ItemMasterFormValues['controlledStatus'])}
                >
                  <MenuItem value="">
                    <em>None</em>
                  </MenuItem>
                  {CONTROLLED_STATUS_OPTIONS.map((s) => (
                    <MenuItem key={s} value={s}>{CONTROLLED_STATUS_LABEL[s]}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
          </Section>

          <Section
            icon={<MedicationOutlinedIcon />}
            title="Dosage instructions (optional)"
            caption="Reusable bilingual directions the pharmacist can choose per sale line"
            action={
              values.dosageIds.length > 0 ? (
                <Chip size="small" color="primary" variant="outlined" label={`${values.dosageIds.length} linked`} />
              ) : undefined
            }
          >
            <DosageLinkEditor
              dosageIds={values.dosageIds}
              defaultDosageId={values.defaultDosageId}
              onChange={(dosageIds, defaultDosageId) =>
                setValues((v) => ({ ...v, dosageIds, defaultDosageId }))
              }
            />
          </Section>

          <Section
            icon={<Inventory2OutlinedIcon />}
            title="Stock control"
            caption={
              showPackLimits
                ? 'Limits are stored in tablets — the helper under each field shows the pack meaning'
                : 'Limits and availability'
            }
          >
            <Box sx={FIELD_GRID}>
              <TextField
                label="Balance (on hand)"
                value={totals ? String(totals.onHandQty) : '0'}
                size="small"
                disabled
                helperText={
                  totals && showPackLimits && packPreview
                    ? `Derived from batches — ${formatPackBreakdown(packPreview, totals.onHandQty)}`
                    : 'Derived from batches'
                }
                fullWidth
              />
              <TextField
                label="Order limit (reorder level)"
                type="number"
                value={values.reorderLevel}
                onChange={(e) => patch('reorderLevel', e.target.value)}
                error={!!errorFor('reorderLevel')}
                helperText={
                  errorFor('reorderLevel') ??
                  (showPackLimits && packPreview
                    ? Number(values.reorderLevel) === 0
                      ? 'Counted in tablets — 0 means no reorder warning'
                      : `Counted in tablets — ${Number(values.reorderLevel)} = ${formatPackBreakdown(
                          packPreview,
                          Number(values.reorderLevel)
                        )}`
                    : 'Reorder when stock falls to this level')
                }
                size="small"
                required
                slotProps={{ htmlInput: { min: 0, step: '1' } }}
                fullWidth
              />
              <TextField
                label="Max limit (optional)"
                type="number"
                value={values.maxLevel}
                onChange={(e) => patch('maxLevel', e.target.value)}
                error={!!errorFor('maxLevel')}
                helperText={
                  errorFor('maxLevel') ??
                  (showPackLimits && packPreview
                    ? values.maxLevel.trim() === ''
                      ? 'Maximum stock level — counted in tablets'
                      : Number(values.maxLevel) === 0
                        ? 'Counted in tablets — 0 means no maximum'
                        : `Counted in tablets — ${Number(values.maxLevel)} = ${formatPackBreakdown(
                            packPreview,
                            Number(values.maxLevel)
                          )}`
                    : 'Maximum stock level')
                }
                size="small"
                slotProps={{ htmlInput: { min: 0, step: '1' } }}
                fullWidth
              />
            </Box>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 2 }}>
              <Paper
                variant="outlined"
                sx={{ flex: 1, px: 1.75, py: 1.25, borderRadius: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>Batch / expiry tracking</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Required for pharmacy stock
                  </Typography>
                </Box>
                <Switch
                  checked={values.requiresBatchTracking}
                  onChange={(e) => patch('requiresBatchTracking', e.target.checked)}
                  slotProps={{ input: { 'aria-label': 'Track batch / expiry' } }}
                />
              </Paper>
              <Paper
                variant="outlined"
                sx={{ flex: 1, px: 1.75, py: 1.25, borderRadius: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>Has expiry date</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {values.hasExpiry
                      ? 'Receiving asks for the batch expiry'
                      : 'No expiry — stock is received with a blank date'}
                  </Typography>
                </Box>
                <Switch
                  checked={values.hasExpiry}
                  onChange={(e) => patch('hasExpiry', e.target.checked)}
                  slotProps={{ input: { 'aria-label': 'Has expiry date' } }}
                />
              </Paper>
              <Paper
                variant="outlined"
                sx={{ flex: 1, px: 1.75, py: 1.25, borderRadius: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {values.isActive ? 'Active for sale' : 'Discontinued'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {values.isActive ? 'Visible in POS and purchasing' : 'Sells remaining stock only, never reordered'}
                  </Typography>
                </Box>
                <Switch
                  checked={values.isActive}
                  onChange={(e) => patch('isActive', e.target.checked)}
                  slotProps={{ input: { 'aria-label': 'Active' } }}
                />
              </Paper>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Delete is only offered once nothing is left on hand.
            </Typography>
          </Section>

          {totals && (
            <Section
              icon={<InsightsOutlinedIcon />}
              title="Movement totals"
              caption="Read-only — always derived from batches and posted movements"
            >
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)' },
                  gap: 1.25,
                }}
              >
                <Stat label="Total purchased" value={`${formatQty(totals.purchasedQty)} ${movementUnit}`} hint={`incl. ${formatQty(totals.bonusReceivedQty)} bonus`} />
                <Stat label="Total sold" value={`${formatQty(totals.soldQty)} ${movementUnit}`} />
                <Stat label="Sales returns" value={`${formatQty(totals.salesReturnQty)} ${movementUnit}`} />
                <Stat label="Stock cost value" value={`SAR ${formatMoney(totals.stockCostValue)}`} />
                <Stat label="Stock retail value" value={`SAR ${formatMoney(totals.stockRetailValue)}`} />
                <Stat
                  label="On hand"
                  value={`${formatQty(totals.onHandQty)} ${movementUnit}`}
                  hint={
                    showPackLimits && packPreview
                      ? formatPackBreakdown(packPreview, totals.onHandQty)
                      : undefined
                  }
                />
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.25 }}>
                Purchase returns, reserved quantities and on-order quantities are not tracked by this
                app yet, so they are omitted rather than shown as a misleading zero.
              </Typography>
            </Section>
          )}
        </Stack>
      </DialogContent>

      <DialogActions
        sx={{
          px: { xs: 2, sm: 3 },
          py: 1.75,
          gap: 1,
          borderTop: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Box sx={{ mr: 'auto', minWidth: 0, display: { xs: 'none', sm: 'block' } }}>
          {submitted && hasErrors ? (
            <Typography variant="caption" color="error" sx={{ fontWeight: 600 }}>
              Fix the highlighted field{errorCount === 1 ? '' : 's'} before saving.
            </Typography>
          ) : (
            <Typography variant="caption" color="text.secondary">
              Fields marked * are required
            </Typography>
          )}
        </Box>
        <Button onClick={onClose} color="inherit" sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={save}
          startIcon={<SaveOutlinedIcon />}
          sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          {item ? 'Save Changes' : 'Create Item'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function Section({
  icon, title, caption, action, children,
}: {
  icon: ReactNode;
  title: string;
  caption?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
      <Stack
        direction="row"
        spacing={1.25}
        sx={{ alignItems: 'center', px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider', bgcolor: '#f8fafc' }}
      >
        <Box
          sx={(t) => ({
            width: 30,
            height: 30,
            flexShrink: 0,
            borderRadius: 1.5,
            display: 'grid',
            placeItems: 'center',
            bgcolor: alpha(t.palette.primary.main, 0.08),
            color: 'primary.main',
            '& svg': { fontSize: 18 },
          })}
        >
          {icon}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ lineHeight: 1.3 }}>{title}</Typography>
          {caption && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>
              {caption}
            </Typography>
          )}
        </Box>
        {action}
      </Stack>
      <Box sx={{ p: 2 }}>{children}</Box>
    </Paper>
  );
}

function LadderTile({
  label, price, hint, highlight,
}: {
  label: string;
  price: number;
  hint: string;
  highlight?: boolean;
}) {
  return (
    <Box
      sx={(t) => ({
        px: 1.25,
        py: 1,
        borderRadius: 1.5,
        border: '1px solid',
        borderColor: highlight ? alpha(t.palette.primary.main, 0.35) : 'divider',
        bgcolor: highlight ? alpha(t.palette.primary.main, 0.06) : 'background.paper',
      })}
    >
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600 }}>
        {label}
      </Typography>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.25 }}>
        {formatUnitPrice(price)} <Typography component="span" variant="caption" color="text.secondary">SAR</Typography>
      </Typography>
      <Typography variant="caption" color="text.secondary">{hint}</Typography>
    </Box>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Box sx={{ px: 1.25, py: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 700 }}>{value}</Typography>
      {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
    </Box>
  );
}
