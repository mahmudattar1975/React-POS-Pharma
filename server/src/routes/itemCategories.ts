import { Router } from 'express';
import { requireAdmin } from '../auth/middleware.js';
import { prisma } from '../db/prisma.js';
import {
  MasterInputError, masterErrorResponse, nextMasterCode, parseMasterId, parseMasterWrite,
} from './masterHelpers.js';

// Shared category master for every branch. The Item Master links to CategoryID, while item.category
// stays the free-text label used by POS/cost-center rules. The masters screen writes here; codes are
// assigned once and never changed so other terminals keep resolving the same row.
export const itemCategoriesRouter = Router();

const FIELDS = {
  categoryId: true,
  categoryCode: true,
  nameAr: true,
  nameEn: true,
  parentCategoryId: true,
  isActive: true,
} as const;

itemCategoriesRouter.get('/', async (_req, res) => {
  try {
    const rows = await prisma.itemCategory.findMany({ orderBy: { categoryId: 'asc' }, select: FIELDS });
    res.json({ categories: rows });
  } catch (err) {
    masterErrorResponse(res, err);
  }
});

async function validateParent(parentCategoryId: number | null | undefined, selfId?: number): Promise<void> {
  if (!parentCategoryId) return;
  if (selfId && parentCategoryId === selfId) {
    throw new MasterInputError('A category cannot be its own parent.');
  }
  const parent = await prisma.itemCategory.findUnique({
    where: { categoryId: parentCategoryId },
    select: { categoryId: true },
  });
  if (!parent) throw new MasterInputError('That parent category does not exist.');
}

itemCategoriesRouter.post('/', requireAdmin, async (req, res) => {
  try {
    const input = parseMasterWrite(req.body);
    await validateParent(input.parentCategoryId);
    const codes = await prisma.itemCategory.findMany({ select: { categoryCode: true } });
    const code = input.code ?? nextMasterCode(codes.map((row) => row.categoryCode), 'CAT-', 3);
    const row = await prisma.itemCategory.create({
      data: {
        categoryCode: code,
        nameAr: input.nameAr,
        nameEn: input.nameEn,
        isActive: input.isActive ?? true,
        parentCategoryId: input.parentCategoryId ?? null,
      },
      select: FIELDS,
    });
    res.status(201).json({ category: row });
  } catch (err) {
    masterErrorResponse(res, err);
  }
});

itemCategoriesRouter.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseMasterId(req.params.id);
    const input = parseMasterWrite(req.body);
    await validateParent(input.parentCategoryId, id);
    const row = await prisma.itemCategory.update({
      where: { categoryId: id },
      data: {
        nameAr: input.nameAr,
        nameEn: input.nameEn,
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.parentCategoryId !== undefined ? { parentCategoryId: input.parentCategoryId } : {}),
      },
      select: FIELDS,
    });
    res.json({ category: row });
  } catch (err) {
    masterErrorResponse(res, err);
  }
});
