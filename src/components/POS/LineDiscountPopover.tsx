import { useState } from 'react';
import { Popover, Stack, ToggleButtonGroup, ToggleButton, TextField, Button, InputAdornment } from '@mui/material';

interface Props {
  anchorEl: HTMLElement | null;
  type?: 'amount' | 'percent';
  value?: number;
  onApply: (discount: { type: 'amount' | 'percent'; value: number } | null) => void;
  onClose: () => void;
}

export default function LineDiscountPopover({ anchorEl, type, value, onApply, onClose }: Props) {
  const [kind, setKind] = useState<'amount' | 'percent'>(type ?? 'percent');
  const [input, setInput] = useState(value ? String(value) : '');

  function apply() {
    const n = Number(input);
    onApply(n > 0 ? { type: kind, value: n } : null);
    onClose();
  }

  function clear() {
    onApply(null);
    onClose();
  }

  return (
    <Popover
      open={!!anchorEl}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
    >
      <Stack spacing={1.5} sx={{ p: 2, width: 220 }}>
        <ToggleButtonGroup exclusive fullWidth size="small" value={kind} onChange={(_, v) => v && setKind(v)}>
          <ToggleButton value="percent">%</ToggleButton>
          <ToggleButton value="amount">SAR</ToggleButton>
        </ToggleButtonGroup>
        <TextField
          autoFocus
          type="number"
          size="small"
          label={kind === 'percent' ? 'Discount fraction' : 'Discount amount'}
          helperText={kind === 'percent' ? 'e.g. 0.15 = 15%' : undefined}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && apply()}
          slotProps={{
            input: {
              endAdornment: kind === 'amount' ? <InputAdornment position="end">SAR</InputAdornment> : undefined,
            },
            htmlInput: { min: 0, max: kind === 'percent' ? 1 : undefined, step: '0.01' },
          }}
        />
        <Stack direction="row" spacing={1}>
          <Button size="small" onClick={clear} disabled={!type}>
            Clear
          </Button>
          <Button size="small" variant="contained" fullWidth onClick={apply}>
            Apply
          </Button>
        </Stack>
      </Stack>
    </Popover>
  );
}
