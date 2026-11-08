import { Router } from 'express';
import { submitSaleInvoice, type SubmitSaleInvoiceRequest } from '../zatca/submitSaleInvoice.js';
import { findArchivedInvoice, listArchivedInvoices } from '../store/invoiceArchive.js';

export const invoicesRouter = Router();

// Retention reads. These are what the frontend's E-Invoices page uses to show the signed document
// that ZATCA actually accepted - deliberately served from the archive, never re-built from the sale,
// because a re-built document would not be the one that was stamped.
invoicesRouter.get('/', async (req, res) => {
  const limit = Number(req.query.limit ?? 200);
  const invoices = await listArchivedInvoices(Number.isFinite(limit) && limit > 0 ? limit : 200);
  res.json({ invoices });
});

invoicesRouter.get('/:uuid', async (req, res) => {
  const found = await findArchivedInvoice(req.params.uuid);
  if (!found) {
    res.status(404).json({ error: `No archived invoice with UUID ${req.params.uuid}.` });
    return;
  }
  res.json(found);
});

invoicesRouter.post('/', async (req, res) => {
  try {
    const result = await submitSaleInvoice(req.body as SubmitSaleInvoiceRequest);
    res.json(result);
  } catch (err) {
    // Submission failures (network, ZATCA rejection, no CSID yet) are business-as-usual for a POS
    // that must keep selling even when ZATCA reporting is temporarily unavailable - 502 rather
    // than 500 so the frontend can tell "ZATCA didn't accept this" apart from "server broke". The
    // message (not "Error: ...") is what the invoice's zatcaFailureReason stores.
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
