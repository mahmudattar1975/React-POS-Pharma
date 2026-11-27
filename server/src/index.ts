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
import { itemsRouter } from './routes/items.js';
import { itemCategoriesRouter } from './routes/itemCategories.js';
import { unitsRouter } from './routes/units.js';
import { locationsRouter } from './routes/locations.js';
import { brandsRouter } from './routes/brands.js';
import { initRsdSettings } from './rsd/settings.js';
import { terminalBranch } from './branch.js';
import { loadAuthConfig } from './auth/config.js';
import { requireAuth } from './auth/middleware.js';

async function main(): Promise<void> {
  // Apply any saved Settings > RSD values before the first request. `.env` is only the seed.
  await initRsdSettings();
  // Fail closed if JWT validation is not configured; never start an open API by accident.
  const authConfig = await loadAuthConfig();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, zatcaEnv: config.zatcaEnv }));

  // Deny by default. Roles and identity come only from the verified JWT, never from the body.
  app.use('/api', requireAuth(authConfig));

  // Mock-only RSD helpers are development tools; they must not exist in a production process.
  app.use('/api/rsd/mock', (_req, res, next) => {
    if (process.env.NODE_ENV === 'production') {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    next();
  });

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
  app.use('/api/items', itemsRouter);
  app.use('/api/item-categories', itemCategoriesRouter);
  app.use('/api/units', unitsRouter);
  app.use('/api/locations', locationsRouter);
  app.use('/api/brands', brandsRouter);

  // Loopback by default; a staging/production proxy must explicitly opt in to another interface.
  const bindHost = process.env.BIND_HOST ?? '127.0.0.1';
  app.listen(config.port, bindHost, () => {
    console.log(`Pharmacy-App ZATCA server listening on http://${bindHost}:${config.port} (ZATCA env: ${config.zatcaEnv}, mode: ${config.zatcaMode})`);
    console.log(`Terminal branch: ${terminalBranch.id} (${terminalBranch.configured ? 'from config/branch.json' : 'fallback - set config/branch.json'})`);
  });
}

void main();
