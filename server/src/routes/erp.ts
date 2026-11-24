import { Router } from 'express';
import { getItemAndBatchesByBarcode, getOtherBranchStock, getSellableBatches, searchItems } from '../erp/items.js';
import { searchCustomers } from '../erp/customers.js';
import { getErpSession } from '../erp/erpAuth.js';
import { config } from '../config.js';

export const erpRouter = Router();

// This pharmacy's own real XPH store number - the frontend needs this to validate a multi-branch
// Head Office transfer file (see components/Receiving/HeadOfficeReceivingPage.tsx): a row destined
// for a DIFFERENT branch must never be imported into this pharmacy's own local inventory, since
// this app has no way to deliver it to the branch that actually received it, and no way to detect
// the mismatch later - see erp/README.md's "Multi-branch" section for why these systems don't
// otherwise talk to each other. 0 is the placeholder/unconfigured value (see .env.example) - the
// frontend must refuse to validate against it rather than silently accept or reject every row.
erpRouter.get('/store-no', (_req, res) => {
  res.json({ storeNo: config.erp.storeNo });
});

erpRouter.get('/status', async (_req, res) => {
  try {
    const session = await getErpSession();
    res.json({ connected: true, userId: session.userId, fapplType: session.fapplType, fapplSub: session.fapplSub });
  } catch (err) {
    res.status(502).json({ connected: false, error: String(err) });
  }
});

erpRouter.get('/items/by-barcode/:barcode', async (req, res) => {
  try {
    const result = await getItemAndBatchesByBarcode(req.params.barcode);
    if (!result) {
      res.status(404).json({ error: 'No item found for that barcode' });
      return;
    }
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

erpRouter.get('/items/search', async (req, res) => {
  try {
    res.json(await searchItems(String(req.query.q ?? '')));
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

erpRouter.get('/items/:itemNo/batches', async (req, res) => {
  try {
    res.json(await getSellableBatches(Number(req.params.itemNo)));
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

// Not confirmed live yet (see the comment on getOtherBranchStock) - a 502 here just means the
// cashier can't get a cross-branch answer right now, not that the sale itself is blocked.
erpRouter.get('/items/:itemNo/other-branches', async (req, res) => {
  try {
    res.json(await getOtherBranchStock(Number(req.params.itemNo)));
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

erpRouter.get('/customers/search', async (req, res) => {
  try {
    res.json(await searchCustomers(String(req.query.q ?? '')));
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});
