// Create/edit form for the manufacturer / company master ("بيانات الشركات الصانعة"). Mirrors the
// legacy company-data dialog: a numbered identity block (last number -> company number, Arabic and
// English names), a free-text detailed-data block, and a status switch. The company number is the
// key Item.manufacturerNo stores, so it locks once the company exists.
import { useMemo, useState, type ReactNode } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
  IconButton, Paper, Stack, Switch, TextField, Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import FactoryOutlinedIcon from '@mui/icons-material/FactoryOutlined';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import NotesOutlinedIcon from '@mui/icons-material/NotesOutlined';
import ToggleOnOutlinedIcon from '@mui/icons-material/ToggleOnOutlined';
import type { Manufacturer } from '../../types/manufacturer';
import { isCompanyNoTaken, maxCompanyNumber } from '../../utils/manufacturers';

import { T, useT } from '../../i18n';
interface Props {
  open: boolean;
  manufacturer: Manufacturer | null; // null = creating
  manufacturers: Manufacturer[];
  onSave: (input: {
    companyNo: number;
    nameAr: string;
    nameEn: string;
    details?: string;
    isActive?: boolean;
  }) => void;
  onClose: () => void;
  error?: string | null;
}

interface FormValues {
  companyNo: string;
  nameAr: string;
  nameEn: string;
  details: string;
  isActive: boolean;
}

const DETAILS_MAX = 2000;

