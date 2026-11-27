import { Router } from 'express';
import { requireAdmin } from '../auth/middleware.js';
import { prisma } from '../db/prisma.js';
import { DEFAULT_BRANCHES, normalizeBranchCode, type BranchRecord } from '../branches.js';

// The shared branch master, edited from Settings > Branches. There is deliberately no DELETE:
// documents carry the branch code forever, so a retired branch is deactivated instead.
export const branchesRouter = Router();

const digits = (v: unknown) => (typeof v === 'string' ? v.replace(/\D/g, '') : '');

function text(v: unknown, max = 200): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function validate(body: Record<string, unknown>, isCreate: boolean) {
  const code = normalizeBranchCode(String(body.code ?? ''));
  const nameEn = text(body.nameEn);
  const nameAr = text(body.nameAr);
  if (!nameEn || !nameAr) throw new Error('Both English and Arabic branch names are required.');

  const vatNumber = digits(body.vatNumber);
  if (vatNumber && vatNumber.length !== 15) throw new Error('VAT number must be exactly 15 digits.');
  const glnNo = digits(body.glnNo);
  if (glnNo && glnNo.length !== 13) throw new Error('GLN must be exactly 13 digits.');

  const id = isCreate ? text(body.id) ?? `br-${code.toLowerCase()}` : undefined;
  return {
    id,
    code,
    nameEn,
    nameAr,
    address: text(body.address),
    phone: text(body.phone, 50),
    vatNumber: vatNumber || null,
    crNumber: text(body.crNumber, 50),
    glnNo: glnNo || null,
    costCenterId: text(body.costCenterId),
    isActive: body.isActive !== false,
  };
}

branchesRouter.get('/', async (_req, res) => {
  try {
    const rows = await prisma.branch.findMany({ orderBy: { code: 'asc' } });
    res.json({ branches: rows, source: 'database' });
  } catch (err) {
    // Offline / DB not migrated yet: the till and Settings can still work from the in-code seed.
    res.json({ branches: DEFAULT_BRANCHES, source: 'fallback', error: String(err) });
  }
});

branchesRouter.post('/', requireAdmin, async (req, res) => {
  try {
    const value = validate(req.body as Record<string, unknown>, true);
    const duplicate = await prisma.branch.findFirst({
      where: { OR: [{ id: value.id }, { code: value.code }] },
      select: { id: true, code: true },
    });
    if (duplicate) {
      res.status(409).json({ error: `A branch with this ID or code already exists (${duplicate.code}).` });
      return;
    }
    const created = await prisma.branch.create({ data: { ...value, id: value.id! } });
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

branchesRouter.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const existing = await prisma.branch.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Branch not found.' });
      return;
    }
    const value = validate(req.body as Record<string, unknown>, false);
    if (value.code !== existing.code) {
      // Rewriting a code would silently re-label historical invoice numbers, which are evidence.
      const usage = await prisma.sale.count({ where: { branchId: existing.id } });
      const returns = await prisma.returnRecord.count({ where: { branchId: existing.id } });
      if (usage + returns > 0) {
        res.status(409).json({ error: 'Code cannot change: documents already exist for this branch. Add a new branch instead.' });
        return;
      }
    }
    const updated = await prisma.branch.update({ where: { id: existing.id }, data: value });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Kept as a named export so a future head-office report can reuse the normalised shape.
export type { BranchRecord };
