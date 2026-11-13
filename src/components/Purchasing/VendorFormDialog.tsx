// Create/edit form for the vendor master, modelled on the legacy FCODCSVN vendor screen
// (CustVendorEditDialog in OpenMind-FrontEnd-React): numbered identity, Arabic + English names,
// category, credit/settlement settings, VAT file + GLN, notes and an active/locked switch.
//
// The vendor number is system-assigned and is the key purchase invoices and Item.vendorNo store,
// so it is shown read-only and can never be edited after the vendor exists.
import { useMemo, useState, type ReactNode } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl,
  FormControlLabel, FormHelperText, IconButton, InputLabel, MenuItem, Paper, Select, Stack, Switch,
  TextField, Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import AccountBalanceOutlinedIcon from '@mui/icons-material/AccountBalanceOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import ToggleOnOutlinedIcon from '@mui/icons-material/ToggleOnOutlined';
import type { Vendor } from '../../types/purchasing';
import { PARTY_TYPE_FLAG, type PartyTypeFlag } from '../../types/party';
import { nextPartyNumber } from '../../utils/purchasing';
import { cleanVatNumberInput } from '../../utils/vat';
import {
  EMPTY_VENDOR_FORM, VENDOR_VAT_TYPES, formToVendorInput, validateVendorForm, vendorToForm,
  type VendorFormValues,
} from '../../utils/vendors';

interface Props {
  open: boolean;
  vendor: Vendor | null; // null = creating
  vendors: Vendor[];
  // Which side of the shared party table a NEW row is created on. Editing uses the row's own flag.
  typeFlag?: PartyTypeFlag;
  onSave: (input: Omit<Vendor, 'id' | 'vendorNo' | 'typeFlag'>) => void;
  onClose: () => void;
  error?: string | null;
}

const NOTES_MAX = 2000;

