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
import {
  computePurchaseTotals,
  pricePurchaseLine,
  purchaseReturnLineKey,
  returnedQuantitiesByLine,
} from '../../utils/purchasing';
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

  // ---- line entry (manual returns without a linked purchase)
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [qty, setQty] = useState('');
  const [bonusQty, setBonusQty] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [unitPurchasePrice, setUnitPurchasePrice] = useState('');
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [posted, setPosted] = useState<PurchaseInvoice | null>(null);

  const [printing, setPrinting] = useState<PurchaseInvoice | null>(null);

  const partyTable = useMemo(() => buildPartyTable(vendors), [vendors]);
  const partyOptions = useMemo(() => partyTable.filter((p) => p.typeFlag === partyType), [partyTable, partyType]);
  const party = vendors.find((v) => v.id === partyId && v.typeFlag === partyType);
  const partyInvoices = useMemo(() => invoices.filter(inv => inv.vendorId === partyId && !inv.isReturn), [invoices, partyId]);
  // Returns are their own documents; the purchase-invoice history deliberately excludes them.
  const postedReturns = useMemo(() => invoices.filter((inv) => inv.isReturn).reverse(), [invoices]);

  // Zero-quantity rows are drafts the owner has cleared, not return lines - keep them out of the
  // document and its totals.
  const returnLines = useMemo(() => lines.filter((l) => l.qty + (l.bonusQty || 0) > 0), [lines]);
  const totals = useMemo(() => computePurchaseTotals(returnLines), [returnLines]);

  // Everything already credited against the linked purchase, per item + batch. A second return
  // against the same document may only take what is still left.
  const alreadyReturned = useMemo(
    () =>
      originalInvoice
        ? returnedQuantitiesByLine(invoices, originalInvoice.vendorId, originalInvoice.vendorInvoiceNo)
        : new Map<string, { qty: number; bonusQty: number }>(),
    [invoices, originalInvoice]
  );
  const purchasedByLine = useMemo(() => {
    const purchased = new Map<string, { qty: number; bonusQty: number }>();
    if (!originalInvoice) return purchased;
    for (const line of originalInvoice.lines) {
      const key = purchaseReturnLineKey(line.itemId, line.batchNo);
      const current = purchased.get(key) ?? { qty: 0, bonusQty: 0 };
      current.qty += line.qty;
      current.bonusQty += line.bonusQty || 0;
      purchased.set(key, current);
    }
    return purchased;
  }, [originalInvoice]);

  function remainingFor(line: PurchaseLine) {
    const key = purchaseReturnLineKey(line.itemId, line.batchNo);
    const bought = purchasedByLine.get(key) ?? { qty: line.qty, bonusQty: line.bonusQty || 0 };
    const previous = alreadyReturned.get(key) ?? { qty: 0, bonusQty: 0 };
    return {
      qty: Math.max(0, bought.qty - previous.qty),
      bonusQty: Math.max(0, bought.bonusQty - previous.bonusQty),
    };
  }

  const overReturnedLines = originalInvoice
    ? returnLines.filter((line) => {
        const remaining = remainingFor(line);
        return line.qty > remaining.qty + 1e-9 || line.bonusQty > remaining.bonusQty + 1e-9;
      })
    : [];
  // True when every line on the linked purchase has already been credited.
  const fullyReturned = !!originalInvoice && originalInvoice.lines.every((line) => {
    const remaining = remainingFor(line);
    return remaining.qty + remaining.bonusQty <= 0;
  });

  const lineValid = !!selectedItem && (Number(qty) > 0 || Number(bonusQty) > 0) && !!batchNo.trim() && Number(unitPurchasePrice) >= 0;
  const invoiceHeaderValid = !!party && !!creditNoteNo.trim() && returnLines.length > 0 && overReturnedLines.length === 0;

  // Re-price a row when the owner edits its quantity. The linked line keeps the original vendor
  // discount tiers and unit price - a partial return is the same purchase, just fewer units.
  function repriceLine(line: PurchaseLine, nextQty: number, nextBonusQty: number): PurchaseLine {
    const paid = Math.max(0, Number.isFinite(nextQty) ? nextQty : 0);
    const bonus = Math.max(0, Number.isFinite(nextBonusQty) ? nextBonusQty : 0);
    const item = items.find((i) => i.id === line.itemId);
    if (!item) return { ...line, qty: paid, bonusQty: bonus, totalQty: paid + bonus };
    return pricePurchaseLine({
      item,
      qty: paid,
      bonusQty: bonus,
      packLevel: line.packLevel,
      batchNo: line.batchNo,
      expiryDate: line.expiryDate,
      unitPurchasePrice: line.unitPurchasePrice,
      discountTiers: [line.discount1Percent, line.discount2Percent, line.discount3Percent],
      existingId: line.id,
    });
  }

  function updateLine(lineId: string, patch: { qty?: number; bonusQty?: number }) {
    setLines((current) =>
      current.map((line) =>
        line.id === lineId
          ? repriceLine(line, patch.qty ?? line.qty, patch.bonusQty ?? line.bonusQty)
          : line
      )
    );
  }

  function resetLineEntry() {
    setSelectedItem(null);
    setQty('');
    setBonusQty('');
    setBatchNo('');
    setUnitPurchasePrice('');
  }

  function addLine() {
    if (!lineValid || !selectedItem) return;
    const line = pricePurchaseLine({
      item: selectedItem,
      qty: Number(qty),
      bonusQty: Number(bonusQty) || 0,
      batchNo: batchNo.trim(),
      expiryDate: '',
      unitPurchasePrice: Number(unitPurchasePrice),
      discountTiers: [0, 0, 0],
    });
    setLines((current) => [...current, line]);
    resetLineEntry();
  }

  function handleOriginalInvoiceSelect(inv: PurchaseInvoice | null) {
    setOriginalInvoice(inv);
    // Linking starts an empty return. The owner picks the lines to send back from the original
    // invoice below - nothing is added automatically, so a 100-unit purchase can return 20.
    setLines([]);
    if (inv) setCostCenterId(inv.costCenterId);
  }

  // Add one line from the linked purchase to the return. It starts at the full remaining
  // quantity, and the return table is where the owner lowers just the paid/bonus qty.
  function addLinkedLine(originalLine: PurchaseLine) {
    const key = purchaseReturnLineKey(originalLine.itemId, originalLine.batchNo);
    if (lines.some((line) => purchaseReturnLineKey(line.itemId, line.batchNo) === key)) return;
    const remaining = remainingFor(originalLine);
    if (remaining.qty + remaining.bonusQty <= 0) return;
    setLines((current) => [...current, repriceLine(originalLine, remaining.qty, remaining.bonusQty)]);
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
        lines: returnLines,
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
              control={<Checkbox checked={partyType === PARTY_TYPE_FLAG.customer} onChange={(e) => {
                setPartyType(e.target.checked ? PARTY_TYPE_FLAG.customer : PARTY_TYPE_FLAG.vendor);
                setPartyId('');
                setOriginalInvoice(null);
                setLines([]);
              }} />}
              label="Customer Return"
            />
            <Stack direction="row" spacing={2}>
              <FormControl size="small" fullWidth>
                <InputLabel>Party</InputLabel>
                <Select value={partyId} label="Party" onChange={(e) => {
                  setPartyId(e.target.value);
                  setOriginalInvoice(null);
                  setLines([]);
                }}>
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
              <>
                <Autocomplete options={items} value={selectedItem} onChange={(_, v) => setSelectedItem(v)} getOptionLabel={(o) => o.nameEn} renderInput={(params) => <TextField {...params} label="Search item" size="small" />} />
                <Stack direction="row" spacing={2}>
                  <TextField label="Qty" type="number" value={qty} onChange={(e) => setQty(e.target.value)} size="small" fullWidth />
                  <TextField label="Bonus" type="number" value={bonusQty} onChange={(e) => setBonusQty(e.target.value)} size="small" fullWidth />
                  <TextField label="Batch" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} size="small" fullWidth />
                  <TextField label="Price" type="number" value={unitPurchasePrice} onChange={(e) => setUnitPurchasePrice(e.target.value)} size="small" fullWidth />
                </Stack>
                <Button variant="outlined" disabled={!lineValid} onClick={addLine}>Add line</Button>
              </>
            )}
            {originalInvoice && (
              <Typography variant="body2" color="text.secondary">
                Linked to {originalInvoice.invoiceNo} · party doc. {originalInvoice.vendorInvoiceNo}. Pick the
                lines to send back, then edit only their paid/bonus quantity in the return list.
              </Typography>
            )}
            {originalInvoice && (
              <>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Original invoice lines</Typography>
                <TableContainer>
                  <Table size="small" aria-label="Original invoice lines">
                    <TableHead>
                      <TableRow>
                        <TableCell>Item</TableCell>
                        <TableCell>Batch</TableCell>
                        <TableCell align="right">Purchased</TableCell>
                        <TableCell align="right">Already returned</TableCell>
                        <TableCell align="right">Still returnable</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {originalInvoice.lines.map((line) => {
                        const key = purchaseReturnLineKey(line.itemId, line.batchNo);
                        const previous = alreadyReturned.get(key) ?? { qty: 0, bonusQty: 0 };
                        const remaining = remainingFor(line);
                        const added = lines.some((l) => purchaseReturnLineKey(l.itemId, l.batchNo) === key);
                        const exhausted = remaining.qty + remaining.bonusQty <= 0;
                        return (
                          <TableRow key={line.id}>
                            <TableCell>{line.itemNameEn}</TableCell>
                            <TableCell>{line.batchNo}</TableCell>
                            <TableCell align="right">{line.qty} + {line.bonusQty || 0} bonus</TableCell>
                            <TableCell align="right">{previous.qty} + {previous.bonusQty} bonus</TableCell>
                            <TableCell align="right">{remaining.qty} + {remaining.bonusQty} bonus</TableCell>
                            <TableCell align="right">
                              <Button
                                size="small"
                                variant="outlined"
                                disabled={added || exhausted}
                                onClick={() => addLinkedLine(line)}
                              >
                                {added ? 'Added' : exhausted ? 'Fully returned' : 'Add to return'}
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
                {fullyReturned && <Alert severity="info">This invoice has already been fully returned.</Alert>}
                {!fullyReturned && lines.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    No return lines selected yet — use “Add to return” above.
                  </Typography>
                )}
              </>
            )}
            {lines.length > 0 && (
              <>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Selected return lines</Typography>
                <TableContainer>
                  <Table size="small" aria-label="Return lines">
                    <TableHead>
                      <TableRow>
                        <TableCell>Item</TableCell>
                        <TableCell align="right">Paid qty</TableCell>
                        <TableCell align="right">Bonus qty</TableCell>
                        <TableCell>Batch</TableCell>
                        {originalInvoice && <TableCell align="right">Still returnable</TableCell>}
                        <TableCell align="right">Total</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {lines.map((l) => {
                        const remaining = remainingFor(l);
                        return (
                          <TableRow key={l.id}>
                            <TableCell>{l.itemNameEn}</TableCell>
                            <TableCell align="right">
                              <TextField
                                type="number"
                                size="small"
                                value={l.qty || ''}
                                onChange={(e) => updateLine(l.id, { qty: Number(e.target.value) })}
                                sx={{ width: 90 }}
                                slotProps={{ htmlInput: { min: 0, 'aria-label': `Return paid qty ${l.itemNameEn}` } }}
                              />
                            </TableCell>
                            <TableCell align="right">
                              <TextField
                                type="number"
                                size="small"
                                value={l.bonusQty || ''}
                                onChange={(e) => updateLine(l.id, { bonusQty: Number(e.target.value) })}
                                sx={{ width: 90 }}
                                slotProps={{ htmlInput: { min: 0, 'aria-label': `Return bonus qty ${l.itemNameEn}` } }}
                              />
                            </TableCell>
                            <TableCell>{l.batchNo}</TableCell>
                            {originalInvoice && (
                              <TableCell align="right">{remaining.qty} + {remaining.bonusQty} bonus</TableCell>
                            )}
                            <TableCell align="right">{l.totalInclVat.toFixed(2)}</TableCell>
                            <TableCell>
                              <IconButton size="small" color="error" aria-label="Remove returned line" onClick={() => setLines(ls => ls.filter(x => x.id !== l.id))}>
                                <DeleteOutlineIcon fontSize="small" />
                              </IconButton>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            )}
            {overReturnedLines.length > 0 && (
              <Alert severity="warning">
                A return cannot exceed what was purchased and not already returned:{' '}
                {overReturnedLines
                  .map((l) => {
                    const remaining = remainingFor(l);
                    return `${l.itemNameEn} (max ${remaining.qty} paid + ${remaining.bonusQty} bonus)`;
                  })
                  .join('; ')}
                .
              </Alert>
            )}
            {returnLines.length > 0 && <Box sx={{ alignSelf: 'flex-end', minWidth: 200 }}><Typography variant="subtitle1"><strong>Total Return: SAR {totals.totalInclVat.toFixed(2)}</strong></Typography></Box>}
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
