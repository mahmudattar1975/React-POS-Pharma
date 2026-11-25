// Prescription registry screen (represcription.md §7, Phase 1): search what the pharmacy has on
// file, see how much of each prescription remains and how many refills are left, and read the
// dispense history behind it. Until now that history only existed as separate invoices.
import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Paper,
  Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import type { Prescription } from '../../types/prescriptions';
import { usePrescriptionStore } from '../../store/prescriptionStore';
import { useSettingsStore } from '../../store/settingsStore';
import {
  lineRemaining, prescriptionSummary, refillsLeft, statusFor, withStatus,
} from '../../utils/prescriptionRules';
import { PRESCRIPTION_STATUS_COLOR, PRESCRIPTION_STATUS_LABEL } from '../../utils/prescriptionStatus';
import { buildPrescriptionLabels, type PrescriptionLabel } from '../../utils/prescriptionLabel';
import { buildDosageLabel } from '../../utils/dosages';
import { formatQty } from '../../utils/format';
import { maskNationalId } from '../../utils/wasfaty';
import PrescriptionLabelDialog from './PrescriptionLabelDialog';

import { T, useT } from '../../i18n';
function statusOf(rx: Prescription): Prescription['status'] {
  return rx.status === 'cancelled' || rx.status === 'blocked' ? rx.status : statusFor(rx);
}

function StatusChip({ rx }: { rx: Prescription }) {
  const tr = useT();
  const status = statusOf(rx);
  return <Chip size="small" label={tr(PRESCRIPTION_STATUS_LABEL[status])} color={PRESCRIPTION_STATUS_COLOR[status]} />;
}

