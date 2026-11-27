// SEC-10 regressions: live ZATCA/RSD switches require an admin token AND explicit confirmation,
// every attempted fiscal action is written to an append-only audit file, and no secret/PHI reaches
// that file. Everything runs against local mocks and a real in-process Express app over HTTP - no
// live submission, no destructive staging action.
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAuthConfig } from '../../src/auth/config';
import { requireAuth } from '../../src/auth/middleware';
import { onboardingRouter } from '../../src/routes/onboarding';
import { invoicesRouter } from '../../src/routes/invoices';
import { rsdRouter } from '../../src/routes/rsd';

const { onboardingMocks, rsdMocks, submitMock } = vi.hoisted(() => ({
  onboardingMocks: {
    getOnboardingStatus: vi.fn(),
    requestComplianceCsid: vi.fn(),
    runComplianceChecks: vi.fn(),
    requestProductionCsid: vi.fn(),
    setZatcaEnvironment: vi.fn(),
    setZatcaMode: vi.fn(),
  },
  rsdMocks: {
    getStatus: vi.fn(),
    listRecords: vi.fn(),
    unitStatus: vi.fn(),
    reportSale: vi.fn(),
    reportCancel: vi.fn(),
    reopenRejected: vi.fn(),
    testConnection: vi.fn(),
    acceptMockUnit: vi.fn(),
    resetMock: vi.fn(),
    getRsdSettingsView: vi.fn(),
    updateRsdSettings: vi.fn(),
  },
  submitMock: vi.fn(),
}));

vi.mock('../../src/zatca/onboarding.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/zatca/onboarding.js')>();
  return { ...actual, ...onboardingMocks };
});
vi.mock('../../src/zatca/settings.js', () => ({
  getZatcaSettings: vi.fn(async () => ({})),
  updateZatcaSettings: vi.fn(async (value: unknown) => value),
}));
vi.mock('../../src/rsd/service.js', () => ({ ...rsdMocks }));
vi.mock('../../src/rsd/settings.js', () => ({
  getRsdSettingsView: rsdMocks.getRsdSettingsView,
  updateRsdSettings: rsdMocks.updateRsdSettings,
}));
vi.mock('../../src/zatca/submitSaleInvoice.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/zatca/submitSaleInvoice.js')>();
  return { ...actual, submitSaleInvoice: submitMock };
});

const SECRET = 'sec10-test-secret-long-enough-for-hs256-validation';
const ISSUER = 'dotnet-pos-sec10-test';
const AUDIENCE = 'pharmacy-app-sec10-test';

async function token(claims: Record<string, unknown>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ cashierId: 7, username: 'cashier', fullName: 'Test Cashier', ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now - 60)
    .setNotBefore(now - 60)
    .setExpirationTime(now + 600)
    .sign(new TextEncoder().encode(SECRET));
}

let tempDir = '';
let auditFile = '';
let server: Server;
let base = '';
let adminToken = '';
let cashierToken = '';

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'pharmacy-sec10-'));
  auditFile = join(tempDir, 'security-audit.jsonl');
  process.env.SECURITY_AUDIT_FILE = auditFile;

  const authConfig = await loadAuthConfig({
    AUTH_JWT_ALGORITHM: 'HS256',
    AUTH_JWT_SECRET: SECRET,
    AUTH_JWT_ISSUER: ISSUER,
    AUTH_JWT_AUDIENCE: AUDIENCE,
  });
  const app = express();
  app.use(express.json());
  app.use('/api', requireAuth(authConfig));
  app.use('/api/zatca/onboarding', onboardingRouter);
  app.use('/api/zatca/invoices', invoicesRouter);
  app.use('/api/rsd', rsdRouter);

  server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  adminToken = await token({ cashierId: 1, username: 'admin', fullName: 'Test Admin', isAdmin: true });
  cashierToken = await token({ cashierId: 2, username: 'cashier', fullName: 'Test Cashier' });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  delete process.env.SECURITY_AUDIT_FILE;
  await rm(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  vi.clearAllMocks();
  await writeFile(auditFile, '', 'utf8');

  onboardingMocks.getOnboardingStatus.mockResolvedValue({ step: 'not_started', environment: 'sandbox', mode: 'mock' });
  onboardingMocks.setZatcaEnvironment.mockResolvedValue({ step: 'not_started', environment: 'production', mode: 'mock' });
  onboardingMocks.setZatcaMode.mockResolvedValue({ step: 'not_started', environment: 'sandbox', mode: 'live' });
  onboardingMocks.requestComplianceCsid.mockResolvedValue({ issuedAt: '2026-11-27T00:00:00Z', requestId: 'req-1' });
  onboardingMocks.runComplianceChecks.mockResolvedValue({ passed: true, results: [] });
  onboardingMocks.requestProductionCsid.mockResolvedValue({ issuedAt: '2026-11-27T00:00:00Z', requestId: 'prod-1' });

  const rsdView = {
    mode: 'mock', environment: 'test', gln: '0000000000000', username: 'user',
    hasPassword: true, credentialsConfigured: true, saleUrl: 'https://example.test/sale',
    cancelUrl: 'https://example.test/cancel', directToGln: '0000000000000',
    directPrescriptionId: 'DIRECT-SALE', source: 'stored',
  };
  rsdMocks.getRsdSettingsView.mockResolvedValue(rsdView);
  rsdMocks.updateRsdSettings.mockImplementation(async (value: Record<string, unknown>) => ({ ...rsdView, ...value }));
  rsdMocks.reportSale.mockResolvedValue({ status: 'accepted' });
  rsdMocks.reportCancel.mockResolvedValue({ status: 'accepted' });
  rsdMocks.reopenRejected.mockResolvedValue(null);
  rsdMocks.testConnection.mockResolvedValue({ ok: true });
  rsdMocks.acceptMockUnit.mockResolvedValue({ accepted: true });
  rsdMocks.resetMock.mockResolvedValue(undefined);
  submitMock.mockResolvedValue({ status: 'reported', environment: 'sandbox' });
});

