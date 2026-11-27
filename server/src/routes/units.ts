import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { masterErrorResponse, nextMasterCode, parseMasterId, parseMasterWrite } from './masterHelpers.js';

// Shared unit-of-measure master for every branch. The Item Master links to UnitNameEn while
// items.unitId remains a SQL-side FK for reporting, so this is lookup data plus masters-screen writes.
export const unitsRouter = Router();

const FIELDS = { unitId: true, unitCode: true, nameAr: true, nameEn: true, isActive: true } as const;

unitsRouter.get('/', async (_req, res) => {
  try {
    const rows = await prisma.unit.findMany({ orderBy: { unitId: 'asc' }, select: FIELDS });
    res.json({ units: rows });
  } catch (err) {
    masterErrorResponse(res, err);
  }
});

unitsRouter.post('/', async (req, res) => {
  try {
    const input = parseMasterWrite(req.body);
    const codes = await prisma.unit.findMany({ select: { unitCode: true } });
    const code = input.code ?? nextMasterCode(codes.map((row) => row.unitCode), 'UNT-', 3);
    const row = await prisma.unit.create({
      data: {
        unitCode: code,
        nameAr: input.nameAr,
        nameEn: input.nameEn,
        isActive: input.isActive ?? true,
      },
      select: FIELDS,
    });
    res.status(201).json({ unit: row });
  } catch (err) {
    masterErrorResponse(res, err);
  }
});

unitsRouter.patch('/:id', async (req, res) => {
  try {
    const id = parseMasterId(req.params.id);
    const input = parseMasterWrite(req.body);
    const row = await prisma.unit.update({
      where: { unitId: id },
      data: {
        nameAr: input.nameAr,
        nameEn: input.nameEn,
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      select: FIELDS,
    });
    res.json({ unit: row });
  } catch (err) {
    masterErrorResponse(res, err);
  }
});
