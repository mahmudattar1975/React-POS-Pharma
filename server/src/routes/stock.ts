import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { terminalBranch } from '../branch.js';
import { DEFAULT_BRANCHES } from '../branches.js';

// "Not enough qty here — where else is it?" The stock answer comes from OUR shared PharmaDB,
// not the read-only ERP, so it works for local catalogue items too. A failure here is advisory:
// the POS shows "can't check right now" and never blocks a sale.
export const stockRouter = Router();

stockRouter.get('/other-branches', async (req, res) => {
  const itemId = typeof req.query.itemId === 'string' ? req.query.itemId.trim() : '';
  if (!itemId) {
    res.status(400).json({ error: 'itemId is required.' });
    return;
  }

  try {
    const totals = await prisma.batch.groupBy({
      by: ['branchId'],
      where: {
        itemId,
        branchId: { not: terminalBranch.id },
        qtyOnHand: { gt: 0 },
      },
      _sum: { qtyOnHand: true },
    });

    let names = DEFAULT_BRANCHES;
    try {
      const rows = await prisma.branch.findMany({ orderBy: { code: 'asc' } });
      if (rows.length) names = rows;
    } catch {
      // Fallback names are enough to answer the question while the branch master is offline.
    }

    const byId = new Map(names.map((b) => [b.id, b]));
    const result = totals
      .map((t) => {
        const b = byId.get(t.branchId);
        const code = b?.code ?? t.branchId.toUpperCase().slice(0, 8);
        return {
          branchId: t.branchId,
          code,
          nameEn: b?.nameEn ?? t.branchId,
          nameAr: b?.nameAr ?? t.branchId,
          qtyOnHand: t._sum.qtyOnHand ?? 0,
        };
      })
      .filter((b) => b.qtyOnHand > 0)
      .sort((a, b) => a.code.localeCompare(b.code));

    res.json(result);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});
