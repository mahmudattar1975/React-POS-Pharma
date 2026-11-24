// Store-level tests for the bulk NUPCO mapping action. The import dialog previews and filters rows,
// but the store is the last line of defence: a caller must not be able to write a duplicate or
// malformed code, and a rejected batch must leave the catalogue untouched.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedBatches, seedItems, seedOffers } from '../utils/seedData';

type CatalogModule = typeof import('./catalogStore');

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
  key: () => null,
  length: 0,
});

let catalog: CatalogModule['useCatalogStore'];
let auth: typeof import('./authStore')['useAuthStore'];

beforeAll(async () => {
  catalog = (await import('./catalogStore')).useCatalogStore;
  auth = (await import('./authStore')).useAuthStore;
});

beforeEach(() => {
  // The packaged seed catalogue already maps several items; strip that so each test starts from a
  // clean slate and asserts the bulk action itself.
  const unmapped = seedItems.map((item) => {
    const copy = { ...item };
    delete copy.nupcoCode;
    delete copy.wasfatyPrice;
    delete copy.wasfatyEligible;
    return copy;
  });
  catalog.setState({
    items: unmapped,
    batches: seedBatches,
    offers: seedOffers,
    receivingLog: [],
    wasfatyMappingLog: [],
  });
  auth.setState({ session: null });
});

function codeOf(itemId: string): string | undefined {
  return catalog.getState().items.find((i) => i.id === itemId)?.nupcoCode;
}

describe('catalogStore.applyWasfatyMappings', () => {
  it('applies a batch in one write and marks every mapped item eligible', () => {
    catalog.getState().applyWasfatyMappings([
      { itemId: 'itm-1', nupcoCode: '6281007320014', wasfatyPrice: 4.25, wasfatyEligible: true },
      { itemId: 'itm-2', nupcoCode: '6281007320021', wasfatyEligible: true },
    ]);
    expect(codeOf('itm-1')).toBe('6281007320014');
    expect(codeOf('itm-2')).toBe('6281007320021');
    expect(catalog.getState().items.find((i) => i.id === 'itm-1')?.wasfatyPrice).toBe(4.25);
    expect(catalog.getState().items.find((i) => i.id === 'itm-1')?.wasfatyEligible).toBe(true);
  });

  it('normalises spaces and dashes in the code', () => {
    catalog.getState().applyWasfatyMappings([
      { itemId: 'itm-1', nupcoCode: '6281 0073-2001-4', wasfatyEligible: true },
    ]);
    expect(codeOf('itm-1')).toBe('6281007320014');
  });

  it('rejects a malformed code without writing anything', () => {
    expect(() =>
      catalog.getState().applyWasfatyMappings([
        { itemId: 'itm-1', nupcoCode: '6281007320014', wasfatyEligible: true },
        { itemId: 'itm-2', nupcoCode: '123', wasfatyEligible: true },
      ]),
    ).toThrow(/13 digits/);
    expect(codeOf('itm-1')).toBeUndefined();
    expect(codeOf('itm-2')).toBeUndefined();
  });

  it('rejects the same code twice in one batch', () => {
    expect(() =>
      catalog.getState().applyWasfatyMappings([
        { itemId: 'itm-1', nupcoCode: '6281007320014', wasfatyEligible: true },
        { itemId: 'itm-2', nupcoCode: '6281007320014', wasfatyEligible: true },
      ]),
    ).toThrow(/Two rows/);
  });

  it('rejects a code already owned by another item', () => {
    catalog.getState().setWasfatyMapping('itm-3', { nupcoCode: '6281007320014', wasfatyEligible: true });
    expect(() =>
      catalog.getState().applyWasfatyMappings([
        { itemId: 'itm-1', nupcoCode: '6281007320014', wasfatyEligible: true },
      ]),
    ).toThrow(/already mapped/);
    expect(codeOf('itm-1')).toBeUndefined();
  });

  it('allows an item to restate its own code', () => {
    catalog.getState().setWasfatyMapping('itm-1', { nupcoCode: '6281007320014', wasfatyEligible: true });
    catalog.getState().applyWasfatyMappings([
      { itemId: 'itm-1', nupcoCode: '6281007320014', wasfatyPrice: 4.25, wasfatyEligible: true },
    ]);
    expect(codeOf('itm-1')).toBe('6281007320014');
    expect(catalog.getState().items.find((i) => i.id === 'itm-1')?.wasfatyPrice).toBe(4.25);
  });

  it('rejects a negative price', () => {
    expect(() =>
      catalog.getState().applyWasfatyMappings([
        { itemId: 'itm-1', nupcoCode: '6281007320014', wasfatyPrice: -1, wasfatyEligible: true },
      ]),
    ).toThrow(/0 or more/);
  });

  it('rejects an unknown item id', () => {
    expect(() =>
      catalog.getState().applyWasfatyMappings([
        { itemId: 'missing', nupcoCode: '6281007320014', wasfatyEligible: true },
      ]),
    ).toThrow(/not found/);
  });
});

