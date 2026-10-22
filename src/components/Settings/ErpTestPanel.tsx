import { Fragment, useEffect, useState } from 'react';
import {
  Box, Typography, TextField, Paper, Stack, Alert, Chip, CircularProgress,
  Table, TableHead, TableRow, TableCell, TableBody, Collapse,
} from '@mui/material';
import * as erpApi from '../../api/erpApi';
import type { ErpItem, ErpBatch, ErpCustomer } from '../../api/erpApi';

export default function ErpTestPanel() {
  const [status, setStatus] = useState<erpApi.ErpStatus | null>(null);

  const [itemQuery, setItemQuery] = useState('');
  const [items, setItems] = useState<ErpItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [expandedItem, setExpandedItem] = useState<number | null>(null);
  const [batches, setBatches] = useState<ErpBatch[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(false);

  const [custQuery, setCustQuery] = useState('');
  const [customers, setCustomers] = useState<ErpCustomer[]>([]);
  const [custLoading, setCustLoading] = useState(false);
  const [custError, setCustError] = useState<string | null>(null);

  useEffect(() => {
    erpApi.getErpStatus().then(setStatus).catch((err) => setStatus({ connected: false, error: String(err) }));
  }, []);

  async function runItemSearch() {
    setItemsLoading(true);
    setItemsError(null);
    setExpandedItem(null);
    try {
      const result = await erpApi.searchErpItems(itemQuery);
      setItems(result.items);
      setTruncated(result.truncated);
    } catch (err) {
      setItemsError(err instanceof Error ? err.message : String(err));
    } finally {
      setItemsLoading(false);
    }
  }

  async function toggleBatches(itemNo: number) {
    if (expandedItem === itemNo) {
      setExpandedItem(null);
      return;
    }
    setExpandedItem(itemNo);
    setBatchesLoading(true);
    try {
      setBatches(await erpApi.getErpItemBatches(itemNo));
    } finally {
      setBatchesLoading(false);
    }
  }

  async function runCustomerSearch() {
    setCustLoading(true);
    setCustError(null);
    try {
      setCustomers(await erpApi.searchErpCustomers(custQuery));
    } catch (err) {
      setCustError(err instanceof Error ? err.message : String(err));
    } finally {
      setCustLoading(false);
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>XPH Live Data (Read-Only)</Typography>
        {status && (
          <Chip
            size="small"
            color={status.connected ? 'success' : 'error'}
            label={status.connected ? `Connected (user ${status.userId})` : 'Not connected'}
          />
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Reads real item, batch, and customer data straight from the PharmaAxis ERP's XPH database via
        its existing .NET API - nothing is written back. See <code>server/src/erp/README.md</code>.
      </Typography>

      {status && !status.connected && <Alert severity="error" sx={{ mb: 2 }}>{status.error}</Alert>}

      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Item search</Typography>
      <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Barcode, item number, or name (Arabic or English)"
          value={itemQuery}
          onChange={(e) => setItemQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runItemSearch()}
        />
      </Stack>
      {itemsError && <Alert severity="error" sx={{ mb: 1 }}>{itemsError}</Alert>}
      {itemsLoading && <CircularProgress size={20} />}
      {items.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          {truncated
            ? `Showing the first ${items.length} matches — there may be more; try a more specific search`
            : `Showing all ${items.length} matching item${items.length === 1 ? '' : 's'}`}
        </Typography>
      )}
      {items.length > 0 && (
        <Table size="small" sx={{ mb: 2 }}>
          <TableHead>
            <TableRow>
              <TableCell>Item</TableCell>
              <TableCell>Barcode</TableCell>
              <TableCell>Unit</TableCell>
              <TableCell align="right">VAT</TableCell>
              <TableCell>Tracked</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((it) => (
              <Fragment key={it.itemNo}>
                <TableRow hover onClick={() => toggleBatches(it.itemNo)} sx={{ cursor: 'pointer' }}>
                  <TableCell>
                    <Typography variant="body2">{it.nameEn || it.nameAr}</Typography>
                    <Typography variant="caption" color="text.secondary">#{it.itemNo} · {it.nameAr}</Typography>
                  </TableCell>
                  <TableCell>{it.barcode || '—'}</TableCell>
                  <TableCell>{it.unit}</TableCell>
                  <TableCell align="right">{it.vatRate > 0 ? `${(it.vatRate * 100).toFixed(0)}%` : 'zero-rated'}</TableCell>
                  <TableCell>{it.requiresBatchTracking ? 'Yes' : 'No'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={5} sx={{ p: 0, border: expandedItem === it.itemNo ? undefined : 'none' }}>
                    <Collapse in={expandedItem === it.itemNo}>
                      <Box sx={{ p: 1.5, bgcolor: 'action.hover' }}>
                        {batchesLoading ? (
                          <CircularProgress size={16} />
                        ) : batches.length === 0 ? (
                          <Typography variant="caption" color="text.secondary">No batches with stock on hand.</Typography>
                        ) : (
                          <Stack spacing={0.5}>
                            {batches.map((b) => (
                              <Stack key={b.batchNo + b.expiryDate} direction="row" spacing={2}>
                                <Typography variant="caption">Batch {b.batchNo}</Typography>
                                <Typography variant="caption">Exp {b.expiryDate}</Typography>
                                <Typography variant="caption">Qty {b.qtyOnHand}</Typography>
                                <Typography variant="caption">Price {b.salePrice.toFixed(2)}</Typography>
                              </Stack>
                            ))}
                          </Stack>
                        )}
                      </Box>
                    </Collapse>
                  </TableCell>
                </TableRow>
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}

      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Customer search</Typography>
      <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Customer name or number"
          value={custQuery}
          onChange={(e) => setCustQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runCustomerSearch()}
        />
      </Stack>
      {custError && <Alert severity="error" sx={{ mb: 1 }}>{custError}</Alert>}
      {custLoading && <CircularProgress size={20} />}
      {customers.length > 0 && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Customer</TableCell>
              <TableCell>VAT File No.</TableCell>
              <TableCell>Invoice Type</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {customers.map((c) => (
              <TableRow key={c.custNo} hover>
                <TableCell>
                  <Typography variant="body2">{c.nameEn || c.nameAr}</Typography>
                  <Typography variant="caption" color="text.secondary">#{c.custNo} · {c.nameAr}</Typography>
                </TableCell>
                <TableCell>{c.vatFileNo || '—'}</TableCell>
                <TableCell>
                  <Chip size="small" label={c.vatFileNo ? 'Standard (B2B)' : 'Simplified (B2C)'} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Paper>
  );
}
