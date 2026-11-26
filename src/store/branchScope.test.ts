import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
  key: () => null,
  length: 0,
});
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

type SettingsModule = typeof import('./settingsStore');
type SalesModule = typeof import('./salesStore');
type ScopeModule = typeof import('../utils/branchScope');

let settings: SettingsModule['useSettingsStore'];
let sales: SalesModule['useSalesStore'];
let scope: ScopeModule;

beforeAll(async () => {
  settings = (await import('./settingsStore')).useSettingsStore;
  sales = (await import('./salesStore')).useSalesStore;
  scope = await import('../utils/branchScope');
});

beforeEach(() => {
  memory.clear();
  settings.setState((s) => ({
    settings: { ...s.settings, branchId: scope.LEGACY_BRANCH_ID, branchCode: undefined },
  }));
  sales.setState({
    invoices: [],
    returns: [],
    simplifiedCounter: 0,
    standardCounter: 0,
    branchCounters: {},
  });
});

describe('branch scoping', () => {
  it('treats documents saved before branch scoping as the original RIY register', () => {
    const rows = [{ id: 'old' }, { id: 'new', branchId: 'br-ph001' }];
    expect(scope.rowsForBranch(rows, scope.LEGACY_BRANCH_ID).map((r) => r.id)).toEqual(['old']);
    expect(scope.rowsForBranch(rows, 'br-ph001').map((r) => r.id)).toEqual(['new']);
  });

  it('caches a configured terminal branch but ignores an unconfigured fallback', () => {
    const ctx = {
      branch: {
        id: 'br-ph001',
        code: 'PH001',
        nameEn: 'Al Shifa Modern Pharmacy',
        nameAr: 'صيدلية الشفاء الحديثة',
        isActive: true,
        costCenterId: 'cc-br-001',
      },
      configured: true,
      branches: [],
      source: 'database' as const,
    };
    scope.applyBranchContext(ctx);
    expect(settings.getState().settings.branchCode).toBe('PH001');
    expect(settings.getState().settings.branchId).toBe('br-ph001');

    scope.applyBranchContext({ ...ctx, configured: false, branch: { ...ctx.branch, code: 'RIY' } });
    expect(settings.getState().settings.branchCode).toBe('PH001');
  });

  it('starts a configured branch at SIM-000001 instead of inheriting RIY counter 15', () => {
    sales.setState({
      simplifiedCounter: 15,
      standardCounter: 0,
      branchCounters: { [scope.LEGACY_BRANCH_ID]: { simplified: 15, standard: 0 } },
    });
    settings.setState((s) => ({
      settings: { ...s.settings, branchId: 'br-ph001', branchCode: 'PH001' },
    }));

    expect(sales.getState().nextInvoiceNo('simplified')).toBe('PH001-SIM-000001');
    sales.setState({
      branchCounters: {
        [scope.LEGACY_BRANCH_ID]: { simplified: 15, standard: 0 },
        'br-ph001': { simplified: 1, standard: 0 },
      },
    });
    expect(sales.getState().nextInvoiceNo('simplified')).toBe('PH001-SIM-000002');
  });

  it('stamps a newly recorded sale with the configured branch', () => {
    settings.setState((s) => ({
      settings: { ...s.settings, branchId: 'br-ph001', branchCode: 'PH001' },
    }));
    const invoice = {
      id: 'sale-ph001-1',
      invoiceNo: 'PH001-SIM-000001',
      invoiceType: 'simplified',
      date: '2026-11-26T10:00:00.000Z',
      lines: [],
      subtotalExclVat: 0,
      totalDiscount: 0,
      totalVatAmount: 0,
      totalInclVat: 0,
      payments: [],
      zatcaQrBase64: '',
      zatcaStatus: 'phase1_fallback',
      status: 'completed',
      cashierName: 'admin',
    } as Parameters<ReturnType<SalesModule['useSalesStore']['getState']>['recordSale']>[0];

    sales.getState().recordSale(invoice);

    expect(sales.getState().invoices[0].branchId).toBe('br-ph001');
    expect(sales.getState().branchCounters?.['br-ph001']).toEqual({ simplified: 1, standard: 0 });
    expect(sales.getState().simplifiedCounter).toBe(0);
  });
});