export default function VendorFormDialog({
  open, vendor, vendors, typeFlag = PARTY_TYPE_FLAG.vendor, onSave, onClose, error,
}: Props) {
  const partyType = vendor?.typeFlag ?? typeFlag;
  const isCustomer = partyType === PARTY_TYPE_FLAG.customer;
  const noun = isCustomer ? 'customer' : 'vendor';
  const Noun = isCustomer ? 'Customer' : 'Vendor';

  const [values, setValues] = useState<VendorFormValues>(() => (
    vendor
      ? vendorToForm(vendor)
      : { ...EMPTY_VENDOR_FORM, vendorNo: nextPartyNumber(vendors, partyType) }
  ));
  const [submitted, setSubmitted] = useState(false);

  const errors = useMemo(() => validateVendorForm(values), [values]);
  const hasErrors = Object.keys(errors).length > 0;
  const errorCount = Object.keys(errors).length;

  function patch<K extends keyof VendorFormValues>(key: K, value: VendorFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function errorFor(key: keyof VendorFormValues): string | undefined {
    return submitted ? errors[key] : undefined;
  }

  function save() {
    setSubmitted(true);
    if (hasErrors) {
      requestAnimationFrame(() => {
        const field = document.querySelector<HTMLElement>(
          '.MuiDialog-root .Mui-error input, .MuiDialog-root .Mui-error textarea'
        );
        field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        field?.focus({ preventScroll: true });
      });
      return;
    }
    onSave(formToVendorInput(values));
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle
        component="div"
        sx={{ position: 'relative', pr: 7, py: 2, borderBottom: '1px solid', borderColor: 'divider', bgcolor: '#f8fafc' }}
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
            <StorefrontOutlinedIcon />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="h6" noWrap sx={{ lineHeight: 1.2 }}>
              {vendor ? `Edit ${noun}` : `New ${noun}`}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
              {vendor
                ? `${Noun} no ${vendor.vendorNo} · ${vendor.nameEn}`
                : `Next number ${values.vendorNo} — assigned automatically`}
            </Typography>
          </Box>
          {vendor ? (
            <Chip
              size="small"
              label={values.isActive ? 'Active' : 'Inactive'}
              color={values.isActive ? 'success' : 'default'}
              variant={values.isActive ? 'outlined' : 'filled'}
              sx={{ flexShrink: 0 }}
            />
          ) : (
            <Chip size="small" label="New" variant="outlined" sx={{ flexShrink: 0 }} />
          )}
        </Stack>
        <IconButton aria-label="Close" onClick={onClose} size="small" sx={{ position: 'absolute', right: 12, top: 12 }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ bgcolor: 'background.default', px: { xs: 2, sm: 3 }, py: 2.5 }}>
        <Stack spacing={2}>
          {error && <Alert severity="error" onClose={onClose}>{error}</Alert>}

          <Section
            icon={<BadgeOutlinedIcon />}
            title={`${Noun} identity`}
            caption={isCustomer
              ? 'بيانات العميل — the customer number is fixed once saved'
              : 'بيانات المورد — the vendor number is fixed once saved'}
          >
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' } }}>
              <TextField
                label={`${Noun} No`}
                value={values.vendorNo}
                size="small"
                helperText={`System-assigned — used by purchase invoices and item master rows`}
                slotProps={{ input: { readOnly: true } }}
                fullWidth
              />
              <TextField
                label="Phone"
                value={values.phone}
                onChange={(e) => patch('phone', e.target.value)}
                error={!!errorFor('phone')}
                helperText={errorFor('phone') ?? 'Office / order line'}
                size="small"
                fullWidth
              />
              <TextField
                label="Name (Arabic - عربي)"
                value={values.nameAr}
                onChange={(e) => patch('nameAr', e.target.value)}
                error={!!errorFor('nameAr')}
                helperText={errorFor('nameAr') ?? (isCustomer ? 'اسم العميل بالعربي' : 'اسم المورد بالعربي')}
                size="small"
                required
                fullWidth
                slotProps={{ htmlInput: { dir: 'rtl', style: { textAlign: 'right' } } }}
              />
              <TextField
                label="Name (English)"
                value={values.nameEn}
                onChange={(e) => patch('nameEn', e.target.value)}
                error={!!errorFor('nameEn')}
                helperText={errorFor('nameEn') ?? `${Noun} name on documents`}
                size="small"
                required
                fullWidth
              />
              <TextField
                label="Category"
                value={values.category}
                onChange={(e) => patch('category', e.target.value)}
                error={!!errorFor('category')}
                helperText={errorFor('category') ?? 'e.g. Distributor, Importer, Wholesaler'}
                size="small"
                fullWidth
                sx={{ gridColumn: { sm: '1 / -1' } }}
              />
            </Box>
          </Section>

          <Section
            icon={<AccountBalanceOutlinedIcon />}
            title="Credit & terms"
            caption="Legacy cust_limit / setlemen_days / bonus and limitation sets"
          >
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' } }}>
              <TextField
                label="Credit limit"
                type="number"
                value={values.creditLimit}
                onChange={(e) => patch('creditLimit', e.target.value)}
                error={!!errorFor('creditLimit')}
                helperText={errorFor('creditLimit') ?? 'Blank = not set'}
                size="small"
                slotProps={{ htmlInput: { min: 0, step: '0.01' } }}
                fullWidth
              />
              <TextField
                label="Settlement days"
                type="number"
                value={values.settlementDays}
                onChange={(e) => patch('settlementDays', e.target.value)}
                error={!!errorFor('settlementDays')}
                helperText={errorFor('settlementDays') ?? 'Payment terms'}
                size="small"
                slotProps={{ htmlInput: { min: 0, step: '1' } }}
                fullWidth
              />
              <TextField
                label="Bonus / discount set"
                type="number"
                value={values.bonusDiscountSetNo}
                onChange={(e) => patch('bonusDiscountSetNo', e.target.value)}
                error={!!errorFor('bonusDiscountSetNo')}
                helperText={errorFor('bonusDiscountSetNo') ?? 'Optional set number'}
                size="small"
                slotProps={{ htmlInput: { min: 0, step: '1' } }}
                fullWidth
              />
              <TextField
                label="Limitation set"
                type="number"
                value={values.limitationSetNo}
                onChange={(e) => patch('limitationSetNo', e.target.value)}
                error={!!errorFor('limitationSetNo')}
                helperText={errorFor('limitationSetNo') ?? 'Optional set number'}
                size="small"
                slotProps={{ htmlInput: { min: 0, step: '1' } }}
                fullWidth
              />
            </Box>
          </Section>

          <Section
            icon={<ReceiptLongOutlinedIcon />}
            title="Tax & identifiers"
            caption="KSA VAT file number (15 digits) and GS1 GLN (13 digits)"
          >
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' } }}>
              <TextField
                label="VAT number (optional)"
                value={values.vatNumber}
                onChange={(e) => patch('vatNumber', cleanVatNumberInput(e.target.value))}
                error={!!errorFor('vatNumber')}
                helperText={errorFor('vatNumber') ?? `${values.vatNumber.length} / 15 digits`}
                size="small"
                slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                fullWidth
              />
              <FormControl fullWidth size="small" error={!!errorFor('vatType')}>
                <InputLabel id="vendor-vat-type-label">VAT type</InputLabel>
                <Select
                  labelId="vendor-vat-type-label"
                  label="VAT type"
                  value={values.vatType}
                  onChange={(e) => patch('vatType', e.target.value)}
                >
                  {VENDOR_VAT_TYPES.map((option) => (
                    <MenuItem key={option.value} value={String(option.value)}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>{errorFor('vatType') ?? `Used on the ${noun} file`}</FormHelperText>
              </FormControl>
              <TextField
                label="GLN (optional)"
                value={values.glnNo}
                onChange={(e) => patch('glnNo', e.target.value.replace(/\D/g, '').slice(0, 13))}
                error={!!errorFor('glnNo')}
                helperText={errorFor('glnNo') ?? `${values.glnNo.length} / 13 digits`}
                size="small"
                slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                fullWidth
              />
            </Box>
          </Section>

          <Section
            icon={<ToggleOnOutlinedIcon />}
            title="Status & notes"
            caption={`Inactive ${noun}s stay on old invoices and items, but are not offered for new ones`}
          >
            <Stack spacing={2}>
              <FormControlLabel
                control={<Switch checked={values.isActive} onChange={(e) => patch('isActive', e.target.checked)} />}
                label={values.isActive ? 'Active' : 'Inactive'}
                sx={{ ml: 0 }}
              />
              <TextField
                label="Notes"
                value={values.notes}
                onChange={(e) => patch('notes', e.target.value)}
                error={!!errorFor('notes')}
                helperText={errorFor('notes') ?? `${values.notes.length} / ${NOTES_MAX} characters`}
                size="small"
                fullWidth
                multiline
                minRows={3}
                placeholder="Delivery days, contact person, payment notes…"
              />
            </Stack>
          </Section>
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
          {vendor ? 'Save Changes' : `Create ${Noun}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function Section({
  icon, title, caption, children,
}: {
  icon: ReactNode;
  title: string;
  caption?: string;
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
      </Stack>
      <Box sx={{ p: 2 }}>{children}</Box>
    </Paper>
  );
}
