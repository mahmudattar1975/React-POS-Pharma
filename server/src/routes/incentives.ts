// HTTP surface for the incentive / profit-bonus feature (Phase A/B).
// Mounted at /api/incentives. The browser contract still mirrors src/types/incentive.ts, but the
// data now lives in the separate dotnet_pos database: commission_item holds the curated item list
// and pos/pos_item hold the commission ledger (see prisma/dotnet-pos-schema.prisma).
import { Router, type Request, type Response } from 'express';
import { requireAdmin } from '../auth/middleware.js';
import {
  Prisma,
  type CommissionItem,
  type Item,
  type Pos,
  type PosItem,
} from '../../node_modules/.prisma/dotnet-pos-client/index.js';
import { dotnetPos } from '../db/dotnetPosPrisma.js';
import { prisma } from '../db/prisma.js';
import { terminalBranch } from '../branch.js';
import { RequestError, badRequest } from '../validation/common.js';

export const incentivesRouter = Router();

function fail(res: Response, err: unknown): void {
  if (err instanceof RequestError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error('[incentives] unexpected error:', err);
  res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
}

function q(req: Request, key: string): string | undefined {
  const v = req.query[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parsePositiveId(v: string): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// dotnet-pos's CommissionType is a legacy code: 1 = percentage of net sales, any other value =
// fixed amount per unit (see .mdfile/pb-profit-analysis.md).
function commissionTypeOf(type: string): number {
  return type === 'percent' ? 1 : 2;
}

function incentiveTypeOf(type: number): 'percent' | 'amount' {
  return type === 1 ? 'percent' : 'amount';
}

type CommissionItemWithItem = CommissionItem & { item: Item };
type PosItemWithRelations = PosItem & { pos: Pos; item: Item };

interface IncentiveRecordView {
  id: string;
  saleId: string;
  invoiceNo: string;
  invoiceDate: string;
  itemId: string; // barcode - the stable key shared by the POS catalog and dotnet_pos.item.Code
  itemNameEn: string;
  qty: number;
  saleAmount: number;
  incentiveType: 'percent' | 'amount';
  rate: number;
  incentiveAmount: number;
  cashierName: string;
  createdAt: string;
}

// Frontend catalog ids are strings like 'itm-1'; dotnet_pos keys items by int Id and by barcode in
// Code. The incentive UI stores the barcode as itemId so the two databases agree without a mapping
// table, but accept a numeric id too for older/manual callers.
async function findDotnetItem(key: string): Promise<Item | null> {
  const numeric = parsePositiveId(key);
  return dotnetPos.item.findFirst({
    where: numeric !== null ? { OR: [{ code: key }, { id: numeric }] } : { code: key },
  });
}

function mapCommissionItem(r: CommissionItemWithItem) {
  return {
    id: String(r.id),
    itemId: r.item.code,
    itemNameEn: r.item.name,
    itemNameAr: r.item.name, // dotnet_pos has one display name, not separate AR/EN columns
    incentiveType: incentiveTypeOf(r.commissionType),
    rate: toNum(r.commissionValue),
    activeFrom: day(r.activeFrom),
    activeTo: day(r.activeTo),
    branchNo: null,
    active: r.isActive,
    createdAt: r.activeFrom.toISOString(),
    updatedAt: r.activeFrom.toISOString(),
  };
}

// ---- Items (curated incentive list -> dotnet_pos.commission_item) ------------------

incentivesRouter.get('/items', async (req, res) => {
  try {
    const active = q(req, 'active');
    const itemId = q(req, 'itemId');
    const where: Prisma.CommissionItemWhereInput = {};
    if (active === 'true') where.isActive = true;
    if (active === 'false') where.isActive = false;
    if (itemId) {
      const item = await findDotnetItem(itemId);
      if (!item) {
        res.json([]);
        return;
      }
      where.itemId = item.id;
    }
    const rows = await dotnetPos.commissionItem.findMany({
      where,
      include: { item: true },
      orderBy: { id: 'desc' },
    });
    res.json(rows.map(mapCommissionItem));
  } catch (err) {
    fail(res, err);
  }
});

incentivesRouter.get('/active', async (req, res) => {
  try {
    const dateStr = q(req, 'date') ?? day(new Date());
    const d = new Date(`${dateStr}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) {
      res.status(400).json({ error: 'date must be an ISO date (YYYY-MM-DD).' });
      return;
    }
    const rows = await dotnetPos.commissionItem.findMany({
      where: { isActive: true, activeFrom: { lte: d }, activeTo: { gte: d } },
      include: { item: true },
      orderBy: { id: 'desc' },
    });
    res.json(rows.map(mapCommissionItem));
  } catch (err) {
    fail(res, err);
  }
});

incentivesRouter.post('/items', requireAdmin, async (req, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const itemKey = String(b.itemId ?? '').trim();
    const incentiveType = String(b.incentiveType ?? '').trim();
    const rate = Number(b.rate);
    const activeFrom = String(b.activeFrom ?? '').trim();
    const activeTo = String(b.activeTo ?? '').trim();
    if (!itemKey || !['percent', 'amount'].includes(incentiveType) || !Number.isFinite(rate) || rate < 0) {
      res.status(400).json({ error: 'itemId, incentiveType (percent|amount), rate (>=0) are required.' });
      return;
    }
    if (!activeFrom || !activeTo) {
      res.status(400).json({ error: 'activeFrom and activeTo (ISO dates) are required.' });
      return;
    }
    const item = await findDotnetItem(itemKey);
    if (!item) {
      res.status(400).json({ error: `Unknown dotnet_pos item: ${itemKey}. Use the item's barcode.` });
      return;
    }
    // One rule per item. Editing the existing row is the supported way to change or disable it;
    // without this guard a second Add (or a direct API call) would silently double-pay commission.
    const duplicate = await dotnetPos.commissionItem.findFirst({ where: { itemId: item.id } });
    if (duplicate) {
      res.status(409).json({
        error: 'This item already has an incentive rule. Edit the existing rule instead.',
        existingId: String(duplicate.id),
      });
      return;
    }
    const row = await dotnetPos.commissionItem.create({
      data: {
        itemId: item.id,
        commissionType: commissionTypeOf(incentiveType),
        commissionValue: rate,
        activeFrom: new Date(`${activeFrom}T00:00:00Z`),
        activeTo: new Date(`${activeTo}T23:59:59Z`),
        isActive: b.active === undefined ? true : Boolean(b.active),
      },
      include: { item: true },
    });
    res.status(201).json(mapCommissionItem(row));
  } catch (err) {
    fail(res, err);
  }
});

incentivesRouter.put('/items/:id', requireAdmin, async (req, res) => {
  try {
    const id = parsePositiveId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid incentive item id.' });
      return;
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const existing = await dotnetPos.commissionItem.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Incentive item not found.' });
      return;
    }
    const data: Prisma.CommissionItemUpdateInput = {};
    if (b.itemId !== undefined) {
      const item = await findDotnetItem(String(b.itemId).trim());
      if (!item) {
        res.status(400).json({ error: `Unknown dotnet_pos item: ${String(b.itemId)}.` });
        return;
      }
      data.item = { connect: { id: item.id } };
    }
    if (b.incentiveType !== undefined) {
      const type = String(b.incentiveType);
      if (!['percent', 'amount'].includes(type)) {
        res.status(400).json({ error: 'incentiveType must be percent or amount.' });
        return;
      }
      data.commissionType = commissionTypeOf(type);
    }
    if (b.rate !== undefined) {
      const rate = Number(b.rate);
      if (!Number.isFinite(rate) || rate < 0) {
        res.status(400).json({ error: 'rate must be >= 0.' });
        return;
      }
      data.commissionValue = rate;
    }
    if (b.activeFrom !== undefined) data.activeFrom = new Date(`${String(b.activeFrom).slice(0, 10)}T00:00:00Z`);
    if (b.activeTo !== undefined) data.activeTo = new Date(`${String(b.activeTo).slice(0, 10)}T23:59:59Z`);
    if (b.active !== undefined) data.isActive = Boolean(b.active);
    const row = await dotnetPos.commissionItem.update({
      where: { id },
      data,
      include: { item: true },
    });
    res.json(mapCommissionItem(row));
  } catch (err) {
    fail(res, err);
  }
});

incentivesRouter.delete('/items/:id', requireAdmin, async (req, res) => {
  try {
    const id = parsePositiveId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid incentive item id.' });
      return;
    }
    await dotnetPos.commissionItem.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

// ---- Records (batch write into dotnet_pos.pos_item.CommissionAmount) ---------------

interface RecordLine {
  itemId: string;
  barcode?: string;
  itemNameEn?: string;
  qty?: number;
  saleAmount?: number;
  incentiveAmount?: number;
  incentiveType?: string;
  rate?: number;
  posItemId?: number;
  incentiveItemId?: string;
}

async function findOrCreatePos(
  invoiceNo: string,
  invoiceDate: Date,
  cashierName: string,
  total: number,
  posSaleId: number | undefined,
  expectedInvoiceNo: string,
): Promise<Pos> {
  // SEC-08: a client-supplied posSaleId is only a hint. Resolve it back to the verified invoice
  // number before using it, so a return cannot land its clawback on an unrelated sale's ledger.
  if (posSaleId !== undefined) {
    const original = await dotnetPos.pos.findUnique({ where: { id: posSaleId } });
    if (!original) throw badRequest('Unknown posSaleId.');
    if (original.invoiceNo !== expectedInvoiceNo) {
      throw badRequest('posSaleId does not belong to this invoice.');
    }
    return original;
  }
  const existing = await dotnetPos.pos.findFirst({ where: { invoiceNo }, orderBy: { id: 'desc' } });
  if (existing) return existing;
  const cashier = cashierName
    ? await dotnetPos.cashier.findFirst({ where: { OR: [{ fullName: cashierName }, { username: cashierName }] } })
    : null;
  // The dotnet-pos mirror normally creates this row first. This fallback keeps an incentive from
  // being lost when that mirror failed but the local sale still completed.
  return dotnetPos.pos.create({
    data: {
      invoiceNo,
      saleDate: invoiceDate,
      cashierId: cashier?.id ?? 0,
      cashierName: cashierName || null,
      subTotal: total,
      discountAmount: 0,
      vatAmount: 0,
      totalAmount: total,
      paymentMethod: 1,
      status: 1,
      createdOn: invoiceDate,
      shiftId: 0,
    },
  });
}

async function applyCommission(client: typeof dotnetPos, pos: Pos, item: Item | null, line: RecordLine): Promise<void> {
  const amount = toNum(line.incentiveAmount);
  const qty = toNum(line.qty);
  const saleAmount = toNum(line.saleAmount);
  const specifiedId = parsePositiveId(String(line.posItemId ?? ''));
  // SEC-08: resolve the target through the verified invoice (and item) instead of trusting the
  // client id. A return may carry a different invoice number, but its pos_item still belongs to
  // the original sale row resolved above.
  let posItem = null;
  if (specifiedId !== null) {
    posItem = await client.posItem.findFirst({
      where: { id: specifiedId, posId: pos.id, ...(item ? { itemId: item.id } : {}) },
    });
    if (!posItem) throw badRequest('posItemId does not belong to this invoice/item.');
  }
  if (!posItem && item) {
    posItem = await client.posItem.findFirst({ where: { posId: pos.id, itemId: item.id } });
  }

  if (posItem) {
    await client.posItem.update({
      where: { id: posItem.id },
      // Positive is a fresh grant (set, so replays don't double-count); negative is a return
      // clawback, which must accumulate against the original grant.
      data: { commissionAmount: amount >= 0 ? amount : { increment: amount } },
    });
    return;
  }
  if (!item) return; // no way to create a pos_item without a valid ItemId
  await client.posItem.create({
    data: {
      posId: pos.id,
      itemId: item.id,
      itemName: String(line.itemNameEn ?? item.name),
      qty,
      unitPrice: qty > 0 ? saleAmount / qty : 0,
      vatRate: 0,
      lineTotal: saleAmount,
      returnedQty: 0,
      commissionAmount: amount,
    },
  });
}

incentivesRouter.post('/records', requireAdmin, async (req, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const invoiceNo = String(b.invoiceNo ?? '').trim();
    const invoiceDate = new Date(String(b.invoiceDate ?? '').trim());
    const cashierName = String(b.cashierName ?? '').trim();
    const saleId = String(b.saleId ?? '').trim();
    const lines = (Array.isArray(b.lines) ? b.lines : []) as RecordLine[];
    if (!invoiceNo || Number.isNaN(invoiceDate.getTime())) {
      res.status(400).json({ error: 'invoiceNo and a valid invoiceDate are required.' });
      return;
    }
    if (lines.length > 500) {
      res.status(400).json({ error: 'lines must contain at most 500 entries.' });
      return;
    }
    for (const line of lines) {
      const amount = toNum(line.incentiveAmount);
      const qty = toNum(line.qty);
      const saleAmount = toNum(line.saleAmount);
      const rate = toNum(line.rate);
      const type = String(line.incentiveType ?? 'percent');
      if (!['percent', 'amount'].includes(type) || !Number.isFinite(amount) || !Number.isFinite(qty)
        || !Number.isFinite(saleAmount) || !Number.isFinite(rate) || qty < 0 || saleAmount < 0
        || rate < 0 || (type === 'percent' ? rate > 1 : rate > 1_000_000)) {
        res.status(400).json({ error: 'Invalid commission line (type, qty, amounts or rate).' });
        return;
      }
    }

    // SEC-03/08: the original invoice must belong to this terminal. For a return this also gives
    // the ORIGINAL invoice number, which is what the dotnet-pos sale row must match.
    const localSale = saleId
      ? await prisma.sale.findFirst({
          where: { id: saleId, branchId: terminalBranch.id },
          select: { id: true, invoiceNo: true },
        })
      : null;
    const expectedInvoiceNo = localSale?.invoiceNo ?? invoiceNo;

    // A return's negative clawback is an increment on the original grant. Once the return has
    // been backed up locally, a replay of this mirror must not increment it again.
    if (lines.some((l) => toNum(l.incentiveAmount) < 0)) {
      const recordedReturn = await prisma.returnRecord.findFirst({
        where: { returnNo: invoiceNo, branchId: terminalBranch.id },
        select: { id: true },
      });
      if (recordedReturn) {
        res.status(201).json({ ok: true, count: 0, duplicate: true });
        return;
      }
    }

    const applicable = lines.filter((l) => toNum(l.incentiveAmount) !== 0);
    if (applicable.length === 0) {
      res.status(201).json({ ok: true, count: 0 });
      return;
    }
    const total = applicable.reduce((s, l) => s + Math.abs(toNum(l.saleAmount)), 0);
    const posSaleId = parsePositiveId(String(b.posSaleId ?? ''));
    const pos = await findOrCreatePos(invoiceNo, invoiceDate, cashierName, total, posSaleId ?? undefined, expectedInvoiceNo);
    await dotnetPos.$transaction(async (tx) => {
      for (const line of applicable) {
        const item = await findDotnetItem(String(line.barcode ?? line.itemId ?? '').trim());
        await applyCommission(tx as unknown as typeof dotnetPos, pos, item, line);
      }
    });
    res.status(201).json({ ok: true, count: applicable.length });
  } catch (err) {
    fail(res, err);
  }
});

// ---- Report (dotnet_pos.pos_item.CommissionAmount) ---------------------------------

async function queryRecords(req: Request): Promise<IncentiveRecordView[]> {
  const from = q(req, 'from');
  const to = q(req, 'to');
  const cashier = q(req, 'cashier');
  const itemId = q(req, 'itemId');

  const posFilter: Prisma.PosWhereInput = {};
  if (from || to) {
    const saleDate: Prisma.DateTimeFilter = {};
    if (from) saleDate.gte = new Date(`${from}T00:00:00Z`);
    if (to) {
      const t = new Date(`${to}T00:00:00Z`);
      t.setUTCDate(t.getUTCDate() + 1);
      saleDate.lt = t;
    }
    posFilter.saleDate = saleDate;
  }
  if (cashier) posFilter.cashierName = cashier;

  const where: Prisma.PosItemWhereInput = { commissionAmount: { not: 0 } };
  if (Object.keys(posFilter).length > 0) where.pos = posFilter;
  if (itemId) {
    const item = await findDotnetItem(itemId);
    where.itemId = item?.id ?? -1;
  }

  const rows = await dotnetPos.posItem.findMany({ where, include: { pos: true, item: true } });
  rows.sort((a, b) => b.pos.saleDate.getTime() - a.pos.saleDate.getTime());

  const itemIds = [...new Set(rows.map((r) => r.itemId))];
  const rules = itemIds.length
    ? await dotnetPos.commissionItem.findMany({ where: { itemId: { in: itemIds } } })
    : [];
  const ruleByItemId = new Map<number, (typeof rules)[number]>();
  for (const r of rules) if (!ruleByItemId.has(r.itemId)) ruleByItemId.set(r.itemId, r);

  return rows.map((r: PosItemWithRelations) => {
    const rule = ruleByItemId.get(r.itemId);
    const saleAmount = toNum(r.lineTotal);
    const commission = toNum(r.commissionAmount);
    // A rule may have been deleted after the sale; recover the effective percent from the ledger
    // so the report still shows 16.67% instead of a misleading 0%.
    const rate = rule
      ? toNum(rule.commissionValue)
      : saleAmount !== 0 ? Math.abs(commission / saleAmount) : 0;
    return {
      id: String(r.id),
      saleId: String(r.posId),
      invoiceNo: r.pos.invoiceNo,
      invoiceDate: r.pos.saleDate.toISOString(),
      itemId: r.item.code,
      itemNameEn: r.itemName || r.item.name,
      qty: toNum(r.qty),
      saleAmount,
      incentiveType: rule ? incentiveTypeOf(rule.commissionType) : 'percent',
      rate,
      incentiveAmount: commission,
      cashierName: r.pos.cashierName ?? '',
      createdAt: r.pos.createdOn.toISOString(),
    };
  });
}

incentivesRouter.get('/report', async (req, res) => {
  try {
    res.json(await queryRecords(req));
  } catch (err) {
    fail(res, err);
  }
});

incentivesRouter.get('/report/summary', async (req, res) => {
  try {
    const rows = await queryRecords(req);
    const buckets = new Map<string, { date: string; invoiceCount: number; totalSaleAmount: number; totalIncentive: number; invoices: Set<string> }>();
    for (const r of rows) {
      const bucketDate = r.invoiceDate.slice(0, 10);
      if (!buckets.has(bucketDate)) {
        buckets.set(bucketDate, { date: bucketDate, invoiceCount: 0, totalSaleAmount: 0, totalIncentive: 0, invoices: new Set() });
      }
      const b = buckets.get(bucketDate)!;
      b.invoices.add(r.invoiceNo);
      b.totalSaleAmount += r.saleAmount;
      b.totalIncentive += r.incentiveAmount;
    }
    const days = [...buckets.values()]
      .map((b) => ({
        date: b.date,
        invoiceCount: b.invoices.size,
        totalSaleAmount: Math.round(b.totalSaleAmount * 100) / 100,
        totalIncentive: Math.round(b.totalIncentive * 100) / 100,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    res.json({
      days,
      totals: {
        invoiceCount: new Set(rows.map((r) => r.invoiceNo)).size,
        totalSaleAmount: Math.round(rows.reduce((s, r) => s + r.saleAmount, 0) * 100) / 100,
        totalIncentive: Math.round(rows.reduce((s, r) => s + r.incentiveAmount, 0) * 100) / 100,
      },
    });
  } catch (err) {
    fail(res, err);
  }
});
