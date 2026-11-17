// Prescription capture at the counter - now backed by the prescription registry
// (see .mdfile/represcription.md §8).
//
// Two ways in, because both happen at a real pharmacy:
//   • "Find existing" - the patient brings a prescription already on file; the cashier searches by
//     number / national ID / Wasfaty reference, sees what remains and how many refills are left,
//     and dispenses against it (partially if needed).
//   • "New prescription" - nothing on file yet; the header and the per-item quantity/refills are
//     captured, creating the registry record that later fills will reuse.
//
// The gate itself lives in utils/prescriptionRules.ts (planDispense), so the dialog only displays
// what those rules say. An expired/blocked prescription requires a written override reason, which
// travels with the dispense event.
import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import type { PrescriptionInfo, PrescriptionSource } from '../../types/sales';
import type { ControlledStatus } from '../../types/catalog';
import type { Prescription } from '../../types/prescriptions';
import { CONTROLLED_STATUS_LABEL } from '../../utils/controlledSubstances';
import { PRESCRIPTION_STATUS_COLOR, PRESCRIPTION_STATUS_LABEL } from '../../utils/prescriptionStatus';
import { maskNationalId } from '../../utils/wasfaty';
import {
  DEFAULT_VALIDITY_DAYS, expiryFor, lineRemaining, planDispense, refillsLeft, statusFor,
  supplyWarnings, todayIso, type DispenseRequest,
} from '../../utils/prescriptionRules';
import { usePrescriptionStore } from '../../store/prescriptionStore';
import { useAuthStore } from '../../store/authStore';

export interface ControlledLine {
  itemId: string;
  itemNameEn: string;
  itemNameAr: string;
  unit: string;
  qty: number; // what the cart actually holds - the default quantity to dispense/prescribe
  controlledStatus: ControlledStatus;
}

export interface PrescriptionCaptureResult {
  info: PrescriptionInfo;
  registryId: string;
  // Exactly what this checkout dispenses, per registry line. Built from the gate's plan so the
  // invoice and the registry can never disagree about the quantity.
  dispenseLines: {
    prescriptionLineId: string;
    itemId: string;
    qty: number;
    unit: string;
  }[];
  overrideReason?: string;
}

interface Props {
  open: boolean;
  lines: ControlledLine[];
  patientNationalId?: string;
  patientName?: string;
  onCancel: () => void;
  onConfirm: (result: PrescriptionCaptureResult) => void;
}

function today(): string {
  return todayIso();
}

const STATUS_LABEL = PRESCRIPTION_STATUS_LABEL;
const STATUS_COLOR = PRESCRIPTION_STATUS_COLOR;

