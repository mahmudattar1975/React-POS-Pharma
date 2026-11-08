// The cart reprices every line through priceCartLine, which rebuilds the object from item/batch and
// therefore drops anything that is not a pricing input unless it is carried across explicitly.
// These tests pin the dosage snapshot to that behaviour: changing qty, discount or customer must
// never silently remove the patient's directions.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedBatches, seedCustomers, seedDosages, seedItems, seedOffers } from '../utils/seedData';
import { snapshotDosage } from '../utils/dosages';

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
type CartModule = typeof import('./cartStore');

let catalog: CatalogModule['useCatalogStore'];
let cart: CartModule['useCartStore'];

beforeAll(async () => {
  catalog = (await import('./catalogStore')).useCatalogStore;
  cart = (await import('./cartStore')).useCartStore;
});

beforeEach(() => {
  catalog.setState({ items: seedItems, batches: seedBatches, offers: seedOffers, receivingLog: [] });
  cart.setState({ lines: [], customer: seedCustomers[0] });
});

function addParacetamol() {
  const item = seedItems.find((i) => i.id === 'itm-1')!;
  const batch = seedBatches.find((b) => b.id === 'bat-1a')!;
  cart.getState().addLineForBatch(item, batch, 1);
  return cart.getState().lines[0].id;
}

describe('cart dosage snapshot', () => {
  it('survives quantity changes, discounts and customer repricing', () => {
    const lineId = addParacetamol();
    const snapshot = snapshotDosage(seedDosages[0]);

    cart.getState().setLineDosage(lineId, snapshot);
    expect(cart.getState().lines.find((l) => l.id === lineId)?.dosage).toEqual(snapshot);

    cart.getState().updateQty(lineId, 2);
    expect(cart.getState().lines.find((l) => l.id === lineId)?.dosage).toEqual(snapshot);

    cart.getState().setLineDiscount(lineId, { type: 'percent', value: 0.1 });
    expect(cart.getState().lines.find((l) => l.id === lineId)?.dosage).toEqual(snapshot);

    switchCustomer();
    expect(cart.getState().lines.find((l) => l.id === lineId)?.dosage).toEqual(snapshot);
  });

  it('can be cleared again, because directions are always optional', () => {
    const lineId = addParacetamol();
    cart.getState().setLineDosage(lineId, snapshotDosage(seedDosages[0]));
    cart.getState().setLineDosage(lineId, undefined);
    expect(cart.getState().lines.find((l) => l.id === lineId)?.dosage).toBeUndefined();
  });
});

function switchCustomer() {
  // A VIP tier reprices every line, exercising the same priceLines code path as a qty edit.
  cart.getState().setCustomer(seedCustomers[1]);
}
