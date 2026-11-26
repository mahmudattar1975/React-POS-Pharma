import { Router } from 'express';
import { prisma } from '../db/prisma.js';

// Shared category master for every branch. This is lookup data only: the Item Master links to
// CategoryID, while item.category stays the free-text label used by POS/cost-center rules.
export const itemCategoriesRouter = Router();

itemCategoriesRouter.get('/', async (_req, res) => {
  try {
    const rows = await prisma.itemCategory.findMany({
      orderBy: { categoryId: 'asc' },
      select: {
        categoryId: true,
        categoryCode: true,
        nameAr: true,
        nameEn: true,
        parentCategoryId: true,
        isActive: true,
      },
    });
    res.json({ categories: rows });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
