import { Router } from 'express';
import { requireAdmin } from '../auth/middleware.js';
import { prisma } from '../db/prisma.js';
import { masterErrorResponse, nextMasterCode, parseMasterId, parseMasterWrite } from './masterHelpers.js';

// Shared brand master (dbo.BrandMaster). The 131 approved brands are seeded by migration
// 20261127030000; this route adds the masters-screen writes. BrandCode is assigned once and stays
// read-only on edit so items and other terminals keep pointing at the same row.
export const brandsRouter = Router();

const FIELDS = {
  brandId: true,
  brandCode: true,
  nameAr: true,
  nameEn: true,
  manufacturerId: true,
  countryOfOrigin: true,
  isActive: true,
} as const;

brandsRouter.get('/', async (_req, res) => {
  try {
    const rows = await prisma.brand.findMany({ orderBy: { brandId: 'asc' }, select: FIELDS });
    res.json({ brands: rows });
  } catch (err) {
    masterErrorResponse(res, err);
  }
});

brandsRouter.post('/', requireAdmin, async (req, res) => {
  try {
    const input = parseMasterWrite(req.body);
    const codes = await prisma.brand.findMany({ select: { brandCode: true } });
    const code = input.code ?? nextMasterCode(codes.map((row) => row.brandCode), 'BR-', 4);
    const row = await prisma.brand.create({
      data: {
        brandCode: code,
        nameAr: input.nameAr,
        nameEn: input.nameEn,
        isActive: input.isActive ?? true,
      },
      select: FIELDS,
    });
    res.status(201).json({ brand: row });
  } catch (err) {
    masterErrorResponse(res, err);
  }
});

brandsRouter.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseMasterId(req.params.id);
    const input = parseMasterWrite(req.body);
    const row = await prisma.brand.update({
      where: { brandId: id },
      data: {
        nameAr: input.nameAr,
        nameEn: input.nameEn,
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      select: FIELDS,
    });
    res.json({ brand: row });
  } catch (err) {
    masterErrorResponse(res, err);
  }
});