describe('catalogStore Wasfaty mapping audit trail', () => {
  it('records a manual change with the actor and the before/after values', () => {
    auth.setState({
      session: { token: 't', cashierId: 7, username: 'amal', fullName: 'Amal Saleh', isAdmin: false },
    });
    catalog.getState().setWasfatyMapping('itm-1', { nupcoCode: '6281007320014', wasfatyPrice: 4.25, wasfatyEligible: true });

    const log = catalog.getState().wasfatyMappingLog;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      itemId: 'itm-1',
      itemNameEn: 'Paracetamol 500mg (20 tabs)',
      by: 'Amal Saleh',
      source: 'manual',
      before: { nupcoCode: undefined, wasfatyPrice: undefined, wasfatyEligible: undefined },
      after: { nupcoCode: '6281007320014', wasfatyPrice: 4.25, wasfatyEligible: true },
    });
    expect(log[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('falls back to the username, then to an explicit unknown actor', () => {
    auth.setState({
      session: { token: 't', cashierId: 7, username: 'amal', fullName: '', isAdmin: false },
    });
    catalog.getState().setWasfatyMapping('itm-1', { nupcoCode: '6281007320014', wasfatyEligible: true });
    expect(catalog.getState().wasfatyMappingLog[0].by).toBe('amal');

    auth.setState({ session: null });
    catalog.getState().setWasfatyMapping('itm-1', { nupcoCode: '6281007320021', wasfatyEligible: true });
    expect(catalog.getState().wasfatyMappingLog[1].by).toBe('Unknown user');
  });

  it('does not log a save that changes nothing', () => {
    catalog.getState().setWasfatyMapping('itm-1', { nupcoCode: '6281007320014', wasfatyPrice: 4.25, wasfatyEligible: true });
    catalog.getState().setWasfatyMapping('itm-1', { nupcoCode: '6281007320014', wasfatyPrice: 4.25, wasfatyEligible: true });
    expect(catalog.getState().wasfatyMappingLog).toHaveLength(1);
  });

  it('records each changed item in a bulk import, and none on a repeat', () => {
    catalog.getState().applyWasfatyMappings([
      { itemId: 'itm-1', nupcoCode: '6281007320014', wasfatyPrice: 4.25, wasfatyEligible: true },
      { itemId: 'itm-2', nupcoCode: '6281007320021', wasfatyEligible: true },
    ], 'import');

    let log = catalog.getState().wasfatyMappingLog;
    expect(log).toHaveLength(2);
    expect(log.map((entry) => entry.source)).toEqual(['import', 'import']);
    expect(log.map((entry) => entry.itemId)).toEqual(['itm-1', 'itm-2']);

    catalog.getState().applyWasfatyMappings([
      { itemId: 'itm-1', nupcoCode: '6281007320014', wasfatyPrice: 4.25, wasfatyEligible: true },
      { itemId: 'itm-2', nupcoCode: '6281007320021', wasfatyEligible: true },
    ], 'import');
    log = catalog.getState().wasfatyMappingLog;
    expect(log).toHaveLength(2);
  });

  it('keeps only the newest 500 entries', () => {
    for (let i = 0; i < 501; i += 1) {
      catalog.getState().setWasfatyMapping('itm-1', {
        nupcoCode: i % 2 === 0 ? '6281007320014' : '6281007320021',
        wasfatyEligible: true,
      });
    }
    const log = catalog.getState().wasfatyMappingLog;
    expect(log).toHaveLength(500);
    // The first change (from no code) has been trimmed; the oldest survivor is the second toggle.
    expect(log[0].before.nupcoCode).toBe('6281007320014');
    expect(log[499].after.nupcoCode).toBe('6281007320014');
  });
});