export default function PrescriptionsPage() {
  const tr = useT();
  const prescriptions = usePrescriptionStore((s) => s.prescriptions);
  const setStatus = usePrescriptionStore((s) => s.setStatus);
  const settings = useSettingsStore((s) => s.settings);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [labels, setLabels] = useState<PrescriptionLabel[]>([]);

  // Statuses are recomputed at read time: a record captured 40 days ago is expired today even if
  // it was stored as 'active'. Cancelled/blocked stay exactly as the pharmacy set them.
  const rows = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    return prescriptions
      .map((rx) => withStatus(rx))
      .filter((rx) => {
        if (!wanted) return true;
        return (
          rx.prescriptionNo.toLowerCase().includes(wanted) ||
          rx.patientNationalId.includes(wanted) ||
          (rx.patientName?.toLowerCase().includes(wanted) ?? false) ||
          (rx.wasfatyReferenceNo?.toLowerCase().includes(wanted) ?? false)
        );
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [prescriptions, query]);

  const selected = rows.find((rx) => rx.id === selectedId) ?? null;
  const counts = useMemo(() => {
    const byStatus = { active: 0, partially_dispensed: 0, dispensed: 0, expired: 0, cancelled: 0, blocked: 0 };
    rows.forEach((rx) => { byStatus[statusOf(rx)] += 1; });
    return byStatus;
  }, [rows]);

  function closeDetail() {
    setSelectedId(null);
    setConfirmCancel(false);
  }

  function openLabels(rx: Prescription) {
    setLabels(
      buildPrescriptionLabels({
        prescription: rx,
        store: {
          nameEn: settings.storeNameEn,
          nameAr: settings.storeNameAr,
          address: settings.address,
          phone: settings.storePhone,
        },
      }),
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}><T>Prescriptions</T></Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        <T>Every prescription on file, its remaining quantity and refills, and the invoices that
        dispensed it. Captured at the POS when a controlled or prescription-only item is sold.</T>
      </Typography>

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, mb: 2 }}>
        <Chip size="small" variant="outlined" label={`${rows.length} prescription(s)`} />
        <Chip size="small" variant="outlined" color="success" label={`${counts.active} active`} />
        <Chip size="small" variant="outlined" color="info" label={`${counts.partially_dispensed} partially dispensed`} />
        <Chip size="small" variant="outlined" label={`${counts.expired} expired`} />
        <Chip size="small" variant="outlined" label={`${counts.dispensed} dispensed`} />
      </Stack>

      <TextField
        size="small"
        placeholder={tr('Search prescription no. / national ID / patient name / Wasfaty ref.')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        sx={{ mb: 2, width: { xs: '100%', md: 480 } }}
        slotProps={{ input: { startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> } }}
      />

      {rows.length === 0 ? (
        <Alert severity="info">
          {prescriptions.length === 0
            ? tr("No prescriptions captured yet. The next sale containing a prescription-only or controlled item will create one.")
            : tr("No prescription matches this search.")}
        </Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell><T>Prescription</T></TableCell>
                <TableCell><T>Patient</T></TableCell>
                <TableCell><T>Prescriber</T></TableCell>
                <TableCell><T>Issued / expires</T></TableCell>
                <TableCell align="right"><T>Items</T></TableCell>
                <TableCell align="right"><T>Remaining</T></TableCell>
                <TableCell align="right"><T>Refills left</T></TableCell>
                <TableCell><T>Last dispense</T></TableCell>
                <TableCell><T>Status</T></TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((rx) => {
                const summary = prescriptionSummary(rx);
                return (
                  <TableRow key={rx.id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600, direction: 'ltr', unicodeBidi: 'isolate' }}>{rx.prescriptionNo}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {rx.source === 'wasfaty' ? `${tr("Wasfaty ")}${rx.wasfatyReferenceNo ?? ''}`.trim() : tr("Private")}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{rx.patientName ?? tr("Patient")}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                        {maskNationalId(rx.patientNationalId)}
                      </Typography>
                    </TableCell>
                    <TableCell>{rx.prescriberName}</TableCell>
                    <TableCell>
                      <Typography variant="body2">{rx.issuedDate}</Typography>
                      <Typography variant="caption" color="text.secondary">{rx.expiryDate}</Typography>
                    </TableCell>
                    <TableCell align="right">{summary.lineCount}</TableCell>
                    <TableCell align="right">{formatQty(summary.remaining)}</TableCell>
                    <TableCell align="right">{summary.refillsLeft}</TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {summary.lastDispensedAt ? summary.lastDispensedAt.slice(0, 10) : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell><StatusChip rx={rx} /></TableCell>
                    <TableCell align="right">
                      <Button size="small" aria-label={`View ${rx.prescriptionNo}`} onClick={() => setSelectedId(rx.id)}>
                        <T>View</T>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={!!selected} onClose={closeDetail} fullWidth maxWidth="md">
        {selected && (
          <>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              {selected.prescriptionNo}
              <StatusChip rx={selected} />
              <Chip size="small" variant="outlined" label={selected.source === 'wasfaty' ? 'Wasfaty' : 'Private'} />
            </DialogTitle>
            <DialogContent>
              <Stack spacing={2}>
                <Box>
                  <Typography variant="body2">
                    <strong><T>Patient:</T></strong> {selected.patientName ?? tr("Patient")} ({maskNationalId(selected.patientNationalId)})
                  </Typography>
                  <Typography variant="body2"><strong><T>Prescriber:</T></strong> {selected.prescriberName}{selected.prescriberId ? ` · ${selected.prescriberId}` : ''}</Typography>
                  <Typography variant="body2"><strong><T>Issued:</T></strong> {selected.issuedDate} · <strong><T>Expires:</T></strong> {selected.expiryDate}</Typography>
                  {selected.wasfatyReferenceNo && (
                    <Typography variant="body2"><strong><T>Wasfaty reference:</T></strong> {selected.wasfatyReferenceNo}</Typography>
                  )}
                  <Typography variant="body2"><strong><T>Captured:</T></strong> {selected.createdAt.slice(0, 10)} <T>by</T> {selected.createdBy}</Typography>
                </Box>

                <Divider />
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}><T>Items</T></Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell><T>Item</T></TableCell>
                      <TableCell align="right"><T>Prescribed</T></TableCell>
                      <TableCell align="right"><T>Dispensed</T></TableCell>
                      <TableCell align="right"><T>Remaining</T></TableCell>
                      <TableCell align="right"><T>Refills left</T></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selected.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell>
                          <Typography variant="body2">{line.itemNameEn}</Typography>
                          <Typography variant="caption" color="text.secondary">{line.itemNameAr}</Typography>
                          {line.dosage ? (
                            <>
                              <Typography variant="caption" sx={{ display: 'block', mt: 0.25 }}>
                                {buildDosageLabel(line.dosage).labelEn || '—'}
                                {line.dosage.durationDays ? ` · ${line.dosage.durationDays}${tr(" day(s)")}` : ''}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                dir="rtl"
                                sx={{ display: 'block', textAlign: 'left' }}
                              >
                                {buildDosageLabel(line.dosage).labelAr}
                              </Typography>
                            </>
                          ) : (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                              <T>No written directions</T>
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">{formatQty(line.quantityPrescribed)} {line.unit}</TableCell>
                        <TableCell align="right">{formatQty(line.quantityDispensed)}</TableCell>
                        <TableCell align="right">{formatQty(lineRemaining(line))}</TableCell>
                        <TableCell align="right">{refillsLeft(line)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <Divider />
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}><T>Dispense history</T></Typography>
                {selected.dispenseEvents.length === 0 ? (
                  <Typography variant="body2" color="text.secondary"><T>Nothing dispensed yet.</T></Typography>
                ) : (
                  <Stack spacing={1}>
                    {selected.dispenseEvents.map((event) => (
                      <Paper key={event.id} variant="outlined" sx={{ p: 1.25 }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{event.invoiceNo}</Typography>
                          <Chip size="small" variant="outlined" label={event.dispensedAt.slice(0, 10)} />
                          <Typography variant="caption" color="text.secondary"><T>by</T> {event.dispensedBy}</Typography>
                        </Stack>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                          {event.lines.map((line) => {
                            const rxLine = selected.lines.find((candidate) => candidate.id === line.prescriptionLineId);
                            return `${rxLine?.itemNameEn ?? line.itemId}: ${formatQty(line.qty)} ${line.unit}`;
                          }).join(' · ')}
                        </Typography>
                        {event.overrideReason && (
                          <Alert severity="warning" sx={{ mt: 1 }}>
                            <T>Dispensed with override:</T> {event.overrideReason}
                          </Alert>
                        )}
                      </Paper>
                    ))}
                  </Stack>
                )}
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5, gap: 1, flexWrap: 'wrap' }}>
              {selected.status !== 'cancelled' && selected.status !== 'blocked' && (
                <Button color="warning" onClick={() => setStatus(selected.id, 'blocked')}><T>Block</T></Button>
              )}
              {selected.status === 'blocked' && (
                <Button onClick={() => setStatus(selected.id, statusOf(selected) === 'expired' ? 'expired' : 'active')}><T>Unblock</T></Button>
              )}
              {selected.status !== 'cancelled' && (
                <Button color="error" onClick={() => setConfirmCancel(true)}><T>Cancel prescription</T></Button>
              )}
              <Box sx={{ flex: 1 }} />
              <Button variant="outlined" onClick={() => openLabels(selected)}>
                <T>Print labels</T>
              </Button>
              <Button onClick={closeDetail}><T>Close</T></Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      <PrescriptionLabelDialog
        open={labels.length > 0}
        labels={labels}
        batchKey={labels[0]?.key}
        onClose={() => setLabels([])}
      />

      <Dialog open={confirmCancel} onClose={() => setConfirmCancel(false)} maxWidth="xs" fullWidth>
        <DialogTitle><T>Cancel this prescription?</T></DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {selected?.prescriptionNo} <T>will be marked cancelled and can never be dispensed again.
            Its dispense history stays on record. This cannot be undone.</T>
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmCancel(false)}><T>Keep it</T></Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              if (selected) setStatus(selected.id, 'cancelled');
              closeDetail();
            }}
          >
            <T>Cancel prescription</T>
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
