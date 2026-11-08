import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, TextField, Button, Paper, Stack, Alert, Divider, Tab, Tabs,
} from '@mui/material';
import { useSettingsStore } from '../../store/settingsStore';
import { cleanVatNumberInput, isVatNumberComplete } from '../../utils/vat';
import ZatcaIdentityPanel from '../Zatca/ZatcaIdentityPanel';
import ZatcaOnboardingPanel from '../Zatca/ZatcaOnboardingPanel';
import ErpTestPanel from './ErpTestPanel';
import WasfatySettingsPanel from './WasfatySettingsPanel';

// Settings owns the ZATCA SETUP: the company/device identity the certificate is issued to and the
// onboarding wizard. The invoice lifecycle moved to the till (Point of Sale > ZATCA sales
// invoices) because that is where a cashier needs it - the sale, its refund and its tax invoice
// are one workflow, and staff should not have to leave the counter to reprint or retry one.
export default function SettingsPage() {
  const navigate = useNavigate();
  const { settings, update } = useSettingsStore();
  const [form, setForm] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [zatcaTab, setZatcaTab] = useState(0);

  function field<K extends keyof typeof form>(key: K) {
    return {
      value: form[key] as string,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value })),
    };
  }

  function save() {
    update(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  // The merchant's own registration: OPTIONAL (a fresh install or a non-VAT-registered store may
  // leave it blank), but once typed it must satisfy BOTH rules - exactly 15 digits (shared
  // helper) and ZATCA's stricter first/last digit = 3 (this store's own number, not a vendor's).
  const vatEmpty = form.vatRegistrationNo === '';
  const vatDigitsComplete = isVatNumberComplete(form.vatRegistrationNo);
  const vatNoValid = vatEmpty || (vatDigitsComplete && /^3\d{13}3$/.test(form.vatRegistrationNo));
  const vatHelperText = vatEmpty
    ? 'Optional — leave empty if the store has no VAT number; ZATCA receipts will then show none.'
    : !vatDigitsComplete
      ? `VAT no. has 15 digits — ${form.vatRegistrationNo.length}/15 entered.`
      : /^3\d{13}3$/.test(form.vatRegistrationNo)
        ? 'Printed on every invoice QR code.'
        : 'ZATCA VAT numbers must start and end with 3.';

  return (
    <Box sx={{ p: 3, maxWidth: 1200 }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>Store &amp; ZATCA Settings</Typography>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          <TextField label="Store Name (English)" {...field('storeNameEn')} fullWidth />
          <TextField label="Store Name (Arabic)" {...field('storeNameAr')} fullWidth />
          <TextField label="Address" {...field('address')} fullWidth />
          <Divider />
          <TextField
            label="VAT Registration Number"
            {...field('vatRegistrationNo')}
            // Overrides the generic spread above: digits only, hard stop at 15 characters, so an
            // extra digit can never be typed or pasted into a legal tax field.
            onChange={(e) =>
              setForm((f) => ({ ...f, vatRegistrationNo: cleanVatNumberInput(e.target.value) }))
            }
            fullWidth
            error={!vatEmpty && !vatNoValid}
            helperText={vatHelperText}
            slotProps={{ htmlInput: { maxLength: 15, inputMode: 'numeric' } }}
          />
          <TextField label="Commercial Registration (CR) No." {...field('crNumber')} fullWidth />
          <Divider />
          <TextField label="Cashier Name" {...field('cashierName')} fullWidth />
          {saved && <Alert severity="success">Settings saved.</Alert>}
          <Button variant="contained" onClick={save} disabled={!vatNoValid}>Save Settings</Button>
        </Stack>
      </Paper>

      <Box sx={{ mt: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
          ZATCA / E-Invoicing (Fatoora Phase 2)
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Set the company/device identity the certificate is issued to and onboard this device. The
          invoice list moved to the till - a sale, its refund and the tax invoice ZATCA stamped are
          one counter workflow, so it now sits under Point of Sale &gt; ZATCA Sales Invoices.
        </Typography>
        <Button
          size="small"
          variant="outlined"
          onClick={() => navigate('/sales-invoices')}
          sx={{ mb: 2, textTransform: 'none' }}
        >
          Open ZATCA Sales Invoices
        </Button>
        <Tabs
          value={zatcaTab}
          onChange={(_e, next: number) => setZatcaTab(next)}
          sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
        >
          <Tab label="Company &amp; Device" />
          <Tab label="Onboarding" />
        </Tabs>

        {/* Both panels stay mounted so switching tabs never abandons an in-flight onboarding step;
            only the inactive one is hidden. */}
        <Box sx={{ display: zatcaTab === 0 ? 'block' : 'none' }}>
          <ZatcaIdentityPanel storeSettings={settings} />
        </Box>
        <Box sx={{ display: zatcaTab === 1 ? 'block' : 'none' }}>
          <ZatcaOnboardingPanel />
        </Box>
      </Box>

      <Box sx={{ mt: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
          Wasfaty / NUPCO
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Dispense against the national e-prescription service and reconcile its claim ledger.
          Phase 0 works manually; the same adapter can switch to the NUPCO simulator or a live
          contract without a POS change.
        </Typography>
        <WasfatySettingsPanel />
      </Box>

      <Box sx={{ mt: 3 }}>
        <ErpTestPanel />
      </Box>
    </Box>
  );
}
