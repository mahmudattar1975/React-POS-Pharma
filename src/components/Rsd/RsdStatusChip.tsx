// One invoice's RSD state, as a chip. RSD is unit-level, so a multi-pack invoice can be partly
// accepted and partly queued; the tooltip carries the counts and the label only claims what is
// true for the whole invoice.
import { Chip, Tooltip, Typography } from '@mui/material';
import type { RsdInvoiceSummary } from '../../utils/rsdOutbox';

export default function RsdStatusChip({ summary }: { summary: RsdInvoiceSummary }) {
  if (summary.state === 'none') {
    return (
      <Typography variant="caption" color="text.secondary">
        —
      </Typography>
    );
  }

  const label =
    summary.state === 'sent'
      ? 'Sent'
      : summary.state === 'queued'
        ? `${summary.pending} queued`
        : `${summary.rejected} rejected`;
  const color = summary.state === 'sent' ? 'success' : summary.state === 'queued' ? 'warning' : 'error';
  const help = `${summary.sent} sent · ${summary.pending} queued · ${summary.rejected} rejected — ${summary.total} unit${
    summary.total === 1 ? '' : 's'
  }`;

  return (
    <Tooltip title={help}>
      <Chip size="small" color={color} label={label} variant="outlined" />
    </Tooltip>
  );
}
