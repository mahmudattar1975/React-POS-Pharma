// Bulk NUPCO approved-list import.
//
// The mapping screen can edit one item at a time, but NUPCO's list is a national file with hundreds
// of rows. This dialog turns a pasted CSV/TSV or an Excel file into a preview the pharmacist can
// check before anything is written:
//
//   ready      matched to a local item and will be applied
//   unchanged  already mapped exactly this way, so it is a no-op
//   skipped    not in this pharmacy's catalogue (normal - the list is national)
//   error      invalid code, duplicate code/item, ambiguous match or bad price
//
// Errors block the whole import. Nothing is applied until the Apply button is pressed, and the
// store validates the batch again (catalogStore.applyWasfatyMappings).
import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Stack, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import * as XLSX from 'xlsx';
import type { Item } from '../../types/catalog';
import {
  planWasfatyImport, WASFATY_IMPORT_COLUMNS, type WasfatyImportStatus, type WasfatyMappingUpdate,
} from '../../utils/wasfatyImport';

interface Props {
  open: boolean;
  items: Item[];
  onClose: () => void;
  onApply: (updates: WasfatyMappingUpdate[]) => void;
}

const STATUS_COLOR: Record<WasfatyImportStatus, 'success' | 'default' | 'info' | 'error'> = {
  ready: 'success',
  unchanged: 'default',
  skipped: 'info',
  error: 'error',
};

const STATUS_LABEL: Record<WasfatyImportStatus, string> = {
  ready: 'Ready',
  unchanged: 'Already mapped',
  skipped: 'Not in catalogue',
  error: 'Error',
};

const PLACEHOLDER = [
  WASFATY_IMPORT_COLUMNS.join(','),
  '6281007320014,6281007320014,4.25,yes',
  '6281007320021,6281007320021,,yes',
].join('\n');

export default function WasfatyImportDialog({ open, items, onClose, onApply }: Props) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState<string | undefined>();
  const [applyError, setApplyError] = useState<string | undefined>();

  const preview = useMemo(() => planWasfatyImport(text, items), [text, items]);
  const hasInput = text.trim() !== '';

  function reset() {
    setText('');
    setFileName('');
    setFileError(undefined);
    setApplyError(undefined);
  }

  function close() {
    reset();
    onClose();
  }

  async function handleFile(file: File) {
    setFileError(undefined);
    setApplyError(undefined);
    try {
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        setText(XLSX.utils.sheet_to_csv(sheet, { FS: ',' }));
      } else {
        setText(await file.text());
      }
      setFileName(file.name);
    } catch (err) {
      setFileError(`Could not read that file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function apply() {
    setApplyError(undefined);
    try {
      onApply(preview.apply);
      reset();
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err));
    }
  }

  const canApply = preview.ready > 0 && preview.errors === 0;

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="md">
      <DialogTitle>Import the NUPCO approved item list</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            Paste the list (comma, tab or semicolon separated) or choose a CSV/Excel file. Each row
            is matched to a local item by barcode, GTIN, alias barcode or item number. Nothing is
            written until you press Apply, and the whole batch is refused if any row has an error.
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Columns: <code>{WASFATY_IMPORT_COLUMNS.join('</code>, <code>')}</code>. Only{' '}
            <code>nupco_code</code> is required; <code>barcode</code> defaults to the code itself,{' '}
            <code>price</code> is optional (blank = normal sale price) and <code>eligible</code>{' '}
            defaults to yes.
          </Typography>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
            <Button component="label" variant="outlined" startIcon={<UploadFileIcon />} sx={{ flexShrink: 0 }}>
              {fileName || 'Choose CSV / Excel file'}
              <input
                type="file"
                accept=".csv,.tsv,.txt,.xlsx,.xls"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                  e.target.value = '';
                }}
              />
            </Button>
            <Typography variant="caption" color="text.secondary">
              Or paste directly into the box below. Existing mappings not mentioned in the file are
              left untouched.
            </Typography>
          </Stack>

          {fileError && <Alert severity="error">{fileError}</Alert>}

          <TextField
            multiline
            minRows={7}
            maxRows={14}
            fullWidth
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFileName('');
              setApplyError(undefined);
            }}
            placeholder={PLACEHOLDER}
            slotProps={{ htmlInput: { spellCheck: false } }}
            sx={{ '& textarea': { fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre' } }}
          />

          {hasInput && (
            <>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                <Chip size="small" color="success" label={`${preview.ready} ready`} />
                <Chip size="small" label={`${preview.unchanged} already mapped`} />
                <Chip size="small" color="info" label={`${preview.skipped} not in catalogue`} />
                <Chip
                  size="small"
                  color={preview.errors > 0 ? 'error' : 'default'}
                  variant={preview.errors > 0 ? 'filled' : 'outlined'}
                  label={`${preview.errors} error(s)`}
                />
              </Stack>

              {preview.errors > 0 && (
                <Alert severity="error">
                  Fix or remove the {preview.errors} row(s) marked error. The import is all-or-nothing,
                  so nothing will be applied while an error remains.
                </Alert>
              )}

              {preview.rows.length > 0 && (
                <TableContainer sx={{ maxHeight: 320, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ width: 56 }}>Row</TableCell>
                        <TableCell sx={{ width: 130 }}>Status</TableCell>
                        <TableCell>NUPCO code</TableCell>
                        <TableCell>Local item</TableCell>
                        <TableCell align="right">Price</TableCell>
                        <TableCell>Note</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {preview.rows.map((row) => (
                        <TableRow key={row.line} hover>
                          <TableCell>{row.line}</TableCell>
                          <TableCell>
                            <Chip size="small" color={STATUS_COLOR[row.status]} label={STATUS_LABEL[row.status]} />
                          </TableCell>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                            {row.nupcoCode || '—'}
                          </TableCell>
                          <TableCell>
                            {row.itemName ? (
                              <>
                                <Typography variant="body2">{row.itemName}</Typography>
                                <Typography variant="caption" color="text.secondary">
                                  #{row.itemNo ?? '—'}
                                </Typography>
                              </>
                            ) : (
                              <Typography variant="caption" color="text.secondary">
                                {row.raw || '—'}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell align="right">
                            {row.price === undefined ? '—' : row.price.toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <Typography variant="caption" color="text.secondary">
                              {row.reason ?? 'Will be applied.'}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </>
          )}

          {applyError && <Alert severity="error">{applyError}</Alert>}
          {!hasInput && (
            <Box>
              <Divider sx={{ mb: 1.5 }} />
              <Typography variant="caption" color="text.secondary">
                Tip: export NUPCO&apos;s list with the NUPCO code in the first column. A header row is
                optional; without one the columns are read as code, barcode, price, eligible.
              </Typography>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={close}>Cancel</Button>
        <Button variant="contained" onClick={apply} disabled={!canApply}>
          {preview.ready > 0 ? `Apply ${preview.ready} mapping${preview.ready === 1 ? '' : 's'}` : 'Apply'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
