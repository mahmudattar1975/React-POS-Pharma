// NUPCO mapping audit trail.
//
// The mapping is financial data: it decides whether an item is covered by Wasfaty and what the
// claim is worth. The item row only keeps the current value, so this panel answers the questions an
// auditor actually asks - who changed this item, when, from what to what, and was it a manual edit
// or a bulk import.
//
// Newest first, and collapsed by default so the mapping table stays the focus of the screen.
import { useMemo, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Box, Chip, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HistoryIcon from '@mui/icons-material/History';
import { useCatalogStore } from '../../store/catalogStore';
import type { WasfatyMappingSnapshot } from '../../types/wasfaty';
import { formatSar } from '../../utils/format';

const VISIBLE_LIMIT = 50;

function snapshotText(snapshot: WasfatyMappingSnapshot): string {
  const code = snapshot.nupcoCode || 'No code';
  const price = snapshot.wasfatyPrice === undefined ? 'sale price' : formatSar(snapshot.wasfatyPrice);
  const eligible = snapshot.wasfatyEligible ? 'on list' : 'not on list';
  return `${code} · ${price} · ${eligible}`;
}

export default function WasfatyMappingHistory() {
  const log = useCatalogStore((s) => s.wasfatyMappingLog);
  const [showAll, setShowAll] = useState(false);

  // The store keeps the oldest entry first so it can be trimmed from the front; the UI reads it the
  // other way round, because "what changed most recently" is the question being asked.
  const entries = useMemo(() => [...log].reverse(), [log]);
  const visible = showAll ? entries : entries.slice(0, VISIBLE_LIMIT);

  return (
    <Accordion variant="outlined" sx={{ mt: 3 }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <HistoryIcon fontSize="small" color="action" />
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Mapping history</Typography>
          <Chip size="small" variant="outlined" label={`${entries.length} change(s)`} />
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          Every real change to a NUPCO code, approved price or Wasfaty eligibility is recorded with
          who made it. Re-saving an unchanged row is not logged. The newest {VISIBLE_LIMIT} are shown
          first; the log keeps the last 500 changes.
        </Typography>

        {entries.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
            No mapping changes yet.
          </Typography>
        ) : (
          <>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>When</TableCell>
                    <TableCell>Who</TableCell>
                    <TableCell>Item</TableCell>
                    <TableCell>Before</TableCell>
                    <TableCell>After</TableCell>
                    <TableCell>Source</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {visible.map((entry) => (
                    <TableRow key={entry.id} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 12 }}>
                        {entry.at.replace('T', ' ').slice(0, 16)}
                      </TableCell>
                      <TableCell>{entry.by}</TableCell>
                      <TableCell sx={{ minWidth: 200 }}>
                        <Typography variant="body2">{entry.itemNameEn}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          #{entry.itemNo ?? '—'}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ fontSize: 12 }}>{snapshotText(entry.before)}</TableCell>
                      <TableCell sx={{ fontSize: 12 }}>{snapshotText(entry.after)}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          variant="outlined"
                          color={entry.source === 'import' ? 'info' : 'default'}
                          label={entry.source === 'import' ? 'Import' : 'Manual'}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {entries.length > VISIBLE_LIMIT && (
              <Box sx={{ mt: 1 }}>
                <Chip
                  size="small"
                  variant="outlined"
                  label={showAll ? `Show latest ${VISIBLE_LIMIT}` : `Show all ${entries.length}`}
                  onClick={() => setShowAll((value) => !value)}
                />
              </Box>
            )}
          </>
        )}
      </AccordionDetails>
    </Accordion>
  );
}
