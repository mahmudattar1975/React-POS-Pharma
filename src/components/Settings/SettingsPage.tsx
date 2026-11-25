import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, TextField, Button, Checkbox, FormControlLabel, Paper, Stack, Alert, Divider, Tab, Tabs,
  ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import { T, useT, useI18n } from '../../i18n';
import { useSettingsStore } from '../../store/settingsStore';
import { cleanVatNumberInput, isVatNumberComplete } from '../../utils/vat';
import { playAlertSound } from '../../utils/alertSound';
import ZatcaIdentityPanel from '../Zatca/ZatcaIdentityPanel';
import ZatcaOnboardingPanel from '../Zatca/ZatcaOnboardingPanel';
import ErpTestPanel from './ErpTestPanel';
import WasfatySettingsPanel from './WasfatySettingsPanel';
import RsdSettingsPanel from './RsdSettingsPanel';
import BranchesPanel from './BranchesPanel';

// Settings owns the ZATCA SETUP: the company/device identity the certificate is issued to and the
// onboarding wizard. The invoice lifecycle moved to the till (Point of Sale > ZATCA sales
// invoices) because that is where a cashier needs it - the sale, its refund and its tax invoice
// are one workflow, and staff should not have to leave the counter to reprint or retry one.
export default function SettingsPage() {
  const tr = useT();
  const navigate = useNavigate();
  const { locale, setLocale, t } = useI18n();
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
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}><T>Store &amp; ZATCA Settings</T></Typography>
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
          <Typography variant="subtitle2"><T>Interface language</T></Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={locale}
            aria-label={t('Interface language')}
            onChange={(_e, next: 'en' | 'ar' | null) => { if (next) setLocale(next); }}
          >
            <ToggleButton value="en"><T>English</T></ToggleButton>
            <ToggleButton value="ar">العربية</ToggleButton>
          </ToggleButtonGroup>
          <Typography variant="caption" color="text.secondary">
            <T>Arabic mirrors the whole interface; the language is saved on this device.</T>
          </Typography>
        </Stack>
      </Paper>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          <TextField label={tr("Store Name (English)")} {...field('storeNameEn')} fullWidth />
          <TextField label={tr("Store Name (Arabic)")} {...field('storeNameAr')} fullWidth />
          <TextField label={tr("Address")} {...field('address')} fullWidth />
          <TextField
            label={tr("Pharmacy phone")}
            {...field('storePhone')}
            fullWidth
            helperText={tr("Printed on prescription labels as the pharmacy contact line.")}
          />
          <Divider />
          <TextField
            label={tr("VAT Registration Number")}
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
          <TextField label={tr("Commercial Registration (CR) No.")} {...field('crNumber')} fullWidth />
          <Divider />
          <TextField label={tr("Cashier Name")} {...field('cashierName')} fullWidth />
          <FormControlLabel
            control={
              <Checkbox
                checked={form.alertSoundsEnabled !== false}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  setForm((f) => ({ ...f, alertSoundsEnabled: enabled }));
                  // The click is a user gesture, so this preview also unlocks audio for later
                  // messages without waiting for the next alert.
                  if (enabled) playAlertSound('success');
                }}
              />
            }
            label={tr("Play a sound when a message appears")}
          />
          {saved && <Alert severity="success"><T>Settings saved.</T></Alert>}
          <Button variant="contained" onClick={save} disabled={!vatNoValid}><T>Save Settings</T></Button>
        </Stack>
      </Paper>

      <BranchesPanel />

      <Box sx={{ mt: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
          <T>ZATCA / E-Invoicing (Fatoora Phase 2)</T>
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          <T>Set the company/device identity the certificate is issued to and onboard this device. The
          invoice list moved to the till - a sale, its refund and the tax invoice ZATCA stamped are
          one counter workflow, so it now sits under Point of Sale &gt; ZATCA Sales Invoices.</T>
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }}>
          <Button
            size="small"
            variant="contained"
            onClick={() => navigate('/zatca-setup')}
            sx={{ textTransform: 'none' }}
          >
            <T>Open ZATCA Data Entry Screen</T>
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => navigate('/sales-invoices')}
            sx={{ textTransform: 'none' }}
          >
            <T>Open ZATCA Sales Invoices</T>
          </Button>
        </Stack>
        <Tabs
          value={zatcaTab}
          onChange={(_e, next: number) => setZatcaTab(next)}
          sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
        >
          <Tab label={tr("Company &amp; Device")} />
          <Tab label={tr("Onboarding")} />
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
          <T>Wasfaty / NUPCO</T>
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          <T>Dispense against the national e-prescription service and reconcile its claim ledger.
          Phase 0 works manually; the same adapter can switch to the NUPCO simulator or a live
          contract without a POS change.</T>
        </Typography>
        <WasfatySettingsPanel />
      </Box>

      <Box sx={{ mt: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
          <T>SFDA RSD (Drug Track &amp; Trace)</T>
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          <T>Report each sold serialised drug pack to SFDA and cancel it on a full return. Reporting is
          an opt-in background mirror: it never blocks a sale, and its status is visible on the
          Point of Sale &gt; RSD Reporting tab.</T>
        </Typography>
        <RsdSettingsPanel />
      </Box>

      <Box sx={{ mt: 3 }}>
        <ErpTestPanel />
      </Box>
    </Box>
  );
}
