// One discount field for the whole app: a ##.## percentage mask (00.00) that stores the fraction
// (16.67 -> 0.1667) in the pricing layer. Keeping the mask in a single component means purchasing,
// receiving, offers and the POS line discount can never drift apart.
import type { KeyboardEvent } from 'react';
import { InputAdornment, TextField } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { DISCOUNT_FRACTION_HINT, applyDiscountMask } from '../../utils/purchasing';

interface Props {
  label?: string;
  value: string; // whole percentage as typed, e.g. "16.67"
  onChange: (value: string) => void;
  helperText?: string;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
  sx?: SxProps<Theme>;
  autoFocus?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}

export default function DiscountInput({
  label = 'Discount',
  value,
  onChange,
  helperText = DISCOUNT_FRACTION_HINT,
  size,
  fullWidth,
  sx,
  autoFocus,
  onKeyDown,
}: Props) {
  return (
    <TextField
      label={label}
      type="text"
      value={value}
      onChange={(e) => {
        // The mask inserts the decimal point itself (1214 -> 12.14) and ignores a bad keystroke or
        // paste instead of rewriting it, so the field always holds a valid ##.## percentage.
        const next = applyDiscountMask(e.target.value);
        if (next !== null) onChange(next);
      }}
      onKeyDown={onKeyDown}
      autoFocus={autoFocus}
      placeholder="00.00"
      helperText={helperText}
      size={size}
      fullWidth={fullWidth}
      sx={sx}
      slotProps={{
        input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
        htmlInput: { inputMode: 'numeric', maxLength: 5 },
      }}
    />
  );
}
