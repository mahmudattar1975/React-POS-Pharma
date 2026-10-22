import { useState } from 'react';
import { Box, Typography, TextField, Button, Paper, Stack, Alert, Divider } from '@mui/material';
import { useSettingsStore } from '../../store/settingsStore';
import ZatcaOnboardingPanel from './ZatcaOnboardingPanel';
import ErpTestPanel from './ErpTestPanel';

export default function SettingsPage() {
  const { settings, update } = useSettingsStore();
  const [form, setForm] = useState(settings);
  const [saved, setSaved] = useState(false);

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

  const vatNoValid = /^3\d{13}3$/.test(form.vatRegistrationNo);

  return (
    <Box sx={{ p: 3, maxWidth: 900 }}>
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
            fullWidth
            error={!vatNoValid}
            helperText={vatNoValid ? 'Printed on every invoice QR code.' : 'ZATCA requires a 15-digit number starting and ending with 3.'}
          />
          <TextField label="Commercial Registration (CR) No." {...field('crNumber')} fullWidth />
          <Divider />
          <TextField label="Cashier Name" {...field('cashierName')} fullWidth />
          {saved && <Alert severity="success">Settings saved.</Alert>}
          <Button variant="contained" onClick={save}>Save Settings</Button>
        </Stack>
      </Paper>

      <Box sx={{ mt: 3 }}>
        <ZatcaOnboardingPanel />
      </Box>

      <Box sx={{ mt: 3 }}>
        <ErpTestPanel />
      </Box>
    </Box>
  );
}