export default function PrescriptionCaptureDialog({
  open, lines, patientNationalId, patientName, onCancel, onConfirm,
}: Props) {
  const prescriptions = usePrescriptionStore((s) => s.prescriptions);
  const addPrescription = usePrescriptionStore((s) => s.addPrescription);
  const searchPrescriptions = usePrescriptionStore((s) => s.search);
  const cashierName = useAuthStore((s) => s.session?.fullName) ?? 'cashier';

  const [mode, setMode] = useState<'existing' | 'new'>('new');
  // ---- new prescription form ------------------------------------------------------------------
  const [source, setSource] = useState<PrescriptionSource>('private');
  const [wasfatyReferenceNo, setWasfatyReferenceNo] = useState('');
  const [prescriberName, setPrescriberName] = useState('');
  const [prescriberId, setPrescriberId] = useState('');
  const [prescriptionId, setPrescriptionId] = useState('');
  const [prescriptionDate, setPrescriptionDate] = useState(today());
  const [nationalId, setNationalId] = useState('');
  const [qtyByItem, setQtyByItem] = useState<Record<string, number>>({});
  const [refillsByItem, setRefillsByItem] = useState<Record<string, number>>({});
  // ---- existing prescription ------------------------------------------------------------------
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dispenseQty, setDispenseQty] = useState<Record<string, number>>({});
  const [overrideReason, setOverrideReason] = useState('');

  useEffect(() => {
    if (!open) return;
    setMode('new');
    setSource('private');
    setWasfatyReferenceNo('');
    setPrescriberName('');
    setPrescriberId('');
    setPrescriptionId('');
    setPrescriptionDate(today());
    setNationalId(patientNationalId ?? '');
    setQtyByItem(Object.fromEntries(lines.map((line) => [line.itemId, line.qty])));
    setRefillsByItem(Object.fromEntries(lines.map((line) => [line.itemId, 0])));
    setQuery('');
    setSelectedId(null);
    setDispenseQty({});
    setOverrideReason('');
  }, [open, patientNationalId, lines]);

  const results = useMemo(
    () => (query.trim() ? searchPrescriptions(query).slice().reverse().slice(0, 6) : prescriptions.slice().reverse().slice(0, 6)),
    [query, prescriptions, searchPrescriptions],
  );

  const selected = prescriptions.find((rx) => rx.id === selectedId) ?? null;

  // Every cart item must be on the selected prescription: dispensing a controlled item that the
  // prescriber did not write is exactly what the registry exists to prevent.
  const unmatched = useMemo(() => {
    if (!selected) return [];
    return lines.filter((line) => !selected.lines.some((rxLine) => rxLine.itemId === line.itemId));
  }, [lines, selected]);

  const requests: DispenseRequest[] = useMemo(() => {
    if (!selected) return [];
    return lines
      .map((line) => {
        const rxLine = selected.lines.find((candidate) => candidate.itemId === line.itemId);
        if (!rxLine) return null;
        return { prescriptionLineId: rxLine.id, qty: dispenseQty[rxLine.id] ?? line.qty };
      })
      .filter((request): request is DispenseRequest => request !== null);
  }, [lines, selected, dispenseQty]);

  const plan = useMemo(
    () => (selected ? planDispense(selected, requests, { overrideReason, today: today() }) : null),
    [selected, requests, overrideReason],
  );

  const newLineWarnings = useMemo(
    () =>
      supplyWarnings(
        lines.map((line) => ({
          id: line.itemId,
          itemId: line.itemId,
          itemNameEn: line.itemNameEn,
          itemNameAr: line.itemNameAr,
          unit: line.unit,
          quantityPrescribed: qtyByItem[line.itemId] ?? line.qty,
          quantityDispensed: 0,
          refillsAuthorized: refillsByItem[line.itemId] ?? 0,
        })),
      ),
    [lines, qtyByItem, refillsByItem],
  );

  const headerValid =
    prescriberName.trim() !== '' &&
    prescriptionId.trim() !== '' &&
    prescriptionDate !== '' &&
    /^\d{10}$/.test(nationalId.trim()) &&
    (source === 'private' || wasfatyReferenceNo.trim() !== '');

  // A prescription dated more than 30 days back is already expired when it is captured - the gate
  // must apply here too, not only when an older record is reused.
  const newExpired = prescriptionDate !== '' && expiryFor(prescriptionDate) < today();

  const canConfirm =
    mode === 'new'
      ? headerValid &&
        lines.every((line) => (qtyByItem[line.itemId] ?? line.qty) > 0) &&
        (!newExpired || overrideReason.trim() !== '')
      : !!selected && !!plan?.ok && unmatched.length === 0;

  function infoFromPrescription(rx: Prescription): PrescriptionInfo {
    return {
      source: rx.source,
      wasfatyReferenceNo: rx.wasfatyReferenceNo,
      prescriberName: rx.prescriberName,
      prescriberId: rx.prescriberId,
      prescriptionId: rx.prescriptionNo,
      prescriptionDate: rx.issuedDate,
      patientNationalId: rx.patientNationalId,
      registryId: rx.id,
    };
  }

  function confirm() {
    if (!canConfirm) return;
    if (mode === 'new') {
      const rx = addPrescription({
        prescriptionNo: prescriptionId,
        source,
        wasfatyReferenceNo: source === 'wasfaty' ? wasfatyReferenceNo : undefined,
        patientNationalId: nationalId,
        patientName,
        prescriberId: prescriberId.trim() || undefined,
        prescriberName,
        issuedDate: prescriptionDate,
        lines: lines.map((line) => ({
          itemId: line.itemId,
          itemNameEn: line.itemNameEn,
          itemNameAr: line.itemNameAr,
          unit: line.unit,
          quantityPrescribed: qtyByItem[line.itemId] ?? line.qty,
          refillsAuthorized: refillsByItem[line.itemId] ?? 0,
        })),
        createdBy: cashierName,
      });
      onConfirm({
        info: infoFromPrescription(rx),
        registryId: rx.id,
        dispenseLines: rx.lines.map((rxLine) => {
          const cartLine = lines.find((line) => line.itemId === rxLine.itemId)!;
          return {
            prescriptionLineId: rxLine.id,
            itemId: rxLine.itemId,
            qty: cartLine.qty,
            unit: rxLine.unit,
          };
        }),
        overrideReason: newExpired ? overrideReason.trim() || undefined : undefined,
      });
      return;
    }
    if (!selected || !plan?.ok) return;
    onConfirm({
      info: infoFromPrescription(selected),
      registryId: selected.id,
      dispenseLines: plan.lines.map((line) => ({
        prescriptionLineId: line.prescriptionLineId,
        itemId: line.itemId,
        qty: line.requested,
        unit: selected.lines.find((rxLine) => rxLine.id === line.prescriptionLineId)?.unit ?? 'unit',
      })),
      overrideReason: overrideReason.trim() || undefined,
    });
  }

  const selectedStatus = selected
    ? selected.status === 'cancelled' || selected.status === 'blocked'
      ? selected.status
      : statusFor(selected, today())
    : 'active';

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="sm">
      <DialogTitle>Prescription Required</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <Stack spacing={0.75}>
            <Typography variant="body2" color="text.secondary">This sale includes:</Typography>
            <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.75 }}>
              {lines.map((line, index) => (
                <Chip
                  key={index}
                  size="small"
                  color="warning"
                  label={`${line.itemNameEn} · ${CONTROLLED_STATUS_LABEL[line.controlledStatus]}`}
                />
              ))}
            </Stack>
          </Stack>

          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={mode}
            onChange={(_, value: 'existing' | 'new' | null) => value && setMode(value)}
          >
            <ToggleButton value="existing">Find existing prescription</ToggleButton>
            <ToggleButton value="new">New prescription</ToggleButton>
          </ToggleButtonGroup>

          {mode === 'existing' ? (
            <>
              <TextField
                label="Search prescription no. / national ID / Wasfaty ref."
                fullWidth
                size="small"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
              {results.length === 0 ? (
                <Alert severity="info">
                  No prescription found. Capture a new one instead — it will be filed in the registry
                  for the next fill.
                </Alert>
              ) : (
                <Stack spacing={1}>
                  {results.map((rx) => {
                    const isSelected = rx.id === selectedId;
                    return (
                      <Box
                        key={rx.id}
                        onClick={() => {
                          setSelectedId(rx.id);
                          setOverrideReason('');
                          setDispenseQty(Object.fromEntries(
                            rx.lines.map((rxLine) => {
                              const cartLine = lines.find((line) => line.itemId === rxLine.itemId);
                              return [rxLine.id, Math.min(cartLine?.qty ?? 0, lineRemaining(rxLine))];
                            }),
                          ));
                        }}
                        sx={{
                          p: 1.25,
                          border: '1px solid',
                          borderColor: isSelected ? 'primary.main' : 'divider',
                          borderRadius: 2,
                          cursor: 'pointer',
                          bgcolor: isSelected ? 'action.selected' : undefined,
                        }}
                      >
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{rx.prescriptionNo}</Typography>
                          <Chip size="small" label={STATUS_LABEL[rx.status]} color={STATUS_COLOR[rx.status]} />
                          <Chip size="small" variant="outlined" label={rx.source === 'wasfaty' ? 'Wasfaty' : 'Private'} />
                        </Stack>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          Patient {maskNationalId(rx.patientNationalId)} · {rx.lines.length} line(s) ·
                          {' '}{rx.prescriberName} · expires {rx.expiryDate}
                        </Typography>
                      </Box>
                    );
                  })}
                </Stack>
              )}

              {selected && (
                <>
                  <Divider />
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Dispense against {selected.prescriptionNo}</Typography>
                    <Chip size="small" label={STATUS_LABEL[selectedStatus]} color={STATUS_COLOR[selectedStatus]} />
                  </Stack>
                  {unmatched.length > 0 && (
                    <Alert severity="error">
                      Not on this prescription: {unmatched.map((line) => line.itemNameEn).join(', ')}.
                      Remove them from the cart or capture a new prescription.
                    </Alert>
                  )}
                  {selected.lines.map((rxLine) => {
                    const cartLine = lines.find((line) => line.itemId === rxLine.itemId);
                    if (!cartLine) return null;
                    return (
                      <Stack key={rxLine.id} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{rxLine.itemNameEn}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            Prescribed {rxLine.quantityPrescribed} {rxLine.unit}(s) × {1 + rxLine.refillsAuthorized} fill(s)
                            {' · '}remaining {lineRemaining(rxLine)} · refills left {refillsLeft(rxLine)}
                          </Typography>
                        </Box>
                        <TextField
                          label={`Dispense (${rxLine.unit})`}
                          type="number"
                          size="small"
                          sx={{ width: { xs: '100%', sm: 160 } }}
                          value={dispenseQty[rxLine.id] ?? ''}
                          onChange={(e) => {
                            const value = Number(e.target.value);
                            setDispenseQty((current) => ({ ...current, [rxLine.id]: Number.isFinite(value) ? value : 0 }));
                          }}
                          slotProps={{ htmlInput: { min: 0, max: lineRemaining(rxLine), step: 1 } }}
                          helperText={`Cart has ${cartLine.qty}`}
                        />
                      </Stack>
                    );
                  })}
                  {(selectedStatus === 'expired' || selectedStatus === 'blocked') && (
                    <TextField
                      label="Override reason (required)"
                      fullWidth
                      size="small"
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      helperText={`This prescription is ${STATUS_LABEL[selectedStatus].toLowerCase()}. The reason is stored on the dispense record.`}
                    />
                  )}
                  {plan && plan.errors.length > 0 && (
                    <Alert severity="error">
                      {plan.errors.map((error) => <div key={error}>{error}</div>)}
                    </Alert>
                  )}
                  {plan && plan.warnings.length > 0 && (
                    <Alert severity="warning">
                      {plan.warnings.map((warning) => <div key={warning}>{warning}</div>)}
                    </Alert>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <ToggleButtonGroup
                exclusive
                fullWidth
                size="small"
                value={source}
                onChange={(_, value: PrescriptionSource | null) => value && setSource(value)}
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
                helperText={`Valid for ${DEFAULT_VALIDITY_DAYS} days — expires ${prescriptionDate ? expiryFor(prescriptionDate) : '—'}.`}
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

              <Divider />
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Items on this prescription</Typography>
              {lines.map((line) => (
                <Stack key={line.itemId} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{line.itemNameEn}</Typography>
                    <Typography variant="caption" color="text.secondary">{line.itemNameAr}</Typography>
                  </Box>
                  <TextField
                    label={`Quantity (${line.unit})`}
                    type="number"
                    size="small"
                    sx={{ width: { xs: '100%', sm: 150 } }}
                    value={qtyByItem[line.itemId] ?? line.qty}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setQtyByItem((current) => ({ ...current, [line.itemId]: Number.isFinite(value) ? value : 0 }));
                    }}
                    slotProps={{ htmlInput: { min: 1, step: 1 } }}
                  />
                  <TextField
                    select
                    label="Refills"
                    size="small"
                    sx={{ width: { xs: '100%', sm: 110 } }}
                    value={refillsByItem[line.itemId] ?? 0}
                    onChange={(e) => setRefillsByItem((current) => ({ ...current, [line.itemId]: Number(e.target.value) }))}
                  >
                    <MenuItem value={0}>None</MenuItem>
                    <MenuItem value={1}>1 refill</MenuItem>
                    <MenuItem value={2}>2 refills</MenuItem>
                  </TextField>
                </Stack>
              ))}
              {newLineWarnings.length > 0 && (
                <Alert severity="warning">
                  {newLineWarnings.map((warning) => <div key={warning}>{warning}</div>)}
                </Alert>
              )}
              {newExpired && (
                <>
                  <Alert severity="warning">
                    This prescription expired on {expiryFor(prescriptionDate)}. Dispensing it needs a
                    written override reason, which is stored on the dispense record.
                  </Alert>
                  <TextField
                    label="Override reason (required)"
                    fullWidth
                    size="small"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    helperText="For example: prescriber confirmed by phone; patient already started treatment."
                  />
                </>
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="contained" disabled={!canConfirm} onClick={confirm}>Continue to Payment</Button>
      </DialogActions>
    </Dialog>
  );
}
