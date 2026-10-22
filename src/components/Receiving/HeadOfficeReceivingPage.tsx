import { useEffect, useState } from 'react';
import {
  Box, Typography, TextField, Button, Paper, Stack, Select, MenuItem, FormControl, InputLabel, Alert,
  Divider, Table, TableHead, TableRow, TableCell, TableBody, Chip, Checkbox, FormControlLabel,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import * as XLSX from 'xlsx';
import { useCatalogStore } from '../../store/catalogStore';
import { getErpStoreNo } from '../../api/erpApi';
import { parseTransferCode } from '../../utils/transferCode';

// A transfer-in from head office/another branch is NOT a vendor purchase - there's no supplier
// negotiating a discount off a box price, so this deliberately does NOT reuse Stock Receiving's
// Purchase Price + Discount % fields (see ReceivingPage.tsx). It still calls the same
// receiveStock() action underneath (purchaseDiscountPercent fixed at 0 - no discount concept
// applies here) since a received batch's shape in the catalog is identical either way; only how a
// cashier fills the form differs.
function ManualEntryForm() {
  const { items, receiveStock } = useCatalogStore();
  const [itemId, setItemId] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [qty, setQty] = useState('');
  const [costPerUnit, setCostPerUnit] = useState(''); // optional - head office doesn't always pass this down
  const [done, setDone] = useState(false);

  const valid = itemId && batchNo.trim() && expiryDate && Number(qty) > 0 && Number(costPerUnit || 0) >= 0;

  function submit() {
    if (!valid) return;
    receiveStock({
      itemId,
      batchNo: batchNo.trim(),
      expiryDate,
      qty: Number(qty),
      purchasePrice: Number(costPerUnit) || 0,
      purchaseDiscountPercent: 0,
      source: 'head_office',
    });
    setBatchNo('');
    setExpiryDate('');
    setQty('');
    setCostPerUnit('');
    setDone(true);
    setTimeout(() => setDone(false), 2500);
  }

  return (
    <Paper variant="outlined" sx={{ p: 3, maxWidth: 480 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>Enter a Single Item Manually</Typography>
      <Stack spacing={2}>
        <FormControl fullWidth>
          <InputLabel id="ho-item-label">Item</InputLabel>
          <Select labelId="ho-item-label" label="Item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            {items.map((i) => (
              <MenuItem key={i.id} value={i.id}>{i.nameEn}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField label="Batch / Lot No." value={batchNo} onChange={(e) => setBatchNo(e.target.value)} fullWidth />
        <TextField
          label="Expiry Date"
          type="date"
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          fullWidth
        />
        <TextField label="Quantity Received" type="number" value={qty} onChange={(e) => setQty(e.target.value)} fullWidth />
        <TextField
          label="Cost per Unit (optional)"
          type="number"
          value={costPerUnit}
          onChange={(e) => setCostPerUnit(e.target.value)}
          helperText="Leave blank if head office didn't pass down a cost for this transfer."
          slotProps={{ htmlInput: { step: '0.001' } }}
          fullWidth
        />
        {done && <Alert severity="success">Stock received from head office into inventory.</Alert>}
        <Button variant="contained" disabled={!valid} onClick={submit}>Receive Stock</Button>
      </Stack>
    </Paper>
  );
}

type RowStatus = 'ready' | 'duplicate-transfer' | 'wrong-branch' | 'bad-code' | 'unknown-item' | 'invalid';

interface ParsedRow {
  rowNum: number; // 1-based spreadsheet row, for error messages a non-technical user can act on
  transferCodeRaw: string;
  transferNo: string | null;
  branchNo: number | null;
  barcode: string;
  batchNo: string;
  expiryDate: string;
  qty: number;
  costPerUnit: number | undefined;
  itemId: string | null;
  itemNameEn: string | null;
  status: RowStatus;
}

// Tolerates real-world header variation (extra spaces, different casing) rather than demanding an
// exact match - a non-technical head-office export is never going to be byte-perfect.
function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

const HEADER_ALIASES: Record<string, string[]> = {
  transferCode: ['transfer code', 'transfer no', 'reference', 'reference no'],
  barcode: ['barcode', 'item barcode', 'gtin'],
  batchNo: ['batch no', 'batch / lot no', 'batch', 'lot no'],
  expiryDate: ['expiry date', 'expiry', 'exp date'],
  qty: ['quantity', 'qty', 'quantity received'],
  costPerUnit: ['cost per unit', 'cost', 'unit cost'],
};

function findColumn(headers: string[], field: keyof typeof HEADER_ALIASES): string | undefined {
  const normalized = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));
  return normalized.find((h) => HEADER_ALIASES[field].includes(h.norm))?.raw;
}

export default function HeadOfficeReceivingPage() {
  const { findItemByBarcode, receiveStock, isTransferImported, recordTransferImported } = useCatalogStore();
  const [storeNo, setStoreNo] = useState<number | null>(null);
  const [storeNoError, setStoreNoError] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [confirmDuplicates, setConfirmDuplicates] = useState(false);
  const [importSummary, setImportSummary] = useState<string | null>(null);

  useEffect(() => {
    getErpStoreNo()
      .then((r) => setStoreNo(r.storeNo))
      .catch((err) => setStoreNoError(err instanceof Error ? err.message : String(err)));
  }, []);

  // 0 is the ERP_STORE_NO placeholder, not a real store (see routes/erp.ts) - importing against it
  // would either reject every row or, worse, accept rows that happen to encode "00", so this is a
  // hard stop rather than a soft warning.
  const storeNotConfigured = storeNo === 0;

  async function handleFile(file: File) {
    setFileName(file.name);
    setParseError(null);
    setImportSummary(null);
    setConfirmDuplicates(false);
    try {
      const buf = await file.arrayBuffer();
      const workbook = XLSX.read(buf, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false, dateNF: 'yyyy-mm-dd', defval: '' });

      if (raw.length === 0) {
        setParseError('That file has no data rows.');
        setRows([]);
        return;
      }

      const headers = Object.keys(raw[0]);
      const col = {
        transferCode: findColumn(headers, 'transferCode'),
        barcode: findColumn(headers, 'barcode'),
        batchNo: findColumn(headers, 'batchNo'),
        expiryDate: findColumn(headers, 'expiryDate'),
        qty: findColumn(headers, 'qty'),
        costPerUnit: findColumn(headers, 'costPerUnit'),
      };
      const missing = (['transferCode', 'barcode', 'batchNo', 'expiryDate', 'qty'] as const).filter((k) => !col[k]);
      if (missing.length > 0) {
        setParseError(`Missing required column(s): ${missing.join(', ')}. Found columns: ${headers.join(', ')}`);
        setRows([]);
        return;
      }

      const parsed: ParsedRow[] = raw.map((r, i) => {
        const transferCodeRaw = String(r[col.transferCode!] ?? '').trim();
        const code = parseTransferCode(transferCodeRaw);
        const barcode = String(r[col.barcode!] ?? '').trim();
        const batchNo = String(r[col.batchNo!] ?? '').trim();
        const expiryDate = String(r[col.expiryDate!] ?? '').trim();
        const qty = Number(r[col.qty!] ?? 0);
        const costRaw = col.costPerUnit ? String(r[col.costPerUnit] ?? '').trim() : '';
        const costPerUnit = costRaw ? Number(costRaw) : undefined;
        const item = barcode ? findItemByBarcode(barcode) : undefined;

        let status: RowStatus;
        if (!code) status = 'bad-code';
        else if (storeNo != null && !storeNotConfigured && code.branchNo !== storeNo) status = 'wrong-branch';
        else if (!item) status = 'unknown-item';
        else if (!batchNo || !expiryDate || !(qty > 0)) status = 'invalid';
        else if (code && isTransferImported(code.transferNo)) status = 'duplicate-transfer';
        else status = 'ready';

        return {
          rowNum: i + 2, // +1 for 0-index, +1 for the header row itself
          transferCodeRaw,
          transferNo: code?.transferNo ?? null,
          branchNo: code?.branchNo ?? null,
          barcode,
          batchNo,
          expiryDate,
          qty,
          costPerUnit,
          itemId: item?.id ?? null,
          itemNameEn: item?.nameEn ?? null,
          status,
        };
      });
      setRows(parsed);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
      setRows([]);
    }
  }

  const readyRows = rows.filter((r) => r.status === 'ready');
  const duplicateRows = rows.filter((r) => r.status === 'duplicate-transfer');
  const rejectedRows = rows.filter((r) => r.status !== 'ready' && r.status !== 'duplicate-transfer');
  const importable = confirmDuplicates ? [...readyRows, ...duplicateRows] : readyRows;

  function runImport() {
    const transferNos = new Set<string>();
    for (const row of importable) {
      if (!row.itemId) continue;
      receiveStock({
        itemId: row.itemId,
        batchNo: row.batchNo,
        expiryDate: row.expiryDate,
        qty: row.qty,
        purchasePrice: row.costPerUnit ?? 0,
        purchaseDiscountPercent: 0,
        source: 'head_office',
        transferNo: row.transferNo ?? undefined,
      });
      if (row.transferNo) transferNos.add(row.transferNo);
    }
    transferNos.forEach((t) => recordTransferImported(t));
    setImportSummary(`Imported ${importable.length} row(s) across ${transferNos.size} transfer(s).`);
    setRows([]);
    setFileName('');
  }

  const statusLabel: Record<RowStatus, string> = {
    ready: 'Ready',
    'duplicate-transfer': 'Already imported before',
    'wrong-branch': 'Different pharmacy',
    'bad-code': 'Bad transfer code',
    'unknown-item': 'Unknown barcode',
    invalid: 'Missing/invalid data',
  };
  const statusColor: Record<RowStatus, 'success' | 'warning' | 'error'> = {
    ready: 'success',
    'duplicate-transfer': 'warning',
    'wrong-branch': 'error',
    'bad-code': 'error',
    'unknown-item': 'error',
    invalid: 'error',
  };

  return (
    <Box sx={{ p: 3, maxWidth: 1000 }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>Receive from Head Office</Typography>

      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>Import a Transfer File</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Expects an Excel file with columns: Transfer Code (e.g. TRANSOUT12345601 - the last 2
          digits must match this pharmacy's own store number), Barcode, Batch No, Expiry Date,
          Quantity, and optionally Cost Per Unit. One file can safely cover several transfers and
          several branches - rows for a different pharmacy are rejected automatically, never
          imported here.
        </Typography>

        {storeNoError && <Alert severity="warning" sx={{ mb: 2 }}>Could not reach the server to confirm this pharmacy's store number: {storeNoError}. Upload is disabled until this is reachable.</Alert>}
        {storeNotConfigured && (
          <Alert severity="error" sx={{ mb: 2 }}>
            This pharmacy's store number isn't configured yet (ERP_STORE_NO is still the placeholder
            value). Every row would have to be rejected, since there's no way to confirm which ones
            are really yours - set a real store number in server/.env before importing a transfer file.
          </Alert>
        )}

        <Button
          component="label"
          variant="outlined"
          startIcon={<UploadFileIcon />}
          disabled={storeNo == null || storeNotConfigured}
        >
          {fileName || 'Choose Excel File'}
          <input
            type="file"
            accept=".xlsx,.xls"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = ''; // allow re-selecting the same file name after a correction
            }}
          />
        </Button>

        {parseError && <Alert severity="error" sx={{ mt: 2 }}>{parseError}</Alert>}
        {importSummary && <Alert severity="success" sx={{ mt: 2 }}>{importSummary}</Alert>}

        {rows.length > 0 && (
          <Box sx={{ mt: 3 }}>
            <Stack direction="row" spacing={2} sx={{ mb: 1 }}>
              <Chip color="success" label={`${readyRows.length} ready`} />
              {duplicateRows.length > 0 && <Chip color="warning" label={`${duplicateRows.length} already imported`} />}
              {rejectedRows.length > 0 && <Chip color="error" label={`${rejectedRows.length} rejected`} />}
            </Stack>

            {duplicateRows.length > 0 && (
              <FormControlLabel
                sx={{ mb: 1 }}
                control={<Checkbox checked={confirmDuplicates} onChange={(e) => setConfirmDuplicates(e.target.checked)} />}
                label={`I understand these ${duplicateRows.length} row(s) belong to a transfer already imported before, and want to import them again anyway.`}
              />
            )}

            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Row</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Transfer</TableCell>
                  <TableCell>Item</TableCell>
                  <TableCell>Batch</TableCell>
                  <TableCell>Expiry</TableCell>
                  <TableCell align="right">Qty</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.rowNum}>
                    <TableCell>{r.rowNum}</TableCell>
                    <TableCell><Chip size="small" color={statusColor[r.status]} label={statusLabel[r.status]} /></TableCell>
                    <TableCell>{r.transferCodeRaw}</TableCell>
                    <TableCell>{r.itemNameEn ?? r.barcode}</TableCell>
                    <TableCell>{r.batchNo}</TableCell>
                    <TableCell>{r.expiryDate}</TableCell>
                    <TableCell align="right">{r.qty}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <Button
              variant="contained"
              sx={{ mt: 2 }}
              disabled={importable.length === 0}
              onClick={runImport}
            >
              Import {importable.length} Row(s)
            </Button>
          </Box>
        )}
      </Paper>

      <Divider sx={{ mb: 3 }} />
      <ManualEntryForm />
    </Box>
  );
}
