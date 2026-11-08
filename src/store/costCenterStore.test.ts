// Store-level tests for the Phase B.1 category -> center map and the allocation drivers.
//
// These live at the store (not the page) because the guards are what future feeds rely on: the
// payroll/GL import of Phase C/D will call setCategoryMapping/setDrivers directly, and a rule that
// points at an overhead pool or a retired center must be rejected there, not merely hidden by a
// disabled <MenuItem> in one screen.
//
// Same in-memory localStorage stub as inventoryMovement.test.ts - zustand's persist middleware
// asks for storage at import time and vitest runs in Node with none.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { seedCostCenters } from '../utils/seedData';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
  key: () => null,
  length: 0,
});

type Store = typeof import('./costCenterStore')['useCostCenterStore'];
let store: Store;

// Seed ids used below (utils/seedData.ts): cc-hq = overhead pool, cc-br-001 = active branch,
// cc-br-001-ins = activity desk, cc-br-001-kiosk = retired (inactive, no posting, expired).
beforeAll(async () => {
  store = (await import('./costCenterStore')).useCostCenterStore;
});

beforeEach(() => {
  store.setState({ centers: seedCostCenters, expenses: [], categoryMap: [] });
});

describe('setCategoryMapping', () => {
  it('stores a rule under the normalised key and reports the display label', () => {
    const row = store.getState().setCategoryMapping({
      categoryLabel: '  Baby   CARE ',
      costCenterId: 'cc-br-001',
      updatedBy: 'accountant',
    });
    expect(row.categoryKey).toBe('baby care');
    expect(row.categoryLabel).toBe('Baby   CARE'); // trimmed, original inner spacing kept for display
    expect(row.costCenterId).toBe('cc-br-001');
    expect(row.updatedBy).toBe('accountant');
    expect(store.getState().categoryMap).toHaveLength(1);
  });

  it('upserts instead of duplicating when the same category is saved twice', () => {
    store.getState().setCategoryMapping({ categoryLabel: 'Baby Care', costCenterId: 'cc-br-001' });
    store.getState().setCategoryMapping({ categoryLabel: 'baby care', costCenterId: 'cc-br-002' });
    const map = store.getState().categoryMap;
    expect(map).toHaveLength(1);
    expect(map[0].costCenterId).toBe('cc-br-002');
  });

  it('refuses an overhead pool as the target (a pool is a source, never an owner)', () => {
    expect(() =>
      store.getState().setCategoryMapping({ categoryLabel: 'Baby Care', costCenterId: 'cc-hq' })
    ).toThrow(/overhead pool/);
    expect(store.getState().categoryMap).toHaveLength(0);
  });

  it('refuses an unknown or retired center', () => {
    expect(() =>
      store.getState().setCategoryMapping({ categoryLabel: 'Baby Care', costCenterId: 'cc-gone' })
    ).toThrow(/not found/);
    expect(() =>
      store.getState().setCategoryMapping({ categoryLabel: 'Baby Care', costCenterId: 'cc-br-001-kiosk' })
    ).toThrow(/inactive/);
  });

  it('refuses a blank category', () => {
    expect(() =>
      store.getState().setCategoryMapping({ categoryLabel: '   ', costCenterId: 'cc-br-001' })
    ).toThrow(/Choose a category/);
  });

  it('removes only the requested rule', () => {
    store.getState().setCategoryMapping({ categoryLabel: 'Baby Care', costCenterId: 'cc-br-001' });
    store.getState().setCategoryMapping({ categoryLabel: 'Analgesics', costCenterId: 'cc-br-002' });
    store.getState().clearCategoryMapping('baby care');
    expect(store.getState().categoryMap.map((m) => m.categoryKey)).toEqual(['analgesics']);
  });
});

describe('setDrivers', () => {
  it('stores floor area and headcount on an operating center', () => {
    store.getState().setDrivers('cc-br-001', { spaceSqm: 210.5, headcount: 12 });
    const c = store.getState().centers.find((x) => x.id === 'cc-br-001')!;
    expect(c.spaceSqm).toBe(210.5);
    expect(c.headcount).toBe(12);
  });

  it('clears a driver when it is omitted', () => {
    store.getState().setDrivers('cc-br-001', { spaceSqm: 100, headcount: 5 });
    store.getState().setDrivers('cc-br-001', {});
    const c = store.getState().centers.find((x) => x.id === 'cc-br-001')!;
    expect(c.spaceSqm).toBeUndefined();
    expect(c.headcount).toBeUndefined();
  });

  it('rejects negative or non-numeric values without writing anything', () => {
    expect(() => store.getState().setDrivers('cc-br-001', { spaceSqm: -1 })).toThrow(/zero or a positive/);
    expect(() => store.getState().setDrivers('cc-br-001', { headcount: Number.NaN })).toThrow(/zero or a positive/);
    expect(store.getState().centers.find((x) => x.id === 'cc-br-001')!.spaceSqm).toBeUndefined();
  });

  it('rejects overhead pools and unknown centers', () => {
    expect(() => store.getState().setDrivers('cc-hq', { headcount: 3 })).toThrow(/overhead|operating/i);
    expect(() => store.getState().setDrivers('cc-gone', { headcount: 3 })).toThrow(/not found/);
  });
});
