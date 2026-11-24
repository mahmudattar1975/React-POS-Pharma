// Counter capture for a Wasfaty (وصفتي) dispense.
//
// Phase 0 deliberately works with no NUPCO connection: the pharmacist types what is printed on the
// patient's Wasfaty message and the sale is recorded as `manual_recorded`. The optional "Look up"
// button calls this app's provider-neutral API; when the server is configured with the `mock`
// provider it fills the form for a full end-to-end demo, and with a real `direct`/`hub` contract it
// pulls the prescription from NUPCO. A failed lookup never blocks a dispense the pharmacist has
// verified by hand.
import { useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, Stack, TextField, Typography,
} from '@mui/material';
import LocalPharmacyOutlinedIcon from '@mui/icons-material/LocalPharmacyOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import type { WasfatySession } from '../../types/wasfaty';
import {
  hasWasfatySessionErrors, maskNationalId, validateWasfatySession,
} from '../../utils/wasfaty';
import * as wasfatyApi from '../../api/wasfatyApi';

interface Props {
  open: boolean;
  initialPatientId?: string;
  onClose: () => void;
  onStart: (session: WasfatySession) => void;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function WasfatyCaptureDialog({ open, initialPatientId, onClose, onStart }: Props) {
  const [values, setValues] = useState<WasfatySession>({
    patientNationalId: initialPatientId ?? '',
    prescriptionNo: '',
    wasfatyReferenceNo: '',
    authorizationNo: '',
    prescriberName: '',
    prescriberId: '',
    prescriptionDate: today(),
  });
  const [submitted, setSubmitted] = useState(false);
  const [lookupState, setLookupState] = useState<{
    loading: boolean;
    error?: string;
    info?: string;
  }>({ loading: false });

  const errors = validateWasfatySession(values);
  const hasErrors = hasWasfatySessionErrors(errors);
  const errorFor = (key: keyof typeof errors) => (submitted ? errors[key] : undefined);

  function patch<K extends keyof WasfatySession>(key: K, value: WasfatySession[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function lookup() {
    if (!values.prescriptionNo.trim()) {
      setLookupState({ loading: false, error: 'Enter the prescription number first.' });
      return;
    }
    setLookupState({ loading: true });
    try {
      const prescription = await wasfatyApi.lookupWasfatyPrescription({
        prescriptionNo: values.prescriptionNo.trim(),
        patientNationalId: values.patientNationalId.trim() || undefined,
      });
      setValues((v) => ({
        ...v,
        // Do not overwrite what the pharmacist typed unless the provider actually returned it.
        wasfatyReferenceNo: v.wasfatyReferenceNo || prescription.prescriptionId,
        prescriberName: v.prescriberName || prescription.prescriber.name,
        prescriberId: v.prescriberId || prescription.prescriber.id,
        prescriptionDate: v.prescriptionDate || prescription.issuedAt.slice(0, 10),
      }));
      setLookupState({
        loading: false,
        info: `${prescription.lines.length} line(s) found · ${prescription.status} · patient ${prescription.patientIdLast4 ? `••••${prescription.patientIdLast4}` : 'not shown'}`,
      });
    } catch (err) {
      setLookupState({
        loading: false,
        error: `${err instanceof Error ? err.message : String(err)} — you can still record the dispense manually.`,
      });
    }
  }

  function start() {
    setSubmitted(true);
    if (hasErrors) return;
    onStart({
      ...values,
      patientNationalId: values.patientNationalId.replace(/\D/g, ''),
      prescriptionNo: values.prescriptionNo.trim(),
      wasfatyReferenceNo: values.wasfatyReferenceNo?.trim() || undefined,
      authorizationNo: values.authorizationNo?.trim() || undefined,
      prescriberName: values.prescriberName.trim(),
      prescriberId: values.prescriberId?.trim() || undefined,
    });
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <LocalPharmacyOutlinedIcon color="primary" />
        Wasfaty / وصفتي dispense
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            Covered items are invoiced at the NUPCO-approved value and settled by a Wasfaty tender,
            so the patient share is 0.00. Non-covered items stay patient-paid on the same invoice.
          </Typography>
          {lookupState.error && <Alert severity="warning" onClose={() => setLookupState({ loading: false })}>{lookupState.error}</Alert>}
          {lookupState.info && <Alert severity="success">{lookupState.info}</Alert>}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
            <TextField
              label="Prescription No. (وصفة)"
              value={values.prescriptionNo}
              onChange={(e) => patch('prescriptionNo', e.target.value)}
              error={!!errorFor('prescriptionNo')}
              helperText={errorFor('prescriptionNo') ?? 'From the patient’s Wasfaty message'}
              size="small"
              fullWidth
              autoFocus
            />
            <Button
              variant="outlined"
              startIcon={lookupState.loading ? <CircularProgress size={16} /> : <SearchOutlinedIcon />}
              disabled={lookupState.loading}
              onClick={lookup}
              sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
            >
              Look up
            </Button>
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              label="Patient National ID / Iqama"
              value={values.patientNationalId}
              onChange={(e) => patch('patientNationalId', e.target.value.replace(/\D/g, '').slice(0, 10))}
              error={!!errorFor('patientNationalId')}
              helperText={
                errorFor('patientNationalId') ??
                (values.patientNationalId.length === 10
                  ? `Shown everywhere as ${maskNationalId(values.patientNationalId)}`
                  : '10 digits — masked on lists, receipts and claims')
              }
              size="small"
              fullWidth
              slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 10 } }}
            />
            <TextField
              label="Prescription date"
              type="date"
              value={values.prescriptionDate}
              onChange={(e) => patch('prescriptionDate', e.target.value)}
              error={!!errorFor('prescriptionDate')}
              helperText={errorFor('prescriptionDate')}
              size="small"
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              label="Wasfaty reference (optional)"
              value={values.wasfatyReferenceNo ?? ''}
              onChange={(e) => patch('wasfatyReferenceNo', e.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              label="Authorization No. (optional)"
              value={values.authorizationNo ?? ''}
              onChange={(e) => patch('authorizationNo', e.target.value)}
              error={!!errorFor('authorizationNo')}
              helperText={errorFor('authorizationNo') ?? 'NUPCO authorization, when the portal shows one'}
              size="small"
              fullWidth
            />
          </Stack>

          <Divider />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              label="Prescriber name"
              value={values.prescriberName}
              onChange={(e) => patch('prescriberName', e.target.value)}
              error={!!errorFor('prescriberName')}
              helperText={errorFor('prescriberName')}
              size="small"
              fullWidth
            />
            <TextField
              label="Prescriber ID (optional)"
              value={values.prescriberId ?? ''}
              onChange={(e) => patch('prescriberId', e.target.value)}
              size="small"
              fullWidth
            />
          </Stack>

          <Box>
            <Typography variant="caption" color="text.secondary">
              The cashier/pharmacist on this register is recorded on the dispense automatically.
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={start}>Start dispense</Button>
      </DialogActions>
    </Dialog>
  );
}
