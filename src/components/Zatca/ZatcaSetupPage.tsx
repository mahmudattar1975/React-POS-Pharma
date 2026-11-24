// One screen for entering everything ZATCA onboarding needs.
//
// The data used to be spread across Settings > ZATCA > Company & Device and the Onboarding tab.
// That is fine once you know the product, but it is a bad data-entry form for a new pharmacy: the
// VAT number, Arabic/English legal name, full registered address, CR, branch, solution identity and
// OTP all have to agree before a CSR can be issued. This page puts the checklist and both panels on
// one screen so an operator can fill everything in one pass and see exactly what is still missing.
import {
  Alert, Box, Paper, Stack, Typography,
} from '@mui/material';
import ZatcaIdentityPanel from './ZatcaIdentityPanel';
import ZatcaOnboardingPanel from './ZatcaOnboardingPanel';
import { useSettingsStore } from '../../store/settingsStore';

const REQUIRED_FIELDS = [
  ['VAT number', '15 digits, starts and ends with 3'],
  ['Legal seller name', 'English and Arabic, exactly as registered'],
  ['Full registered address', 'Street, district, city, postal code, country SA'],
  ['Commercial Registration (CR)', 'The ZATCA-registered CR number'],
  ['Branch / organization unit', 'The branch name on the registration'],
  ['Solution name / release', 'e.g. POS PHARMA / 1.0'],
  ['Device details', 'Terminal number, device UUID, invoice type (auto-derived where possible)'],
  ['Fatoora OTP', 'Entered in step 1 of onboarding; one-time use'],
] as const;

export default function ZatcaSetupPage() {
  const storeSettings = useSettingsStore((s) => s.settings);

  return (
    <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
      <Stack spacing={2}>
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
            ZATCA Data Entry &amp; Onboarding
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Fill in the seller and device identity below and save it before requesting a Compliance
            CSID. The same stored identity is used for the CSR, the certificate and every signed
            invoice - a mismatch here is the usual reason ZATCA rejects onboarding.
          </Typography>
          <Alert severity="info" sx={{ mb: 2 }}>
            All values must match the business's ZATCA/Fatoora registration. Changing the identity
            after a CSID exists clears the CSID and the invoice chain, so enter them carefully.
          </Alert>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Required data checklist</Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 0.75 }}>
            {REQUIRED_FIELDS.map(([label, help]) => (
              <Typography component="li" variant="body2" key={label}>
                <strong>{label}</strong> — {help}
              </Typography>
            ))}
          </Box>
        </Paper>

        <ZatcaIdentityPanel storeSettings={storeSettings} />
        <ZatcaOnboardingPanel />
      </Stack>
    </Box>
  );
}
