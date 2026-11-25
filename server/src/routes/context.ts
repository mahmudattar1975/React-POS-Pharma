import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { terminalBranch } from '../branch.js';
import { DEFAULT_BRANCHES, defaultBranchById, type BranchRecord } from '../branches.js';

// Everything a terminal needs to know about itself at boot. The frontend calls this once and
// caches the answer in its settings store; a failure leaves the browser's last known branch in
// place so an offline pharmacy can still sell.
export const contextRouter = Router();

contextRouter.get('/', async (_req, res) => {
  let branches: BranchRecord[] = DEFAULT_BRANCHES;
  let source: 'database' | 'fallback' = 'fallback';

  try {
    const rows = await prisma.branch.findMany({ orderBy: { code: 'asc' } });
    if (rows.length) {
      branches = rows;
      source = 'database';
    }
  } catch {
    // Offline / migration not applied yet - the in-code copy keeps the till usable.
  }

  const branch: BranchRecord =
    branches.find((b) => b.id === terminalBranch.id) ??
    defaultBranchById(terminalBranch.id) ?? {
      id: terminalBranch.id,
      code: terminalBranch.id.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'BR',
      nameEn: terminalBranch.id,
      nameAr: terminalBranch.id,
      isActive: true,
    };

  res.json({
    branch,
    configured: terminalBranch.configured,
    branches,
    source,
  });
});
