import { useEffect, useState, type ChangeEvent } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, FormControl, FormControlLabel, FormLabel,
  Paper, Radio, RadioGroup, Stack, TextField, Typography,
} from '@mui/material';
import * as zatcaApi from '../../api/zatcaApi';
import type {
  ZatcaCsidSummary, ZatcaDeviceIdentity, ZatcaEnv, ZatcaSellerIdentity, ZatcaSettings,
} from '../../api/zatcaApi';
import type { StoreSettings } from '../../types/settings';
import { cleanVatNumberInput } from '../../utils/vat';
import {
  CSID_STATUS_LABEL, INVOICE_TYPE_CHOICES, csidExpiryText, deriveCommonName, deriveEgsSerial,
  identityDraftErrors, vatNumberError,
} from '../../utils/zatcaIdentity';

import { T, useT } from '../../i18n';
const ENV_LABEL: Record<ZatcaEnv, string> = {
  sandbox: 'Test mode (sandbox)',
  simulation: 'Simulation',
  production: 'Production',
};

function CsidRow({ title, info }: { title: string; info?: ZatcaCsidSummary }) {
  const tr = useT();
  if (!info) {
    return (
      <Box sx={{ flex: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{title}</Typography>
        <Typography variant="caption" color="text.secondary"><T>Not issued yet.</T></Typography>
      </Box>
    );
  }

  const status = CSID_STATUS_LABEL[info.status];
  return (
    <Box sx={{ flex: 1 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{title}</Typography>
        <Chip size="small" color={status.color} label={status.label} />
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        <T>Issued</T> {new Date(info.issuedAt).toLocaleDateString()}
        {info.expiresAt && `${tr(" · expires ")}${new Date(info.expiresAt).toLocaleDateString()} (${csidExpiryText(info.daysUntilExpiry)})`}
      </Typography>
    </Box>
  );
}

// The seller/device identity that ZATCA actually sees. Kept on the ZATCA server (not localStorage)
// because the CSR, the certificate and every signed invoice must all be built from one copy - see
// server/src/store/identity.ts. The panel is deliberately explicit about what is derived vs typed, so
// nobody tries to edit a Common Name that the server would overwrite.
export default function ZatcaIdentityPanel({ storeSettings }: { storeSettings?: StoreSettings }) {
  const tr = useT();
  const [settings, setSettings] = useState<ZatcaSettings | null>(null);
  const [seller, setSeller] = useState<ZatcaSellerIdentity | null>(null);
  const [device, setDevice] = useState<ZatcaDeviceIdentity | null>(null);
  const [serverUp, setServerUp] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const up = await zatcaApi.isServerReachable();
    setServerUp(up);
    if (!up) return;
    try {
      const loaded = await zatcaApi.getSettings();
      setSettings(loaded);
      setSeller(loaded.seller);
      setDevice(loaded.device);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    // Load once when the tab is first rendered; saving refreshes state from the response. The state
    // writes all happen after an await, which is also what keeps this out of the
    // "synchronous setState inside an effect" lint rule.
    let active = true;
    (async () => {
      const up = await zatcaApi.isServerReachable();
      if (!active) return;
      setServerUp(up);
      if (!up) return;
      try {
        const loaded = await zatcaApi.getSettings();
        if (!active) return;
        setSettings(loaded);
        setSeller(loaded.seller);
        setDevice(loaded.device);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (serverUp === null) {
    return (
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary"><T>Reading the stored ZATCA identity…</T></Typography>
        </Stack>
      </Paper>
    );
  }

  if (serverUp === false) {
    return (
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Alert severity="error">
          <T>The ZATCA server isn't reachable, so the company/device identity cannot be read or saved.
          Start it with</T> <code><T>npm run dev</T></code> <T>in</T> <code><T>Pharmacy-App/server</T></code><T>, then reopen this tab.</T>
        </Alert>
      </Paper>
    );
  }

  if (!seller || !device) {
    if (!error) {
      return (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <CircularProgress size={20} />
            <Typography variant="body2" color="text.secondary"><T>Reading the stored ZATCA identity…</T></Typography>
          </Stack>
        </Paper>
      );
    }
    return (
      <Stack spacing={1}>
        <Alert severity="error">{error}</Alert>
        <Button variant="outlined" onClick={() => { setError(null); load(); }}><T>Retry</T></Button>
      </Stack>
    );
  }

  // `seller`/`device` are proven non-null above, but function DECLARATIONS are hoisted, so TS does
  // not carry that narrowing into them. Bind the narrowed values once and use them below.
  const currentSeller: ZatcaSellerIdentity = seller;
  const currentDevice: ZatcaDeviceIdentity = device;
  const vatError = vatNumberError(currentSeller.vatNumber);
  const draftErrors = identityDraftErrors(currentSeller, currentDevice);
  const configured = settings?.configured ?? false;

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await zatcaApi.saveSettings({ seller: currentSeller, device: currentDevice });
      setSettings(updated);
      setSeller(updated.seller);
      setDevice(updated.device);
      setNotice(
        updated.csidsCleared
          ? 'Saved. The CSR identity changed, so the existing CSID and invoice chain were cleared - run Onboarding again.'
          : 'Saved. These values are now used for both the CSR and every signed invoice.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function sellerField(key: keyof ZatcaSellerIdentity) {
    return {
      value: currentSeller[key],
      onChange: (e: ChangeEvent<HTMLInputElement>) =>
        setSeller((current) => (current ? { ...current, [key]: e.target.value } : current)),
    };
  }

  function deviceField(key: 'solutionName' | 'solutionRelease' | 'egUuid') {
    return {
      value: currentDevice[key],
      onChange: (e: ChangeEvent<HTMLInputElement>) =>
        setDevice((current) => (current ? { ...current, [key]: e.target.value } : current)),
    };
  }

  // Convenience bridge from the local Settings card (used by the Phase 1 QR) into this server-side
  // identity. Explicit button, not automatic: copying an address silently could overwrite a
  // deliberately different ZATCA registration.
  function fillFromStore() {
    if (!storeSettings) return;
    setSeller({
      ...currentSeller,
      nameEn: storeSettings.storeNameEn || currentSeller.nameEn,
      nameAr: storeSettings.storeNameAr || currentSeller.nameAr,
      vatNumber: cleanVatNumberInput(storeSettings.vatRegistrationNo || currentSeller.vatNumber),
      crNumber: storeSettings.crNumber || currentSeller.crNumber,
      street: storeSettings.address || currentSeller.street,
    });
    setNotice('Copied the store name, VAT, CR and address from Settings above. Complete the remaining address fields, then Save.');
  }

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}><T>Company &amp; Device Identity</T></Typography>
          <Chip size="small" label={tr(ENV_LABEL[settings?.environment ?? 'sandbox'])} />
          {settings?.source === 'env' && <Chip size="small" color="warning" label={tr('seeded from .env - review & save')} />}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          <T>These are the values inside the CSR, the ZATCA certificate and every signed invoice. They
          must match the business's VAT registration. Stored on the ZATCA server, not in this browser.</T>
        </Typography>

        {settings && !configured && (
          <Alert severity="info" sx={{ mb: 2 }}>
            <T>Not ready for onboarding yet. Still missing:</T> {settings.missing.join(', ')}.
          </Alert>
        )}

        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}><T>Seller</T></Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
          <TextField
            label={tr('Legal Seller Name (English)')}
            {...sellerField('nameEn')}
            helperText={tr('Exactly as registered for VAT - used as the CSR organization and UBL supplier name.')}
            fullWidth
          />
          <TextField
            label={tr('Legal Seller Name (Arabic)')}
            {...sellerField('nameAr')}
            helperText={tr('Registered Arabic legal name - required before ZATCA onboarding.')}
            fullWidth
          />
          <TextField
            label={tr('VAT Registration Number')}
            {...sellerField('vatNumber')}
            // Hard stop at 15 characters - a legal tax field must not accept a 16th digit, by
            // typing or by paste. Blank is allowed until the business is registered.
            onChange={(e) =>
              setSeller((current) => (current ? { ...current, vatNumber: cleanVatNumberInput(e.target.value) } : current))
            }
            error={vatError !== null}
            helperText={vatError ?? 'Exactly 15 digits, starting and ending with 3. May be left blank.'}
            slotProps={{ htmlInput: { maxLength: 15, inputMode: 'numeric' } }}
            fullWidth
          />
          <TextField
            label={tr('Commercial Registration (CR) No.')}
            {...sellerField('crNumber')}
            helperText={tr('Required. Signed into every invoice as the supplier CompanyID.')}
            fullWidth
          />
          <TextField
            label={tr('Organization Unit / Branch')}
            {...sellerField('organizationUnit')}
            helperText={tr('The ZATCA-registered branch name used as the CSR OU.')}
            fullWidth
          />
          <TextField
            label={tr('Industry (business category)')}
            {...sellerField('industry')}
            helperText={tr('e.g. Pharmacy Retail - goes into the CSR businessCategory.')}
            fullWidth
          />
          <TextField
            label={tr('Street')}
            {...sellerField('street')}
            helperText={tr('Full registered address: street, district, city, postal code and country are combined for the CSR registeredAddress.')}
            fullWidth
          />
          <TextField label={tr('District')} {...sellerField('district')} fullWidth />
          <TextField label={tr('City')} {...sellerField('city')} fullWidth />
          <TextField label={tr('Postal Code')} {...sellerField('postalCode')} fullWidth />
          <TextField label={tr('Country (ISO code)')} {...sellerField('country')} fullWidth slotProps={{ htmlInput: { maxLength: 2 } }} />
        </Box>
        <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap' }}>
          <Button size="small" variant="outlined" onClick={fillFromStore} disabled={busy || !storeSettings}>
            <T>Copy from store settings</T>
          </Button>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}><T>Device</T></Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          <T>This register's identity. Common Name and EGS serial are derived from the fields below -
          they are shown read-only because ZATCA expects exactly these formats.</T>
        </Typography>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
          <TextField
            label={tr('Terminal No.')}
            type="number"
            value={device.terminalNo}
            onChange={(e) =>
              setDevice((current) =>
                current ? { ...current, terminalNo: Number.parseInt(e.target.value, 10) || 0 } : current,
              )
            }
            slotProps={{ htmlInput: { min: 1, step: 1 } }}
            helperText={tr('1 = the only/default terminal. Each additional register gets its own number.')}
            fullWidth
          />
          <TextField
            label={tr('Solution Name')}
            {...deviceField('solutionName')}
            helperText={tr('The EGS solution name registered with ZATCA, e.g. POS PHARMA.')}
            fullWidth
          />
          <TextField
            label={tr('Solution Release')}
            {...deviceField('solutionRelease')}
            helperText={tr('Version of the solution used for this device, e.g. 1.0.')}
            fullWidth
          />
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
            <TextField
              label={tr('Device UUID (EGS UUID)')}
              {...deviceField('egUuid')}
              helperText={tr('Unique ID for this register. It is the third part of the EGS serial; keep it stable after onboarding.')}
              fullWidth
            />
            <Button
              size="small"
              variant="outlined"
              sx={{ mt: 1, whiteSpace: 'nowrap', textTransform: 'none' }}
              disabled={busy}
              onClick={() =>
                setDevice((current) =>
                  current ? { ...current, egUuid: crypto.randomUUID() } : current,
                )
              }
            >
              <T>Generate</T>
            </Button>
          </Stack>
          <TextField
            label={tr('Common Name (derived)')}
            value={deriveCommonName(device)}
            slotProps={{ input: { readOnly: true } }}
            fullWidth
          />
          <TextField
            label={tr('EGS Serial (derived)')}
            value={deriveEgsSerial(device)}
            slotProps={{ input: { readOnly: true } }}
            fullWidth
          />
        </Box>

        <FormControl sx={{ mt: 2 }}>
          <FormLabel sx={{ fontWeight: 600 }}><T>Invoice type</T></FormLabel>
          <RadioGroup
            value={device.invoiceType}
            onChange={(e) =>
              setDevice((current) =>
                current
                  ? { ...current, invoiceType: e.target.value as ZatcaDeviceIdentity['invoiceType'] }
                  : current,
              )
            }
          >
            {INVOICE_TYPE_CHOICES.map((choice) => (
              <FormControlLabel
                key={choice.value}
                value={choice.value}
                control={<Radio size="small" />}
                sx={{ alignItems: tr("flex-start"), mb: 0.5 }}
                label={
                  <Box>
                    <Typography variant="body2">{choice.label}</Typography>
                    <Typography variant="caption" color="text.secondary">{choice.help}</Typography>
                  </Box>
                }
              />
            ))}
          </RadioGroup>
        </FormControl>
      </Paper>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}><T>CSID status</T></Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <CsidRow title={tr('Compliance CSID')} info={settings?.csid.compliance} />
          <CsidRow title={tr('Production CSID')} info={settings?.csid.production} />
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          <T>Expiry is read from the issued certificate. Changing any identity field above after a CSID
          exists clears it (and the invoice chain), because the certificate would no longer describe
          this business/device - onboard again afterwards.</T>
        </Typography>
      </Paper>

      {draftErrors.length > 0 && (
        <Alert severity="error">{draftErrors.join(' ')}</Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="success">{notice}</Alert>}

      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Button variant="contained" onClick={save} disabled={busy || draftErrors.length > 0}>
          {busy ? <CircularProgress size={20} /> : tr("Save Company & Device")}
        </Button>
        <Button variant="text" onClick={() => { setError(null); load(); }} disabled={busy}><T>Reload</T></Button>
      </Stack>
    </Stack>
  );
}
