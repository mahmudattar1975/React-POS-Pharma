// Bulk item-master import from the owner's spreadsheet.
//
// Unlike the NUPCO/transfer imports, this one creates new catalogue rows: every reviewed row is
// applied to dotnet_pos.dbo.items AND dotnet_pos.dbo.item by POST /api/items/import. Column names
// are auto-detected (English or Arabic) and can be corrected before Apply. Preview is mandatory -
// nothing is written until the owner presses the button, and any row with an error blocks the whole
// file so a partly mapped sheet cannot slip through.
import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl,
  InputLabel, MenuItem, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';
import type { Item } from '../../types/catalog';
import { importItems, type ImportedItemRecord, type ItemImportResult } from '../../api/itemImportApi';
import {
  detectItemColumns, ITEM_IMPORT_ALIASES, ITEM_IMPORT_FIELDS, ITEM_IMPORT_REQUIRED,
  planItemImport, type ItemColumnMapping, type ItemImportField, type ItemImportStatus,
} from '../../utils/itemImport';
import { downloadItemImportSample } from '../../utils/itemImportSample';
import { formatMoney } from '../../utils/format';
import { useItemCategoryStore } from '../../store/itemCategoryStore';

import { T, useT } from '../../i18n';

interface Props {
  open: boolean;
  items: Item[];
  onClose: () => void;
  onImported: (items: Item[]) => void;
}

const STATUS_COLOR: Record<ItemImportStatus, 'success' | 'primary' | 'error'> = {
  create: 'success',
  update: 'primary',
  error: 'error',
};

const FIELD_LABEL: Record<ItemImportField, string> = {
  barcode: 'Barcode / code *',
  extraBarcodes: 'Extra barcodes (same item)',
  nameEn: 'English name *',
  nameAr: 'Arabic name',
  basePrice: 'Sale price',
  vatRate: 'VAT rate',
  category: 'Category (free text)',
  itemCategories: 'CategoryID (ItemCategories)',
  unit: 'Unit',
  reorderLevel: 'Reorder level',
  controlledStatus: 'Controlled status',
  requiresBatchTracking: 'Batch tracking',
  isActive: 'Active',
  vendorNo: 'Vendor',
  manufacturerNo: 'Manufactured',
};

const STATUS_LABEL: Record<ItemImportStatus, string> = {
  create: 'New',
  update: 'Update',
  error: 'Error',
};

interface SheetState {
  fileName: string;
  headers: string[];
  rows: Record<string, unknown>[];
  rowNumbers: number[];
}

function toImportedItem(record: ImportedItemRecord): Item {
  return {
    id: record.id,
    barcode: record.barcode,
    nameAr: record.nameAr,
    nameEn: record.nameEn,
    unit: record.unit,
    category: record.category,
    categoryId: record.categoryId,
    basePrice: record.basePrice,
    vatRate: record.vatRate,
    requiresBatchTracking: record.requiresBatchTracking,
    reorderLevel: record.reorderLevel,
    controlledStatus: record.controlledStatus ?? undefined,
    isActive: record.isActive,
  };
}

