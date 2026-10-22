import { Box, Tooltip } from '@mui/material';
import type { CardNetwork } from '../../types/sales';

// Small, self-drawn badges rather than official logo assets - close enough to be instantly
// recognizable (the same purpose real POS terminals' network stickers serve) without pulling in
// trademarked brand artwork. Visa/Amex's own marks are essentially their wordmark typography, so a
// simplified colored wordmark badge is a fair representation of those; Mastercard's overlapping
// circles are reproduced as plain geometry, no logo asset needed.
const NETWORKS: { id: CardNetwork; label: string }[] = [
  { id: 'mada', label: 'mada' },
  { id: 'visa', label: 'Visa' },
  { id: 'mastercard', label: 'Mastercard' },
  { id: 'amex', label: 'American Express' },
];

const BADGE_SX = {
  width: 46,
  height: 30,
  borderRadius: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  border: '2px solid transparent',
  transition: 'border-color 120ms, transform 120ms',
} as const;

function NetworkBadge({ network }: { network: CardNetwork }) {
  switch (network) {
    case 'mada':
      return (
        <Box sx={{ width: '100%', height: '100%', bgcolor: '#1B7B4B', borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Box component="span" sx={{ color: '#fff', fontWeight: 800, fontSize: 12, letterSpacing: 0.5 }}>mada</Box>
        </Box>
      );
    case 'visa':
      return (
        <Box sx={{ width: '100%', height: '100%', bgcolor: '#fff', border: '1px solid #d0d0d0', borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Box component="span" sx={{ color: '#1A1F71', fontWeight: 900, fontStyle: 'italic', fontSize: 13, letterSpacing: 0.5 }}>VISA</Box>
        </Box>
      );
    case 'mastercard':
      return (
        <Box sx={{ width: '100%', height: '100%', bgcolor: '#fff', border: '1px solid #d0d0d0', borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Box sx={{ position: 'relative', width: 26, height: 16 }}>
            <Box sx={{ position: 'absolute', left: 0, width: 16, height: 16, borderRadius: '50%', bgcolor: '#EB001B' }} />
            <Box sx={{ position: 'absolute', right: 0, width: 16, height: 16, borderRadius: '50%', bgcolor: '#F79E1B', mixBlendMode: 'multiply' }} />
          </Box>
        </Box>
      );
    case 'amex':
      return (
        <Box sx={{ width: '100%', height: '100%', bgcolor: '#006FCF', borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Box component="span" sx={{ color: '#fff', fontWeight: 800, fontSize: 10, letterSpacing: 0.3 }}>AMEX</Box>
        </Box>
      );
  }
}

interface Props {
  value: CardNetwork | null;
  onChange: (network: CardNetwork) => void;
}

export default function CardNetworkPicker({ value, onChange }: Props) {
  return (
    <Box sx={{ display: 'flex', gap: 1 }}>
      {NETWORKS.map((n) => (
        <Tooltip key={n.id} title={n.label}>
          <Box
            role="button"
            aria-label={n.label}
            onClick={() => onChange(n.id)}
            sx={{
              ...BADGE_SX,
              borderColor: value === n.id ? 'primary.main' : 'transparent',
              transform: value === n.id ? 'scale(1.05)' : 'none',
              opacity: value && value !== n.id ? 0.5 : 1,
            }}
          >
            <NetworkBadge network={n.id} />
          </Box>
        </Tooltip>
      ))}
    </Box>
  );
}