export default function ManufacturerFormDialog({
  open, manufacturer, manufacturers, onSave, onClose, error,
}: Props) {
  const tr = useT();
  const [values, setValues] = useState<FormValues>(() => ({
    companyNo: String(manufacturer?.companyNo ?? maxCompanyNumber(manufacturers) + 1),
    nameAr: manufacturer?.nameAr ?? '',
    nameEn: manufacturer?.nameEn ?? '',
    details: manufacturer?.details ?? '',
    isActive: manufacturer?.isActive !== false,
  }));
  const [submitted, setSubmitted] = useState(false);

  const errors = useMemo(() => {
    const e: { companyNo?: string; nameAr?: string; nameEn?: string; details?: string } = {};
    const no = Number(values.companyNo);
    if (values.companyNo.trim() === '' || !Number.isInteger(no) || no < 1) {
      e.companyNo = 'Enter a whole company number of 1 or more.';
    } else if (isCompanyNoTaken(manufacturers, no, manufacturer?.id)) {
      e.companyNo = 'Another company already uses this number.';
    }
    if (!values.nameAr.trim()) e.nameAr = 'Arabic name is required.';
    if (!values.nameEn.trim()) e.nameEn = 'English name is required.';
    if (values.details.length > DETAILS_MAX) e.details = `Detailed data is too long (max ${DETAILS_MAX}).`;
    return e;
  }, [values, manufacturers, manufacturer?.id]);

  const hasErrors = Object.keys(errors).length > 0;
  const errorCount = Object.keys(errors).length;

  // The duplicate-number guard is shown WHILE the number is typed, not only after Save: the form
  // prefills the next free number, so the owner immediately sees why a typed-over number is refused
  // and which existing company is in the way. Format errors still wait for the first save attempt.
  const liveCompanyNoError = useMemo(() => {
    const no = Number(values.companyNo);
    if (values.companyNo.trim() === '' || !Number.isInteger(no) || no < 1) return undefined;
    return isCompanyNoTaken(manufacturers, no, manufacturer?.id)
      ? 'Another company already uses this number.'
      : undefined;
  }, [values.companyNo, manufacturers, manufacturer?.id]);

  function patch<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function errorFor(key: 'companyNo' | 'nameAr' | 'nameEn' | 'details'): string | undefined {
    if (key === 'companyNo') return submitted ? errors.companyNo : liveCompanyNoError;
    return submitted ? errors[key] : undefined;
  }

  function save() {
    setSubmitted(true);
    if (hasErrors) {
      requestAnimationFrame(() => {
        const field = document.querySelector<HTMLElement>(
          '.MuiDialog-root .Mui-error input, .MuiDialog-root .Mui-error textarea'
        );
        field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        field?.focus({ preventScroll: true });
      });
      return;
    }
    onSave({
      companyNo: Number(values.companyNo),
      nameAr: values.nameAr.trim(),
      nameEn: values.nameEn.trim(),
      details: values.details.trim() === '' ? undefined : values.details.trim(),
      isActive: values.isActive,
    });
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle
        component="div"
        sx={{ position: 'relative', pr: 7, py: 2, borderBottom: '1px solid', borderColor: 'divider', bgcolor: '#f8fafc' }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box
            sx={(t) => ({
              width: 42,
              height: 42,
              flexShrink: 0,
              borderRadius: 2,
              display: 'grid',
              placeItems: 'center',
              bgcolor: alpha(t.palette.primary.main, 0.1),
              color: 'primary.main',
            })}
          >
            <FactoryOutlinedIcon />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="h6" noWrap sx={{ lineHeight: 1.2 }}>
              {manufacturer ? tr("Edit company") : tr("New company")}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
              {manufacturer
                ? `${tr("Company no ")}${manufacturer.companyNo}${tr(" · last number ")}${maxCompanyNumber(manufacturers)}`
                : `${tr("Last number ")}${maxCompanyNumber(manufacturers) || '—'}${tr(" · next number ")}${values.companyNo || '—'}`}
            </Typography>
          </Box>
          {manufacturer ? (
            <Chip
              size="small"
              label={values.isActive ? tr("Active") : tr("Inactive")}
              color={values.isActive ? 'success' : 'default'}
              variant={values.isActive ? 'outlined' : 'filled'}
              sx={{ flexShrink: 0 }}
            />
          ) : (
            <Chip size="small" label={tr('New')} variant="outlined" sx={{ flexShrink: 0 }} />
          )}
        </Stack>
        <IconButton aria-label={tr('Close')} onClick={onClose} size="small" sx={{ position: 'absolute', insetInlineEnd: 12, top: 12 }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ bgcolor: 'background.default', px: { xs: 2, sm: 3 }, py: 2.5 }}>
        <Stack spacing={2}>
          {error && <Alert severity="error" onClose={onClose}>{error}</Alert>}

          <Section
            icon={<BadgeOutlinedIcon />}
            title={tr('Company identity')}
            caption="بيانات الشركة — the number is fixed once the company is saved"
          >
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' } }}>
              <TextField
                label={tr('Company No')}
                type="number"
                value={values.companyNo}
                onChange={(e) => patch('companyNo', e.target.value)}
                error={!!errorFor('companyNo')}
                helperText={
                  errorFor('companyNo') ??
                  (manufacturer
                    ? 'Fixed — item master rows point at this number'
                    : 'Next free number — you may change it before saving')
                }
                size="small"
                required
                disabled={!!manufacturer}
                slotProps={{ htmlInput: { min: 1, step: '1' } }}
                fullWidth
              />
              <TextField
                label={tr('Name (Arabic - عربي)')}
                value={values.nameAr}
                onChange={(e) => patch('nameAr', e.target.value)}
                error={!!errorFor('nameAr')}
                helperText={errorFor('nameAr') ?? 'اسم الشركة بالعربي'}
                size="small"
                required
                fullWidth
                slotProps={{ htmlInput: { dir: 'rtl', style: { textAlign: 'right' } } }}
              />
              <TextField
                label={tr('Name (English)')}
                value={values.nameEn}
                onChange={(e) => patch('nameEn', e.target.value)}
                error={!!errorFor('nameEn')}
                helperText={errorFor('nameEn') ?? 'Company name on documents'}
                size="small"
                required
                fullWidth
                sx={{ gridColumn: { sm: '1 / -1' } }}
              />
            </Box>
          </Section>

          <Section
            icon={<NotesOutlinedIcon />}
            title={tr('Detailed data')}
            caption="بيانات تفصيلية — address, contact person, phone, SFDA licence, notes"
          >
            <TextField
              label={tr('Detailed data')}
              value={values.details}
              onChange={(e) => patch('details', e.target.value)}
              error={!!errorFor('details')}
              helperText={errorFor('details') ?? `${values.details.length} / ${DETAILS_MAX} characters`}
              size="small"
              fullWidth
              multiline
              minRows={4}
              placeholder={tr('e.g. Plant: Tabuk · SFDA licence 1024 · Contact: Mr. Ali · 011 000 0001')}
            />
          </Section>

          <Section
            icon={<ToggleOnOutlinedIcon />}
            title={tr('Status')}
            caption="Inactive companies stay in the master and on old items, but are not offered for new items"
          >
            <FormControlLabel
              control={<Switch checked={values.isActive} onChange={(e) => patch('isActive', e.target.checked)} />}
              label={values.isActive ? 'Active' : 'Inactive'}
              sx={{ ml: 0 }}
            />
          </Section>
        </Stack>
      </DialogContent>

      <DialogActions
        sx={{
          px: { xs: 2, sm: 3 },
          py: 1.75,
          gap: 1,
          borderTop: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Box sx={{ mr: 'auto', minWidth: 0, display: { xs: 'none', sm: 'block' } }}>
          {submitted && hasErrors ? (
            <Typography variant="caption" color="error" sx={{ fontWeight: 600 }}>
              <T>Fix the highlighted field</T>{errorCount === 1 ? '' : 's'} <T>before saving.</T>
            </Typography>
          ) : (
            <Typography variant="caption" color="text.secondary">
              <T>Fields marked * are required</T>
            </Typography>
          )}
        </Box>
        <Button onClick={onClose} color="inherit" sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
          <T>Cancel</T>
        </Button>
        <Button
          variant="contained"
          onClick={save}
          startIcon={<SaveOutlinedIcon />}
          sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          {manufacturer ? tr("Save Changes") : tr("Create Company")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function Section({
  icon, title, caption, children,
}: {
  icon: ReactNode;
  title: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
      <Stack
        direction="row"
        spacing={1.25}
        sx={{ alignItems: 'center', px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider', bgcolor: '#f8fafc' }}
      >
        <Box
          sx={(t) => ({
            width: 30,
            height: 30,
            flexShrink: 0,
            borderRadius: 1.5,
            display: 'grid',
            placeItems: 'center',
            bgcolor: alpha(t.palette.primary.main, 0.08),
            color: 'primary.main',
            '& svg': { fontSize: 18 },
          })}
        >
          {icon}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ lineHeight: 1.3 }}>{title}</Typography>
          {caption && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>
              {caption}
            </Typography>
          )}
        </Box>
      </Stack>
      <Box sx={{ p: 2 }}>{children}</Box>
    </Paper>
  );
}
