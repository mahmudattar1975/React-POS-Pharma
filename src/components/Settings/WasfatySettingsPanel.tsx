// Settings > Wasfaty: the one place that answers "which NUPCO connector is this installation
// using, is it configured, and what exactly is it allowed to do?".
//
// The panel never invents an endpoint. It reports the server adapter's capability flags and, when a
// direct/hub contract is absent, lists the operations the contract file must provide before a live
// connection can be turned on. That is the honest boundary between Phase 0 (manual/mock, fully
// working today) and live NUPCO onboarding.
import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import LocalPharmacyOutlinedIcon from '@mui/icons-material/LocalPharmacyOutlined';
import { useCatalogStore } from '../../store/catalogStore';
import { wasfatyCoverage } from '../../utils/wasfaty';
import * as wasfatyApi from '../../api/wasfatyApi';

import { T, useT } from '../../i18n';
export default function WasfatySettingsPanel() {
  const tr = useT();
  const items = useCatalogStore((s) => s.items);
  const coverage = wasfatyCoverage(items);
  const [health, setHealth] = useState<wasfatyApi.WasfatyHealth | null>(null);
  const [state, setState] = useState<{ loading: boolean; error?: string }>({ loading: false });

  async function check() {
    setState({ loading: true });
    try {
      const result = await wasfatyApi.getWasfatyHealth();
      setHealth(result);
      setState({ loading: false });
    } catch (err) {
      setHealth(null);
      setState({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  useEffect(() => {
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capabilityRows = health
    ? [
        { name: 'Prescription lookup', value: health.capabilities.lookupPrescription },
        { name: 'Authorization request', value: health.capabilities.requestAuthorization },
        { name: 'Dispense submission', value: health.capabilities.submitDispense },
        { name: 'Claim submission', value: health.capabilities.submitClaim },
      ]
    : [];

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.5 }}>
          <LocalPharmacyOutlinedIcon color="primary" />
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}><T>Wasfaty / NUPCO connector</T></Typography>
            <Typography variant="caption" color="text.secondary">
              <T>Provider-neutral adapter: manual (Phase 0) · NUPCO simulator · direct · approved hub</T>
            </Typography>
          </Box>
          <Button size="small" startIcon={<RefreshIcon />} onClick={check} disabled={state.loading}>
            {state.loading ? tr("Checking…") : tr("Check connection")}
          </Button>
        </Stack>

        {state.error ? (
          <Alert severity="warning">
            <T>Wasfaty server not reachable:</T> {state.error}<T>. The POS still records manual dispenses
            locally, and they queue for retry.</T>
          </Alert>
        ) : !health ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={16} />
            <Typography variant="body2" color="text.secondary"><T>Checking the Wasfaty adapter…</T></Typography>
          </Box>
        ) : (
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              <Chip size="small" variant="outlined" label={`Provider: ${health.provider}`} />
              <Chip
                size="small"
                color={health.configured ? 'success' : 'warning'}
                variant={health.configured ? 'filled' : 'outlined'}
                label={health.configured ? 'Configured' : 'Not configured'}
              />
              <Chip size="small" variant="outlined" label={`Environment: ${health.environment}`} />
              <Chip size="small" variant="outlined" label={`Checked ${new Date(health.checkedAt).toLocaleTimeString()}`} />
            </Stack>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell><T>Capability</T></TableCell>
                  <TableCell align="right"><T>Available</T></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {capabilityRows.map((row) => (
                  <TableRow key={row.name}>
                    <TableCell>{row.name}</TableCell>
                    <TableCell align="right">
                      <Chip size="small" color={row.value ? 'success' : 'default'} variant="outlined" label={row.value ? 'Yes' : 'No'} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {health.contract && health.contract.source !== 'none' && (
              <Typography variant="caption" color="text.secondary">
                <T>Contract:</T> {health.contract.source}
                {health.contract.version ? `${tr(" · v")}${health.contract.version}` : ''}
                {health.contract.baseUrl ? ` · ${health.contract.baseUrl}` : ''}
              </Typography>
            )}
            {health.contract?.missingOperations && health.contract.missingOperations.length > 0 && (
              <Alert severity="info">
                <T>The contract is missing:</T> {health.contract.missingOperations.join(', ')}<T>. Live
                dispense/claim submission stays disabled until NUPCO supplies them.</T>
              </Alert>
            )}
          </Stack>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}><T>Catalogue coverage</T></Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          <T>Only mapped items can be dispensed. An eligible-but-unmapped item is blocked at the POS
          with a link to Inventory → Wasfaty mapping.</T>
        </Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          <Chip size="small" variant="outlined" label={`${coverage.total} active items`} />
          <Chip size="small" variant="outlined" color="success" label={`${coverage.mapped} mapped`} />
          <Chip size="small" variant="outlined" color="info" label={`${coverage.eligible} on the Wasfaty list`} />
          <Chip
            size="small"
            color={coverage.unmappedEligible > 0 ? 'warning' : 'default'}
            variant={coverage.unmappedEligible > 0 ? 'filled' : 'outlined'}
            label={`${coverage.unmappedEligible} need a code`}
          />
          <Chip size="small" variant="outlined" color="primary" label={`${coverage.percent}% coverage`} />
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}><T>What NUPCO still has to provide</T></Typography>
        <Typography variant="body2" color="text.secondary" component="div">
          <T>NUPCO publishes no public Wasfaty API contract, sandbox or self-service credentials, so
          the live adapter is contract-file driven and fails closed. Before switching to</T>
          <code> <T>direct</T> </code><T>or</T><code> <T>hub</T></code><T>, obtain and record:</T>
        </Typography>
        <Box component="ol" sx={{ pl: 2.5, my: 1 }}>
          {[
            tr("Base URL per environment (test / production), with an approved IP allow-list."),
            tr("Authentication scheme (OAuth2 client credentials, mutual TLS, or API key), token lifetime and rotation."),
            tr("Prescription lookup operation: path, method, request fields, response fields and error codes."),
            tr("Authorization operation (request + status) and the meaning of partial/rejected lines."),
            tr("Dispense submission/cancellation operations, including idempotency keys and duplicate handling."),
            tr("Claim submission and month-close reconciliation operations, plus the paid/variance fields."),
            tr("Rate limits, retry/backoff rules, and the supported Saudi business calendar for claim cut-offs."),
            tr("Written confirmation of patient-data handling under PDPL and of the 13-digit item-code list."),
          ].map((line) => (
            <Typography key={line} component="li" variant="body2" sx={{ mb: 0.5 }}>{line}</Typography>
          ))}
        </Box>
        <Typography variant="caption" color="text.secondary">
          <T>Full contract checklist and the complete API surface: see</T> <strong><T>Wasfaty-API.md</T></strong> <T>and</T>
          <strong> <T>Wasfaty.md</T></strong> <T>in the</T> <code><T>.mdfile/</T></code> <T>folder.</T>
        </Typography>
      </Paper>
    </Stack>
  );
}
