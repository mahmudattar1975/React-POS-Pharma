// Print-friendly Wasfaty / NUPCO claim report.
//
// The on-screen page is built for filtering and scanning; a printed claim pack needs fewer columns,
// a repeated header on every page and an explicit filter/summary header. This dialog re-renders the
// same rows in that shape and prints only #wasfaty-claims-print-area, so the app chrome, filters and
// the server ledger card never end up on paper.
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import type { WasfatyClaimRow, WasfatyClaimSummary } from '../../types/wasfaty';

interface Props {
  open: boolean;
  rows: WasfatyClaimRow[];
  summary: WasfatyClaimSummary;
  month: string;
  branchLabel: string;
  generatedAt: string;
  onClose: () => void;
}

const HEADERS = [
  'Invoice / date',
  'Rx / auth',
  'Patient (masked)',
  'NUPCO code',
  'Item',
  'Batch / expiry',
  'Qty',
  'Unit price',
  'Line total',
  'Patient share',
  'Claim',
  'Status',
  'Exception',
];

function money(value: number): string {
  return value.toFixed(2);
}

export default function WasfatyClaimsPrintDialog({
  open,
  rows,
  summary,
  month,
  branchLabel,
  generatedAt,
  onClose,
}: Props) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <style>{`
        @page { size: A4 landscape; margin: 10mm; }
        @media print {
          body * { visibility: hidden; }
          #wasfaty-claims-print-area, #wasfaty-claims-print-area * { visibility: visible; }
          #wasfaty-claims-print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 0;
          }
          #wasfaty-claims-print-area thead { display: table-header-group; }
          #wasfaty-claims-print-area tr { break-inside: avoid; }
        }
      `}</style>
      <DialogTitle>
        Wasfaty claim report
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {month || 'All months'} · {branchLabel} · {summary.rows} line(s)
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Box
          id="wasfaty-claims-print-area"
          sx={{ bgcolor: '#fff', color: '#000', p: 2, fontFamily: 'Arial, sans-serif' }}
        >
          <Typography sx={{ fontSize: 18, fontWeight: 700 }}>Wasfaty / NUPCO claim report</Typography>
          <Typography sx={{ fontSize: 10, color: '#444', mb: 1 }}>
            {month ? `Claim month ${month}` : 'All months'} · {branchLabel} · generated{' '}
            {generatedAt.replace('T', ' ').slice(0, 19)}
          </Typography>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, fontSize: 10, mb: 1.5 }}>
            <span><strong>{summary.rows}</strong> lines</span>
            <span><strong>{summary.invoices}</strong> invoices</span>
            <span><strong>{money(summary.lineTotal)}</strong> SAR line total</span>
            <span><strong>{money(summary.patientShare)}</strong> SAR patient share</span>
            <span><strong>{money(summary.claimAmount)}</strong> SAR claim</span>
            <span><strong>{summary.exceptions}</strong> exception line(s)</span>
          </Box>

          {Object.keys(summary.byException).length > 0 && (
            <Typography sx={{ fontSize: 10, mb: 1.5 }}>
              Exceptions: {Object.entries(summary.byException).map(([reason, count]) => `${reason} (${count})`).join(' · ')}
            </Typography>
          )}

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
            <thead>
              <tr>
                {HEADERS.map((header) => (
                  <th
                    key={header}
                    style={{ borderBottom: '1px solid #000', textAlign: 'left', padding: '3px 4px', whiteSpace: 'nowrap' }}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={HEADERS.length} style={{ padding: 12, textAlign: 'center' }}>
                    No Wasfaty sales in this view.
                  </td>
                </tr>
              )}
              {rows.map((row, index) => (
                <tr key={`${row.invoiceNo}-${row.nupcoCode}-${index}`}>
                  <td style={{ borderBottom: '1px solid #ddd', padding: '2px 4px', whiteSpace: 'nowrap' }}>
                    {row.invoiceNo}
                    <br />
                    <span style={{ color: '#555' }}>{row.invoiceDate.slice(0, 10)}</span>
                  </td>
                  <td style={{ borderBottom: '1px solid #ddd', padding: '2px 4px' }}>
                    {row.prescriptionNo || '—'}
                    <br />
                    <span style={{ color: '#555' }}>{row.authorizationNo || 'No authorization'}</span>
                  </td>
                  <td style={{ borderBottom: '1px solid #ddd', padding: '2px 4px', whiteSpace: 'nowrap' }}>
                    {row.patientIdMasked || '—'}
                  </td>
                  <td style={{ borderBottom: '1px solid #ddd', padding: '2px 4px', fontFamily: 'monospace' }}>
                    {row.nupcoCode || '—'}
                  </td>
                  <td style={{ borderBottom: '1px solid #ddd', padding: '2px 4px' }}>
                    {row.itemNameEn}
                    {row.itemNameAr ? (
                      <>
                        <br />
                        <span dir="rtl" style={{ color: '#555' }}>{row.itemNameAr}</span>
                      </>
                    ) : null}
                  </td>
                  <td style={{ borderBottom: '1px solid #ddd', padding: '2px 4px', whiteSpace: 'nowrap' }}>
                    {row.batchNo || '—'}
                    <br />
                    <span style={{ color: '#555' }}>{row.expiryDate || '—'}</span>
                  </td>
                  <td style={{ borderBottom: '1px solid #ddd', padding: '2px 4px', textAlign: 'right' }}>
                    {row.qty} {row.unit}
                  </td>
                  <td style={{ borderBottom: '1px solid #ddd', padding: '2px 4px', textAlign: 'right' }}>
                    {money(row.nupcoUnitPrice)}
                  </td>
                  <td style={{ borderBottom: '1px solid #ddd', padding: '2px 4px', textAlign: 'right' }}>
                    {money(row.lineTotal)}
                  </td>
                  <td style={{ borderBottom: '1px solid #ddd', padding: '2px 4px', textAlign: 'right' }}>
                    {money(row.patientShare)}
                  </td>
                  <td style={{ borderBottom: '1px solid #ddd', padding: '2px 4px', textAlign: 'right', fontWeight: 600 }}>
                    {money(row.claimAmount)}
                  </td>
                  <td style={{ borderBottom: '1px solid #ddd', padding: '2px 4px' }}>{row.status}</td>
                  <td style={{ borderBottom: '1px solid #ddd', padding: '2px 4px' }}>{row.exception || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <Typography sx={{ fontSize: 8, color: '#555', mt: 1.5 }}>
            Rows are built from the issued invoices, not from today&apos;s item master. Patient national
            IDs are masked to the last four digits.
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button variant="outlined" startIcon={<PrintIcon />} onClick={() => window.print()}>
          Print
        </Button>
        <Button variant="contained" onClick={onClose} sx={{ flex: 1, minWidth: 120 }}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
