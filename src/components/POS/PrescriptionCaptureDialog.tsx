import { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Stack, Typography, Chip,
  ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import type { PrescriptionInfo, PrescriptionSource } from '../../types/sales';
import { CONTROLLED_STATUS_LABEL } from '../../utils/controlledSubstances';
import type { ControlledStatus } from '../../types/catalog';

interface ControlledLine {
  itemNameEn: string;
  controlledStatus: ControlledStatus;
}

interface Props {
  open: boolean;
  lines: ControlledLine[];
  patientNationalId?: string; // pre-filled from the selected customer's national ID, if known
  onCancel: () => void;
  onConfirm: (info: PrescriptionInfo) => void;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Captures the exact 4 fields SFDA's real RASD "Pharmacy Sale" protocol requires per transaction
// (see types/sales.ts's PrescriptionInfo) before a cart containing a prescription/controlled item
// can check out - this app doesn't report to SFDA (or Wasfaty) electronically yet, but the record
// is captured and retained on the invoice now so it's ready if/when that reporting is built.
export default function PrescriptionCaptureDialog({ open, lines, patientNationalId, onCancel, onConfirm }: Props) {
  const [source, setSource] = useState<PrescriptionSource>('private');
  const [wasfatyReferenceNo, setWasfatyReferenceNo] = useState('');
  const [prescriberName, setPrescriberName] = useState('');
  const [prescriberId, setPrescriberId] = useState('');
  const [prescriptionId, setPrescriptionId] = useState('');
  const [prescriptionDate, setPrescriptionDate] = useState(today());
  const [nationalId, setNationalId] = useState('');

  useEffect(() => {
    if (open) {
      setSource('private');
      setWasfatyReferenceNo('');
      setPrescriberName('');
      setPrescriberId('');
      setPrescriptionId('');
      setPrescriptionDate(today());
      setNationalId(patientNationalId ?? '');
    }
  }, [open, patientNationalId]);

  const valid =
    prescriberName.trim() &&
    prescriptionId.trim() &&
    prescriptionDate &&
    /^\d{10}$/.test(nationalId.trim()) &&
    (source === 'private' || wasfatyReferenceNo.trim());

  function confirm() {
    if (!valid) return;
    onConfirm({
      source,
      wasfatyReferenceNo: source === 'wasfaty' ? wasfatyReferenceNo.trim() : undefined,
      prescriberName: prescriberName.trim(),
      prescriberId: prescriberId.trim() || undefined,
      prescriptionId: prescriptionId.trim(),
      prescriptionDate,
      patientNationalId: nationalId.trim(),
    });
  }

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="xs">
      <DialogTitle>Prescription Required</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <Stack spacing={0.75}>
            <Typography variant="body2" color="text.secondary">This sale includes:</Typography>
            <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.75 }}>
              {lines.map((l, i) => (
                <Chip key={i} size="small" color="warning" label={`${l.itemNameEn} · ${CONTROLLED_STATUS_LABEL[l.controlledStatus]}`} />
              ))}
            </Stack>
          </Stack>

          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={source}
            onChange={(_, v: PrescriptionSource | null) => v && setSource(v)}
          >
            <ToggleButton value="private">Private Prescription</ToggleButton>
            <ToggleButton value="wasfaty">Wasfaty (وصفتي)</ToggleButton>
          </ToggleButtonGroup>

          {source === 'wasfaty' && (
            <TextField
              label="Wasfaty reference number"
              fullWidth
              value={wasfatyReferenceNo}
              onChange={(e) => setWasfatyReferenceNo(e.target.value)}
              helperText="From the patient's Wasfaty e-prescription - recorded for this pharmacy's own reference only, not yet verified electronically against Wasfaty."
            />
          )}

          <TextField label="Prescriber name" fullWidth value={prescriberName} onChange={(e) => setPrescriberName(e.target.value)} />
          <TextField label="Prescriber ID / license (optional)" fullWidth value={prescriberId} onChange={(e) => setPrescriberId(e.target.value)} />
          <TextField label="Prescription number" fullWidth value={prescriptionId} onChange={(e) => setPrescriptionId(e.target.value)} />
          <TextField
            label="Prescription date"
            type="date"
            fullWidth
            value={prescriptionDate}
            onChange={(e) => setPrescriptionDate(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="Patient national ID / Iqama"
            fullWidth
            value={nationalId}
            onChange={(e) => setNationalId(e.target.value.replace(/[^\d]/g, ''))}
            error={nationalId.length > 0 && !/^\d{10}$/.test(nationalId)}
            helperText="10 digits, required for the pharmacy's prescription registry."
            slotProps={{ htmlInput: { maxLength: 10, inputMode: 'numeric' } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="contained" disabled={!valid} onClick={confirm}>Continue to Payment</Button>
      </DialogActions>
    </Dialog>
  );
}