async function call(method: string, path: string, body?: unknown, bearer?: string) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function post(path: string, body?: unknown, bearer?: string) {
  return call('POST', path, body, bearer);
}
function put(path: string, body?: unknown, bearer?: string) {
  return call('PUT', path, body, bearer);
}

async function auditRecords(): Promise<Array<Record<string, any>>> {
  const text = await readFile(auditFile, 'utf8');
  return text.trim() ? text.trim().split('\n').map((line) => JSON.parse(line)) : [];
}

describe('ZATCA production switches (SEC-10)', () => {
  it('rejects anonymous and cashier access before any mode change', async () => {
    const anonymous = await post('/api/zatca/onboarding/environment', { environment: 'production' });
    expect(anonymous.status).toBe(401);
    const cashier = await post('/api/zatca/onboarding/mode', { mode: 'live', confirmation: 'ENABLE LIVE' }, cashierToken);
    expect(cashier.status).toBe(403);
    expect(onboardingMocks.setZatcaMode).not.toHaveBeenCalled();
  });

  it('requires the exact production-environment phrase and audits the denial', async () => {
    const missing = await post('/api/zatca/onboarding/environment', { environment: 'production' }, adminToken);
    expect(missing.status).toBe(400);
    expect(missing.body).toMatchObject({ error: 'confirmation_required', confirmation: 'PRODUCTION ENVIRONMENT' });
    expect(onboardingMocks.setZatcaEnvironment).not.toHaveBeenCalled();
    expect(await auditRecords()).toEqual([expect.objectContaining({
      action: 'zatca.environment.production', outcome: 'denied', actor: { cashierId: 1, username: 'admin', fullName: 'Test Admin' },
    })]);

    const wrong = await post('/api/zatca/onboarding/environment', {
      environment: 'production', confirmation: 'PRODUCTION ENVIRONMENT ',
    }, adminToken);
    expect(wrong.status).toBe(400);

    const ok = await post('/api/zatca/onboarding/environment', {
      environment: 'production', confirmation: 'PRODUCTION ENVIRONMENT',
    }, adminToken);
    expect(ok.status).toBe(200);
    expect(onboardingMocks.setZatcaEnvironment).toHaveBeenCalledWith('production');
    const records = await auditRecords();
    expect(records.map((r) => r.outcome)).toEqual(['denied', 'denied', 'attempt', 'success']);
    expect(records.at(-1)).toMatchObject({ action: 'zatca.environment.set', detail: { environment: 'production' } });
  });

  it('requires confirmation to enable live mode', async () => {
    const denied = await post('/api/zatca/onboarding/mode', { mode: 'live' }, adminToken);
    expect(denied.status).toBe(400);
    expect(onboardingMocks.setZatcaMode).not.toHaveBeenCalled();
    const ok = await post('/api/zatca/onboarding/mode', { mode: 'live', confirmation: 'ENABLE LIVE' }, adminToken);
    expect(ok.status).toBe(200);
    expect(onboardingMocks.setZatcaMode).toHaveBeenCalledWith('live');
  });

  it('requires confirmation for a production CSID and never logs the OTP', async () => {
    expect((await post('/api/zatca/onboarding/production', {}, adminToken)).status).toBe(400);
    expect(onboardingMocks.requestProductionCsid).not.toHaveBeenCalled();

    const ok = await post('/api/zatca/onboarding/production', { confirmation: 'PRODUCTION CSID' }, adminToken);
    expect(ok.status).toBe(200);
    expect(onboardingMocks.requestProductionCsid).toHaveBeenCalledOnce();

    await post('/api/zatca/onboarding/compliance', { otp: 'one-time-secret-12345', confirmation: 'PRODUCTION CSID' }, adminToken);
    expect(onboardingMocks.requestComplianceCsid).toHaveBeenCalledWith('one-time-secret-12345');
    const raw = await readFile(auditFile, 'utf8');
    expect(raw).not.toContain('one-time-secret-12345');
    for (const phrase of ['PRODUCTION CSID', 'PRODUCTION ENVIRONMENT', 'ENABLE LIVE', 'ENABLE LIVE RSD', 'ALLOW MOCK RSD']) {
      expect(raw).not.toContain(phrase);
    }
    expect((await auditRecords()).some((r) => r.action === 'zatca.csid.production' && r.outcome === 'success')).toBe(true);
  });
});

