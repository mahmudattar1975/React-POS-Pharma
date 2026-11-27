import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { masterErrorResponse, nextMasterCode, parseMasterId, parseMasterWrite } from './masterHelpers.js';

// Shared shelf/store location master for every branch. Item.location is still an app-level text
// label, so this endpoint supplies canonical choices and masters-screen writes; it never rewrites
// existing items.
export const locationsRouter = Router();

const FIELDS = {
  locationId: true,
  locationCode: true,
  nameAr: true,
  nameEn: true,
  isActive: true,
} as const;

locationsRouter.get('/', async (_req, res) => {
  try {
    const rows = await prisma.location.findMany({ orderBy: { locationId: 'asc' }, select: FIELDS });
    res.json({ locations: rows });
  } catch (err) {
    masterErrorResponse(res, err);
  }
});

locationsRouter.post('/', async (req, res) => {
  try {
    const input = parseMasterWrite(req.body);
    const codes = await prisma.location.findMany({ select: { locationCode: true } });
    const code = input.code ?? nextMasterCode(codes.map((row) => row.locationCode), 'LOC-', 3);
    const row = await prisma.location.create({
      data: {
        locationCode: code,
        nameAr: input.nameAr,
        nameEn: input.nameEn,
        isActive: input.isActive ?? true,
      },
      select: FIELDS,
    });
    res.status(201).json({ location: row });
  } catch (err) {
    masterErrorResponse(res, err);
  }
});

locationsRouter.patch('/:id', async (req, res) => {
  try {
    const id = parseMasterId(req.params.id);
    const input = parseMasterWrite(req.body);
    const row = await prisma.location.update({
      where: { locationId: id },
      data: {
        nameAr: input.nameAr,
        nameEn: input.nameEn,
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      select: FIELDS,
    });
    res.json({ location: row });
  } catch (err) {
    masterErrorResponse(res, err);
  }
});
