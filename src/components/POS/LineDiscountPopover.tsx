import { useState } from 'react';
import { Popover, Stack, ToggleButtonGroup, ToggleButton, TextField, Button, InputAdornment } from '@mui/material';
import { discountInputToFraction, formatDiscountInput } from '../../utils/purchasing';
import DiscountInput from '../common/DiscountInput';

import { T, useT } from '../../i18n';
interface Props {
  anchorEl: HTMLElement | null;
  type?: 'amount' | 'percent';
  value?: number; // fraction for 'percent' (0.15), SAR for 'amount'
  onApply: (discount: { type: 'amount' | 'percent'; value: number } | null) => void;
  onClose: () => void;
}

export default function LineDiscountPopover({ anchorEl, type, value, onApply, onClose }: Props) {
  const tr = useT();
  const [kind, setKind] = useState<'amount' | 'percent'>(type ?? 'percent');
  // Percent is typed as whole points ("15") and stored as a fraction (0.15); amount is SAR as typed.
  const [input, setInput] = useState(
    value ? (type === 'percent' ? formatDiscountInput(value) : String(value)) : ''
  );

  function apply() {
    const n = kind === 'percent' ? discountInputToFraction(input) : Number(input);
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
          <ToggleButton value="amount"><T>SAR</T></ToggleButton>
        </ToggleButtonGroup>
        {kind === 'percent' ? (
          <DiscountInput
            label={tr('Discount %')}
            value={input}
            onChange={setInput}
            size="small"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && apply()}
          />
        ) : (
          <TextField
            autoFocus
            type="number"
            size="small"
            label={tr('Discount amount')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && apply()}
            slotProps={{
              input: { endAdornment: <InputAdornment position="end"><T>SAR</T></InputAdornment> },
              htmlInput: { min: 0, step: '0.01' },
            }}
          />
        )}
        <Stack direction="row" spacing={1}>
          <Button size="small" onClick={clear} disabled={!type}>
            <T>Clear</T>
          </Button>
          <Button size="small" variant="contained" fullWidth onClick={apply}>
            <T>Apply</T>
          </Button>
        </Stack>
      </Stack>
    </Popover>
  );
}