export default function ItemImportDialog({ open, items, onClose, onImported }: Props) {
  const tr = useT();
  const categories = useItemCategoryStore((s) => s.categories);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [columns, setColumns] = useState<ItemColumnMapping>({});
  const [fileError, setFileError] = useState<string | undefined>();
  const [applyError, setApplyError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ItemImportResult | null>(null);

  const plan = useMemo(
    () => (sheet ? planItemImport(sheet.rows, columns, items, 2, sheet.rowNumbers, categories) : null),
    [sheet, columns, items, categories],
  );

  function close() {
    if (busy) return;
    setSheet(null);
    setColumns({});
    setFileError(undefined);
    setApplyError(undefined);
    setResult(null);
    onClose();
  }

  async function handleFile(file: File) {
    setFileError(undefined);
    setApplyError(undefined);
    setResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(buffer, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
        raw: false,
        defval: '',
        dateNF: 'yyyy-mm-dd',
      });
      const headers = Object.keys(raw[0] ?? {});
      if (headers.length === 0) throw new Error('That sheet has no header row or data.');

      // Keep the original spreadsheet row numbers in the preview even after dropping blank rows.
      const rows: Record<string, unknown>[] = [];
      const rowNumbers: number[] = [];
      raw.forEach((row, index) => {
        if (Object.values(row).some((value) => String(value ?? '').trim() !== '')) {
          rows.push(row);
          rowNumbers.push(index + 2);
        }
      });
      if (rows.length === 0) throw new Error('That sheet has no data rows.');

      setSheet({ fileName: file.name, headers, rows, rowNumbers });
      setColumns(detectItemColumns(headers));
    } catch (err) {
      setSheet(null);
      setColumns({});
      setFileError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSample() {
    setFileError(undefined);
    try {
      await downloadItemImportSample();
    } catch (err) {
      setFileError(err instanceof Error ? err.message : String(err));
    }
  }

  async function apply() {
    if (!plan || busy || plan.errors > 0 || plan.apply.length === 0) return;
    setBusy(true);
    setApplyError(undefined);
    setResult(null);
    try {
      const response = await importItems(plan.apply);
      setResult(response);
      onImported(response.items.map(toImportedItem));
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const canApply = !!plan && plan.errors === 0 && plan.apply.length > 0 && !busy;

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="md">
      <DialogTitle><T>Import items from Excel</T></DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            <T>Choose the spreadsheet, check the detected columns, then review every row before
            applying. New codes are created; existing barcodes are updated. Rows with the same
            English name become one item: the first barcode is the main code and the others are
            aliases. The import writes to both the POS catalogue and the .NET item master — no
            batches or stock are created.</T>
          </Typography>

          <Stack direction="row" spacing={1} sx={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
            <Button component="label" variant="outlined" startIcon={<UploadFileIcon />}>
              {sheet?.fileName || tr('Choose Excel / CSV file')}
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                  e.target.value = '';
                }}
              />
            </Button>
            <Button variant="text" startIcon={<DownloadIcon />} onClick={() => void handleSample()}>
              <T>Excel sample</T>
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            <T>Download the sample to see the exact columns. The first sheet is imported; delete its example row before using your own items.</T>
          </Typography>
          {fileError && <Alert severity="error">{fileError}</Alert>}

          {sheet && (
            <>
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}><T>Column mapping</T></Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gap: 1.25,
                    gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' },
                  }}
                >
                  {ITEM_IMPORT_FIELDS.map((field) => (
                    <FormControl key={field} size="small" fullWidth>
                      <InputLabel id={`item-import-${field}`}>{tr(FIELD_LABEL[field])}</InputLabel>
                      <Select
                        labelId={`item-import-${field}`}
                        label={tr(FIELD_LABEL[field])}
                        value={columns[field] ?? ''}
                        onChange={(e) => {
                          const value = e.target.value;
                          setColumns((current) => ({ ...current, [field]: value || undefined }));
                          setResult(null);
                        }}
                      >
                        <MenuItem value=""><em><T>Not mapped</T></em></MenuItem>
                        {sheet.headers.map((header) => (
                          <MenuItem key={header} value={header}>{header}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  ))}
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  <T>Recognised automatically from:</T>{' '}
                  {ITEM_IMPORT_REQUIRED.map((field) => ITEM_IMPORT_ALIASES[field].slice(0, 4).join(', ')).join(' · ')}
                </Typography>
              </Box>

              {plan && (
                <>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                    <Chip size="small" color="success" label={`${plan.create} ${tr('new')}`} />
                    <Chip size="small" color="primary" variant="outlined" label={`${plan.update} ${tr('updates')}`} />
                    <Chip
                      size="small"
                      color={plan.errors > 0 ? 'error' : 'default'}
                      variant={plan.errors > 0 ? 'filled' : 'outlined'}
                      label={`${plan.errors} ${tr('error(s)')}`}
                    />
                  </Stack>

                  {plan.errors > 0 && (
                    <Alert severity="error">
                      <T>Fix or unmap the rows marked error. The import is all-or-nothing, so
                      nothing will be written while an error remains.</T>
                    </Alert>
                  )}

                  <TableContainer sx={{ maxHeight: 320, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ width: 60 }}><T>Row</T></TableCell>
                          <TableCell sx={{ width: 90 }}><T>Status</T></TableCell>
                          <TableCell><T>Barcode / code</T></TableCell>
                          <TableCell><T>Name</T></TableCell>
                          <TableCell align="right"><T>Price</T></TableCell>
                          <TableCell align="right"><T>VAT</T></TableCell>
                          <TableCell><T>Note</T></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {plan.rows.map((row) => (
                          <TableRow key={row.row} hover>
                            <TableCell>{row.row}</TableCell>
                            <TableCell>
                              <Chip size="small" color={STATUS_COLOR[row.status]} label={tr(STATUS_LABEL[row.status])} />
                            </TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                              {row.barcode || '—'}
                              {!!row.barcodes?.length && (
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                  +{row.barcodes.join(', ')}
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2">{row.nameEn || '—'}</Typography>
                              {row.nameAr && (
                                <Typography variant="caption" color="text.secondary">{row.nameAr}</Typography>
                              )}
                            </TableCell>
                            <TableCell align="right">{formatMoney(row.basePrice)}</TableCell>
                            <TableCell align="right">{Math.round(row.vatRate * 100)}%</TableCell>
                            <TableCell>
                              <Typography variant="caption" color="text.secondary">
                                {row.note ?? (row.status === 'update' ? tr('Existing barcode will be updated.') : tr('Will be created in both tables.'))}
                              </Typography>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </>
              )}

              {applyError && <Alert severity="error">{applyError}</Alert>}
              {result && (
                <Alert severity="success">
                  <T>Imported successfully:</T> {result.created} <T>created</T>, {result.updated}{' '}
                  <T>updated in the POS catalogue</T>; {result.legacy.created} <T>created</T>,{' '}
                  {result.legacy.updated} <T>updated in the .NET item master</T>.
                </Alert>
              )}
            </>
          )}

          {!sheet && (
            <Typography variant="caption" color="text.secondary">
              <T>Expected columns (names may be in English or Arabic):</T> Barcode,{' '}
              <T>English name</T>, <T>Arabic name</T>, <T>Sale price</T>, <T>VAT rate</T>,{' '}
              <T>CategoryID</T>, <T>Category</T>, <T>Unit</T>.{' '}
              <T>Only barcode and English name are required.</T>
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={close} disabled={busy}><T>Close</T></Button>
        <Button variant="contained" onClick={() => void apply()} disabled={!canApply}>
          {busy ? tr('Importing…') : plan ? `${tr('Apply ')}${plan.apply.length} ${tr('items')}` : tr('Apply')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
