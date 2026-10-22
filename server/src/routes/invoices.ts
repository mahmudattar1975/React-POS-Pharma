import { Router } from 'express';
import { submitSaleInvoice, type SubmitSaleInvoiceRequest } from '../zatca/submitSaleInvoice.js';

export const invoicesRouter = Router();

invoicesRouter.post('/', async (req, res) => {
  try {
    const result = await submitSaleInvoice(req.body as SubmitSaleInvoiceRequest);
    res.json(result);
  } catch (err) {
    // Submission failures (network, ZATCA rejection, no CSID yet) are business-as-usual for a POS
    // that must keep selling even when ZATCA reporting is temporarily unavailable - 502 rather
    // than 500 so the frontend can tell "ZATCA didn't accept this" apart from "server broke".
    res.status(502).json({ error: String(err) });
  }
});
