import { useMemo, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Checkbox, FormControl, FormControlLabel,
  IconButton, InputLabel, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import PrintIcon from '@mui/icons-material/Print';
import AssignmentReturnIcon from '@mui/icons-material/AssignmentReturn';
import type { Item } from '../../types/catalog';
import type { PurchaseInvoice, PurchaseLine } from '../../types/purchasing';
import { PARTY_TYPE_FLAG, type PartyTypeFlag } from '../../types/party';
import { buildPartyTable } from '../../utils/party';
import { computePurchaseTotals, pricePurchaseLine } from '../../utils/purchasing';
import { useCatalogStore } from '../../store/catalogStore';
import { usePurchasingStore } from '../../store/purchasingStore';
import { useCostCenterStore } from '../../store/costCenterStore';
import { useSettingsStore } from '../../store/settingsStore';
import PurchaseInvoiceDocument from './PurchaseInvoiceDocument';

export default function ReturnPurchaseInvoicePage() {
  const {
    vendors,
    invoices,
    receiveReturnInvoice,
    nextReturnNo,
  } = usePurchasingStore();
  const { items } = useCatalogStore();
  const cashierName = useSettingsStore((s) => s.settings.cashierName);
  const centers = useCostCenterStore((s) => s.centers);
  const defaultCostCenterId = useSettingsStore((s) => s.settings.costCenterId);

  // ---- header fields
  const [partyType, setPartyType] = useState<PartyTypeFlag>(PARTY_TYPE_FLAG.vendor);
  const [partyId, setPartyId] = useState('');
  const [costCenterId, setCostCenterId] = useState<string | undefined>(defaultCostCenterId);
  const [creditNoteNo, setCreditNoteNo] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [returnReason, setReturnReason] = useState('');
  const [originalInvoice, setOriginalInvoice] = useState<PurchaseInvoice | null>(null);

  // ---- line entry
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [qty, setQty] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [unitPurchasePrice, setUnitPurchasePrice] = useState('');
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [posted, setPosted] = useState<PurchaseInvoice | null>(null);

  const [printing, setPrinting] = useState<PurchaseInvoice | null>(null);

  const partyTable = useMemo(() => buildPartyTable(vendors), [vendors]);
  const partyOptions = useMemo(() => partyTable.filter((p) => p.typeFlag === partyType), [partyTable, partyType]);
  const party = vendors.find((v) => v.id === partyId && v.typeFlag === partyType);
  const partyInvoices = useMemo(() => invoices.filter(inv => inv.vendorId === partyId && !inv.isReturn), [invoices, partyId]);
  // Returns are their own documents; the purchase-invoice history deliberately excludes them.
  const postedReturns = useMemo(() => invoices.filter((inv) => inv.isReturn).reverse(), [invoices]);

  const lineValid = !!selectedItem && Number(qty) > 0 && !!batchNo.trim() && Number(unitPurchasePrice) >= 0;
  const totals = useMemo(() => computePurchaseTotals(lines), [lines]);
  const invoiceHeaderValid = !!party && !!creditNoteNo.trim() && lines.length > 0;

  function resetLineEntry() {
    setEditingLineId(null);
    setSelectedItem(null);
    setQty('');
    setBatchNo('');
    setUnitPurchasePrice('');
  }

  function addLine() {
    if (!lineValid || !selectedItem) return;
    const line = pricePurchaseLine({
      item: selectedItem,
      qty: Number(qty),
      bonusQty: 0,
      batchNo: batchNo.trim(),
      expiryDate: '',
      unitPurchasePrice: Number(unitPurchasePrice),
      discountTiers: [0, 0, 0],
    });
    if (editingLineId) {
      setLines((ls) => ls.map((existing) => (existing.id === editingLineId ? { ...line, id: editingLineId } : existing)));
    } else {
      setLines((ls) => [...ls, line]);
    }
    resetLineEntry();
  }

  function handleOriginalInvoiceSelect(inv: PurchaseInvoice | null) {
    setOriginalInvoice(inv);
    if (inv) {
      setLines(inv.lines);
      setCostCenterId(inv.costCenterId);
    } else {
      setLines([]);
    }
  }

  function post() {
    if (!invoiceHeaderValid || !party) return;
    try {
      const returnInv: PurchaseInvoice = {
        id: 'ret-' + Date.now(),
        invoiceNo: nextReturnNo(),
        vendorInvoiceNo: creditNoteNo.trim(),
        partyType,
        vendorId: party.id,
        vendorNo: party.vendorNo,
        vendorNameAr: party.nameAr,
        vendorNameEn: party.nameEn,
        date,
        costCenterId,
        notes: returnReason.trim() || undefined,
        isReturn: true,
        originalInvoiceNo: originalInvoice?.vendorInvoiceNo,
        returnReason: returnReason.trim(),
        receivedAt: new Date().toISOString(),
        receivedBy: cashierName,
        lines,
        ...totals,
      };
      receiveReturnInvoice(returnInv);
      setPosted(returnInv);
      setLines([]);
      setCreditNoteNo('');
      setReturnReason('');
      setOriginalInvoice(null);
    } catch (err) {
      alert(String(err));
    }
  }

  const printingParty = printing ? vendors.find((v) => v.id === printing.vendorId) : undefined;
  const printingCenter = printing?.costCenterId ? centers.find((c) => c.id === printing.costCenterId) : undefined;

  return (
    <Box>
      <Stack spacing={2}>
        {posted && (
          <Alert
            severity="success"
            onClose={() => setPosted(null)}
            action={
              <Button color="inherit" size="small" startIcon={<PrintIcon />} onClick={() => setPrinting(posted)}>
                Print
              </Button>
            }
          >
            Return {posted.vendorInvoiceNo} recorded for {posted.vendorNameEn}. Stock has been adjusted.
          </Alert>
        )}

        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>Purchase Return Details</Typography>
          <Stack spacing={2}>
            <FormControlLabel
              control={<Checkbox checked={partyType === PARTY_TYPE_FLAG.customer} onChange={(e) => setPartyType(e.target.checked ? PARTY_TYPE_FLAG.customer : PARTY_TYPE_FLAG.vendor)} />}
              label="Customer Return"
            />
            <Stack direction="row" spacing={2}>
              <FormControl size="small" fullWidth>
                <InputLabel>Party</InputLabel>
                <Select value={partyId} label="Party" onChange={(e) => setPartyId(e.target.value)}>
                  {partyOptions.map((p) => <MenuItem key={p.id} value={p.id}>{p.no} — {p.nameEn}</MenuItem>)}
                </Select>
              </FormControl>
              <Autocomplete
                size="small"
                fullWidth
                options={partyInvoices}
                getOptionLabel={(o) => `${o.vendorInvoiceNo} (${o.date})`}
                value={originalInvoice}
                onChange={(_, v) => handleOriginalInvoiceSelect(v)}
                renderInput={(params) => <TextField {...params} label="Link to original invoice" />}
              />
            </Stack>
            <Stack direction="row" spacing={1.5}>
              <TextField label="Return seq." value={nextReturnNo()} size="small" fullWidth slotProps={{ input: { readOnly: true } }} helperText="System number — assigned when posted" />
              <TextField label="Return No" value={creditNoteNo} onChange={(e) => setCreditNoteNo(e.target.value)} size="small" fullWidth helperText="Party credit note no" />
              <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} size="small" slotProps={{ inputLabel: { shrink: true } }} fullWidth />
            </Stack>
            <TextField label="Reason" value={returnReason} onChange={(e) => setReturnReason(e.target.value)} size="small" fullWidth multiline rows={2} />
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>Returned Items</Typography>
          <Stack spacing={2}>
            {!originalInvoice && (
              <Autocomplete options={items} value={selectedItem} onChange={(_, v) => setSelectedItem(v)} getOptionLabel={(o) => o.nameEn} renderInput={(params) => <TextField {...params} label="Search item" size="small" />} />
            )}
            <Stack direction="row" spacing={2}>
               <TextField label="Qty" type="number" value={qty} onChange={(e) => setQty(e.target.value)} size="small" fullWidth />
               <TextField label="Batch" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} size="small" fullWidth />
               <TextField label="Price" type="number" value={unitPurchasePrice} onChange={(e) => setUnitPurchasePrice(e.target.value)} size="small" fullWidth />
            </Stack>
            <Button variant="outlined" disabled={!lineValid} onClick={addLine}>Add line</Button>
            {lines.length > 0 && (
              <TableContainer>
                <Table size="small">
                  <TableHead><TableRow><TableCell>Item</TableCell><TableCell align="right">Qty</TableCell><TableCell>Batch</TableCell><TableCell align="right">Total</TableCell><TableCell /></TableRow></TableHead>
                  <TableBody>
                    {lines.map((l) => (
                      <TableRow key={l.id}><TableCell>{l.itemNameEn}</TableCell><TableCell align="right">{l.qty}</TableCell><TableCell>{l.batchNo}</TableCell><TableCell align="right">{l.totalInclVat.toFixed(2)}</TableCell><TableCell><IconButton size="small" color="error" aria-label="Remove returned line" onClick={() => setLines(ls => ls.filter(x => x.id !== l.id))}><DeleteOutlineIcon fontSize="small" /></IconButton></TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
            {lines.length > 0 && <Box sx={{ alignSelf: 'flex-end', minWidth: 200 }}><Typography variant="subtitle1"><strong>Total Return: SAR {totals.totalInclVat.toFixed(2)}</strong></Typography></Box>}
          </Stack>
        </Paper>

        <Button variant="contained" size="large" color="warning" startIcon={<AssignmentReturnIcon />} onClick={post} disabled={!invoiceHeaderValid}>
          Post Return
        </Button>

        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>Posted Returns</Typography>
          {postedReturns.length === 0 ? (
            <Typography variant="body2" color="text.secondary">No purchase returns posted yet.</Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Return seq.</TableCell>
                    <TableCell>Party doc. no</TableCell>
                    <TableCell>Party No.</TableCell>
                    <TableCell>Date</TableCell>
                    <TableCell>Original doc.</TableCell>
                    <TableCell align="right">Lines</TableCell>
                    <TableCell align="right">Total (SAR)</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {postedReturns.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.invoiceNo}</TableCell>
                      <TableCell>{r.vendorInvoiceNo}</TableCell>
                      <TableCell>{r.vendorNo ?? '—'}</TableCell>
                      <TableCell>{r.date}</TableCell>
                      <TableCell>{r.originalInvoiceNo ?? '—'}</TableCell>
                      <TableCell align="right">{r.lines.length}</TableCell>
                      <TableCell align="right">{r.totalInclVat.toFixed(2)}</TableCell>
                      <TableCell align="right">
                        <IconButton size="small" aria-label="Print return" onClick={() => setPrinting(r)}>
                          <PrintIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      </Stack>
      <PurchaseInvoiceDocument open={printing !== null} invoice={printing} party={printingParty} costCenterLabel={printingCenter ? (printingCenter.code + ' · ' + printingCenter.nameEn) : undefined} onClose={() => setPrinting(null)} />
    </Box>
  );
}