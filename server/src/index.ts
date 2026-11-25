import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { onboardingRouter } from './routes/onboarding.js';
import { invoicesRouter } from './routes/invoices.js';
import { incentivesRouter } from './routes/incentives.js';
import { erpRouter } from './routes/erp.js';
import { salesRouter } from './routes/sales.js';
import { receivingRouter } from './routes/receiving.js';
import { wasfatyRouter } from './routes/wasfaty.js';
import { rsdRouter } from './routes/rsd.js';
import { branchesRouter } from './routes/branches.js';
import { contextRouter } from './routes/context.js';
import { stockRouter } from './routes/stock.js';
import { initRsdSettings } from './rsd/settings.js';
import { terminalBranch } from './branch.js';

async function main(): Promise<void> {
  // Apply any saved Settings > RSD values before the first request. `.env` is only the seed.
  await initRsdSettings();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, zatcaEnv: config.zatcaEnv }));
  app.use('/api/zatca/onboarding', onboardingRouter);
  app.use('/api/zatca/invoices', invoicesRouter);
  app.use('/api/incentives', incentivesRouter);
  app.use('/api/erp', erpRouter);
  app.use('/api/sales', salesRouter);
  app.use('/api/receiving', receivingRouter);
  app.use('/api/wasfaty', wasfatyRouter);
  app.use('/api/rsd', rsdRouter);
  app.use('/api/branches', branchesRouter);
  app.use('/api/context', contextRouter);
  app.use('/api/stock', stockRouter);

  app.listen(config.port, () => {
    console.log(`Pharmacy-App ZATCA server listening on http://localhost:${config.port} (ZATCA env: ${config.zatcaEnv}, mode: ${config.zatcaMode})`);
    console.log(`Terminal branch: ${terminalBranch.id} (${terminalBranch.configured ? 'from config/branch.json' : 'fallback - set config/branch.json'})`);
  });
}

void main();
