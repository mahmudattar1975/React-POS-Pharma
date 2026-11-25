// HTTP surface for the incentive / profit-bonus feature (Phase A/B).
// Mounted at /api/incentives. Mirrors src/types/incentive.ts.
import { Router, type Request, type Response } from 'express';
import { prisma } from '../db/prisma.js';

export const incentivesRouter = Router();

function fail(res: Response, err: unknown): void {
  console.error('[incentives] unexpected error:', err);
  res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
}

function q(req: Request, key: string): string | undefined {
  const v = req.query[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  return typeof v === 'number' ? v : Number(v);
}

// ---- Items (curated incentive list) -------------------------------------------

incentivesRouter.get('/items', async (req, res) => {
  try {
    const active = q(req, 'active');
    const itemId = q(req, 'itemId');
    const where: Record<string, unknown> = {};
    if (active === 'true') where.active = true;
    if (active === 'false') where.active = false;
    if (itemId) where.itemId = itemId;
    const rows = await prisma.incentiveItem.findMany({
      where,
      include: { item: { select: { nameEn: true, nameAr: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(rows.map((r) => ({
      id: r.id,
      itemId: r.itemId,
      itemNameEn: r.item?.nameEn ?? null,
      itemNameAr: r.item?.nameAr ?? null,
      incentiveType: r.incentiveType,
      rate: toNum(r.rate),
      activeFrom: r.activeFrom.toISOString().slice(0, 10),
      activeTo: r.activeTo.toISOString().slice(0, 10),
      branchNo: r.branchNo,
      active: r.active,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })));
  } catch (err) {
    fail(res, err);
  }
});

incentivesRouter.get('/active', async (req, res) => {
  try {
    const dateStr = q(req, 'date') ?? new Date().toISOString().slice(0, 10);
    const d = new Date(dateStr);
    const rows = await prisma.incentiveItem.findMany({
      where: { active: true, activeFrom: { lte: d }, activeTo: { gte: d } },
      include: { item: { select: { nameEn: true, nameAr: true } } },
    });
    res.json(rows.map((r) => ({
      id: r.id,
      itemId: r.itemId,
      itemNameEn: r.item?.nameEn ?? null,
      itemNameAr: r.item?.nameAr ?? null,
      incentiveType: r.incentiveType,
      rate: toNum(r.rate),
      activeFrom: r.activeFrom.toISOString().slice(0, 10),
      activeTo: r.activeTo.toISOString().slice(0, 10),
      branchNo: r.branchNo,
      active: r.active,
    })));
  } catch (err) {
    fail(res, err);
  }
});

incentivesRouter.post('/items', async (req, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const itemId = String(b.itemId ?? '').trim();
    const incentiveType = String(b.incentiveType ?? '').trim();
    const rate = Number(b.rate);
    const activeFrom = String(b.activeFrom ?? '').trim();
    const activeTo = String(b.activeTo ?? '').trim();
    if (!itemId || !['percent', 'amount'].includes(incentiveType) || !Number.isFinite(rate) || rate < 0) {
      res.status(400).json({ error: 'itemId, incentiveType (percent|amount), rate (>=0) are required.' });
      return;
    }
    if (!activeFrom || !activeTo) {
      res.status(400).json({ error: 'activeFrom and activeTo (ISO dates) are required.' });
      return;
    }
    const row = await prisma.incentiveItem.create({
      data: {
        itemId,
        incentiveType,
        rate,
        activeFrom: new Date(activeFrom),
        activeTo: new Date(activeTo),
        branchNo: b.branchNo === undefined || b.branchNo === null ? null : Number(b.branchNo),
        active: b.active === undefined ? true : Boolean(b.active),
      },
      include: { item: { select: { nameEn: true, nameAr: true } } },
    });
    res.status(201).json({
      id: row.id,
      itemId: row.itemId,
      itemNameEn: row.item?.nameEn ?? null,
      itemNameAr: row.item?.nameAr ?? null,
      incentiveType: row.incentiveType,
      rate: toNum(row.rate),
      activeFrom: row.activeFrom.toISOString().slice(0, 10),
      activeTo: row.activeTo.toISOString().slice(0, 10),
      branchNo: row.branchNo,
      active: row.active,
    });
  } catch (err) {
    fail(res, err);
  }
});

incentivesRouter.put('/items/:id', async (req, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if (b.incentiveType !== undefined) {
      if (!['percent', 'amount'].includes(String(b.incentiveType))) {
        res.status(400).json({ error: 'incentiveType must be percent or amount.' });
        return;
      }
      data.incentiveType = String(b.incentiveType);
    }
    if (b.rate !== undefined) {
      const r = Number(b.rate);
      if (!Number.isFinite(r) || r < 0) { res.status(400).json({ error: 'rate must be >= 0.' }); return; }
      data.rate = r;
    }
    if (b.activeFrom !== undefined) data.activeFrom = new Date(String(b.activeFrom));
    if (b.activeTo !== undefined) data.activeTo = new Date(String(b.activeTo));
    if (b.branchNo !== undefined) data.branchNo = b.branchNo === null ? null : Number(b.branchNo);
    if (b.active !== undefined) data.active = Boolean(b.active);
    const row = await prisma.incentiveItem.update({
      where: { id: req.params.id },
      data,
      include: { item: { select: { nameEn: true, nameAr: true } } },
    });
    res.json({
      id: row.id,
      itemId: row.itemId,
      itemNameEn: row.item?.nameEn ?? null,
      itemNameAr: row.item?.nameAr ?? null,
      incentiveType: row.incentiveType,
      rate: toNum(row.rate),
      activeFrom: row.activeFrom.toISOString().slice(0, 10),
      activeTo: row.activeTo.toISOString().slice(0, 10),
      branchNo: row.branchNo,
      active: row.active,
    });
  } catch (err) {
    fail(res, err);
  }
});

incentivesRouter.delete('/items/:id', async (req, res) => {
  try {
    await prisma.incentiveItem.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

// ---- Records (batch record of sale incentives) --------------------------------

incentivesRouter.post('/records', async (req, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const saleId = String(b.saleId ?? '').trim();
    const invoiceNo = String(b.invoiceNo ?? '').trim();
    const invoiceDate = String(b.invoiceDate ?? '').trim();
    const cashierName = String(b.cashierName ?? '').trim();
    const lines = Array.isArray(b.lines) ? (b.lines as Record<string, unknown>[]) : [];
    if (!saleId || !invoiceNo || !invoiceDate) {
      res.status(400).json({ error: 'saleId, invoiceNo, invoiceDate are required.' });
      return;
    }
    const created = await prisma.$transaction(
      lines
        .filter((l) => Number(l.incentiveAmount ?? 0) > 0)
        .map((l) =>
          prisma.incentiveRecord.create({
            data: {
              saleId,
              invoiceNo,
              invoiceDate: new Date(invoiceDate),
              itemId: String(l.itemId ?? ''),
              itemNameEn: String(l.itemNameEn ?? ''),
              qty: Number(l.qty ?? 0),
              saleAmount: Number(l.saleAmount ?? 0),
              incentiveType: String(l.incentiveType ?? 'percent'),
              rate: Number(l.rate ?? 0),
              incentiveAmount: Number(l.incentiveAmount ?? 0),
              cashierName,
              branchNo: l.branchNo === undefined || l.branchNo === null ? null : Number(l.branchNo),
              incentiveItemId: l.incentiveItemId ? String(l.incentiveItemId) : null,
            },
          }),
        ),
    );
    res.status(201).json({ ok: true, count: created.length });
  } catch (err) {
    fail(res, err);
  }
});

// ---- Report --------------------------------------------------------------------

incentivesRouter.get('/report', async (req, res) => {
  try {
    const from = q(req, 'from');
    const to = q(req, 'to');
    const cashier = q(req, 'cashier');
    const itemId = q(req, 'itemId');
    const where: Record<string, unknown> = {};
    if (from || to) {
      const dateFilter: Record<string, Date> = {};
      if (from) dateFilter.gte = new Date(from);
      if (to) {
        const t = new Date(to);
        t.setDate(t.getDate() + 1);
        dateFilter.lt = t;
      }
      where.invoiceDate = dateFilter;
    }
    if (cashier) where.cashierName = cashier;
    if (itemId) where.itemId = itemId;
    const rows = await prisma.incentiveRecord.findMany({
      where,
      orderBy: { invoiceDate: 'desc' },
    });
    res.json(rows.map((r) => ({
      id: r.id,
      saleId: r.saleId,
      invoiceNo: r.invoiceNo,
      invoiceDate: r.invoiceDate.toISOString(),
      itemId: r.itemId,
      itemNameEn: r.itemNameEn,
      qty: r.qty,
      saleAmount: toNum(r.saleAmount),
      incentiveType: r.incentiveType,
      rate: toNum(r.rate),
      incentiveAmount: toNum(r.incentiveAmount),
      cashierName: r.cashierName,
      createdAt: r.createdAt.toISOString(),
    })));
  } catch (err) {
    fail(res, err);
  }
});

incentivesRouter.get('/report/summary', async (req, res) => {
  try {
    const from = q(req, 'from');
    const to = q(req, 'to');
    const where: Record<string, unknown> = {};
    if (from || to) {
      const dateFilter: Record<string, Date> = {};
      if (from) dateFilter.gte = new Date(from);
      if (to) {
        const t = new Date(to);
        t.setDate(t.getDate() + 1);
        dateFilter.lt = t;
      }
      where.invoiceDate = dateFilter;
    }
    const rows = await prisma.incentiveRecord.findMany({ where });
    // daily buckets
    const buckets = new Map<string, { date: string; invoiceCount: number; totalSaleAmount: number; totalIncentive: number; invoices: Set<string> }>();
    for (const r of rows) {
      const day = r.invoiceDate.toISOString().slice(0, 10);
      if (!buckets.has(day)) buckets.set(day, { date: day, invoiceCount: 0, totalSaleAmount: 0, totalIncentive: 0, invoices: new Set() });
      const b = buckets.get(day)!;
      b.invoices.add(r.invoiceNo);
      b.totalSaleAmount += toNum(r.saleAmount);
      b.totalIncentive += toNum(r.incentiveAmount);
    }
    const summary = [...buckets.values()]
      .map((b) => ({
        date: b.date,
        invoiceCount: b.invoices.size,
        totalSaleAmount: Math.round(b.totalSaleAmount * 100) / 100,
        totalIncentive: Math.round(b.totalIncentive * 100) / 100,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const totals = {
      invoiceCount: new Set(rows.map((r) => r.invoiceNo)).size,
      totalSaleAmount: Math.round(rows.reduce((s, r) => s + toNum(r.saleAmount), 0) * 100) / 100,
      totalIncentive: Math.round(rows.reduce((s, r) => s + toNum(r.incentiveAmount), 0) * 100) / 100,
    };
    res.json({ days: summary, totals });
  } catch (err) {
    fail(res, err);
  }
});
