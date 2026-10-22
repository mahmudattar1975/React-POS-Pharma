import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { onboardingRouter } from './routes/onboarding.js';
import { invoicesRouter } from './routes/invoices.js';
import { erpRouter } from './routes/erp.js';
import { salesRouter } from './routes/sales.js';
import { receivingRouter } from './routes/receiving.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, zatcaEnv: config.zatcaEnv }));
app.use('/api/zatca/onboarding', onboardingRouter);
app.use('/api/zatca/invoices', invoicesRouter);
app.use('/api/erp', erpRouter);
app.use('/api/sales', salesRouter);
app.use('/api/receiving', receivingRouter);

app.listen(config.port, () => {
  console.log(`Pharmacy-App ZATCA server listening on http://localhost:${config.port} (ZATCA env: ${config.zatcaEnv})`);
});
