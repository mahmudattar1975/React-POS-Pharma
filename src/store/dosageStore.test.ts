// Store-level tests for the dosage library: system numbering, edit identity and the item-link
// clean-up that must happen when a direction is deleted.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedBatches, seedDosages, seedItems, seedOffers } from '../utils/seedData';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
  key: () => null,
  length: 0,
});

type CatalogModule = typeof import('./catalogStore');
type DosageModule = typeof import('./dosageStore');

let catalog: CatalogModule['useCatalogStore'];
let dosages: DosageModule['useDosageStore'];

beforeAll(async () => {
  catalog = (await import('./catalogStore')).useCatalogStore;
  dosages = (await import('./dosageStore')).useDosageStore;
});

beforeEach(() => {
  catalog.setState({ items: seedItems, batches: seedBatches, offers: seedOffers, receivingLog: [] });
  dosages.setState({ dosages: seedDosages });
});

function input() {
  return {
    doseAmount: '1',
    doseUnit: 'tablet' as const,
    route: 'oral' as const,
    frequency: 'once_daily' as const,
    timing: 'morning' as const,
  };
}

describe('dosage library store', () => {
  it('assigns the next system code and stores the structured fields', () => {
    const created = dosages.getState().addDosage(input(), true);
    expect(created.code).toBe('DOS-000012');
    expect(created.id).toMatch(/^dos-/);
    expect(created.isActive).toBe(true);
    expect(created.createdAt).toBeTruthy();
    expect(dosages.getState().dosages).toHaveLength(seedDosages.length + 1);
  });

  it('keeps the code and creation time when the wording is edited', () => {
    const before = dosages.getState().dosages.find((d) => d.id === 'dos-1')!;
    dosages.getState().updateDosage('dos-1', { ...input(), durationDays: 10 }, false);
    const after = dosages.getState().dosages.find((d) => d.id === 'dos-1')!;
    expect(after.code).toBe(before.code);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.durationDays).toBe(10);
    expect(after.isActive).toBe(false);
    expect(after.updatedAt).toBeTruthy();
  });

  it('removes dangling item links and clears the suggested default', () => {
    expect(catalog.getState().itemById('itm-1')?.defaultDosageId).toBe('dos-1');

    dosages.getState().removeDosage('dos-1');

    expect(dosages.getState().dosages.some((d) => d.id === 'dos-1')).toBe(false);
    const item = catalog.getState().itemById('itm-1')!;
    expect(item.dosageIds).toEqual(['dos-2']);
    expect(item.defaultDosageId).toBeUndefined();
  });

  it('drops the dosageIds field entirely when the last link goes', () => {
    dosages.getState().removeDosage('dos-5');
    const item = catalog.getState().itemById('itm-4')!;
    expect(item.dosageIds).toBeUndefined();
    expect(item.defaultDosageId).toBeUndefined();
  });
});