describe('RSD live switches and movements (SEC-10)', () => {
  it('gates mock -> live settings behind admin + confirmation and audits the transition', async () => {
    expect((await put('/api/rsd/settings', { mode: 'mock', environment: 'test' }, cashierToken)).status).toBe(403);
    const denied = await put('/api/rsd/settings', { mode: 'live', environment: 'test', password: 'super-secret' }, adminToken);
    expect(denied.status).toBe(400);
    expect(denied.body).toMatchObject({ error: 'confirmation_required', confirmation: 'ENABLE LIVE RSD' });
    expect(rsdMocks.updateRsdSettings).not.toHaveBeenCalled();

    const ok = await put('/api/rsd/settings', {
      mode: 'live', environment: 'test', password: 'super-secret', confirmation: 'ENABLE LIVE RSD',
    }, adminToken);
    expect(ok.status).toBe(200);
    expect(rsdMocks.updateRsdSettings).toHaveBeenCalledOnce();
    const raw = await readFile(auditFile, 'utf8');
    expect(raw).not.toContain('super-secret');
    const records = await auditRecords();
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({ action: 'rsd.settings.live', outcome: 'denied' });
    expect(records[1]).toMatchObject({ action: 'rsd.settings.update', outcome: 'attempt', detail: { toMode: 'live' } });
    expect(records[2]).toMatchObject({ action: 'rsd.settings.update', outcome: 'success' });
  });

  it('audits cashier sale reports without putting GTIN/serial/prescription in the audit file', async () => {
    const res = await post('/api/rsd/sales', {
      gtin: '12345678901234', serialNo: 'SER-PATIENT-001', batchNo: 'B1', expiryDate: '2027-01-01',
      prescriptionId: 'RX-PHI-0001',
    }, cashierToken);
    expect(res.status).toBe(200);
    expect(rsdMocks.reportSale).toHaveBeenCalledOnce();
    const raw = await readFile(auditFile, 'utf8');
    for (const leaked of ['12345678901234', 'SER-PATIENT-001', 'RX-PHI-0001']) expect(raw).not.toContain(leaked);
    const records = await auditRecords();
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ action: 'rsd.sale.report', outcome: 'attempt', actor: { username: 'cashier' } });
    expect(records[1]).toMatchObject({ action: 'rsd.sale.report', outcome: 'success' });
  });

  it('requires confirmation even for mock-only controls', async () => {
    const denied = await post('/api/rsd/mock/reset', {}, adminToken);
    expect(denied.status).toBe(400);
    expect(rsdMocks.resetMock).not.toHaveBeenCalled();
    const ok = await post('/api/rsd/mock/reset', { confirmation: 'ALLOW MOCK RSD' }, adminToken);
    expect(ok.status).toBe(200);
    expect(rsdMocks.resetMock).toHaveBeenCalledOnce();
  });
});

describe('ZATCA invoice submission audit (SEC-10)', () => {
  const invoice = {
    invoiceNo: 'T1-SIM-000001', invoiceType: 'simplified', date: '2026-11-27T10:00:00Z',
    customerName: 'Sensitive Patient Name', paymentMethod: 'cash',
    lines: [{ id: 'line-1', itemNameEn: 'Paracetamol', qty: 1, unitPrice: 10, vatRate: 0.15, discountAmount: 0 }],
  };

  it('rejects anonymous submissions but keeps authenticated cashier checkout working', async () => {
    expect((await post('/api/zatca/invoices', invoice)).status).toBe(401);
    expect((await post('/api/zatca/invoices', invoice, cashierToken)).status).toBe(200);
    expect(submitMock).toHaveBeenCalledOnce();
    const raw = await readFile(auditFile, 'utf8');
    expect(raw).not.toContain('Sensitive Patient Name');
    expect(raw).not.toContain('Paracetamol');
    const records = await auditRecords();
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ action: 'zatca.invoice.submit', outcome: 'attempt', actor: { username: 'cashier' } });
    expect(records[1]).toMatchObject({ action: 'zatca.invoice.submit', outcome: 'success' });
  });

  it('records a failure when the ZATCA submission itself fails', async () => {
    submitMock.mockRejectedValueOnce(new Error('ZATCA unavailable'));
    const res = await post('/api/zatca/invoices', invoice, adminToken);
    expect(res.status).toBe(502);
    expect((await auditRecords()).map((r) => r.outcome)).toEqual(['attempt', 'failure']);
  });
});
