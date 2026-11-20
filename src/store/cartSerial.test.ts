// Phase 1 of the RSD work: keep the physical pack identity from a GS1 DataMatrix on the cart line.
// The rest of the RSD pipeline is server-side, but everything downstream depends on these rules
// holding: one serial = one pack, the serial list is the quantity, and no pack enters the basket
// twice.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Batch, Item } from '../types/catalog';

type CatalogModule = typeof import('./catalogStore');
type CartModule = typeof import('./cartStore');

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
  key: () => null,
  length: 0,
});
// ERP barcode lookup must answer "not an ERP item" (404), not reach a real server.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
);

let catalog: CatalogModule['useCatalogStore'];
let cart: CartModule['useCartStore'];

const GS = '\x1d';

// Scanner output for a pharmaceutical DataMatrix: (01) GTIN, (17) expiry, (10) batch, (21) serial.
function datamatrix(gtin: string, batchNo: string, serialNo: string, expiry = '270301'): string {
  return `01${gtin}17${expiry}10${batchNo}${GS}21${serialNo}`;
}

const syrup: Item = {
  id: 'itm-syrup',
  barcode: '6281007320021', // GTIN-13, as the item master stores it
  nameAr: 'شراب',
  nameEn: 'Amoxicillin Syrup',
  unit: 'Bottle',
  category: 'Antibiotics',
  basePrice: 12,
  vatRate: 0,
  requiresBatchTracking: true,
  reorderLevel: 5,
};

const packed: Item = {
  id: 'itm-packed',
  barcode: '629000000123',
  nameAr: 'دواء معبأ',
  nameEn: 'Packed Drug',
  unit: 'Box',
  category: 'medicine',
  basePrice: 10,
  vatRate: 0,
  requiresBatchTracking: true,
  reorderLevel: 5,
  pack: { cartonSize: 100, boxSize: 3, stripSize: 4 }, // 1 box = 12 tablets
};

function batchFor(item: Item, overrides: Partial<Batch> = {}): Batch {
  return {
    id: `bat-${item.id}`,
    itemId: item.id,
    batchNo: 'AX24C09',
    expiryDate: '2027-03-01',
    receivedDate: '2026-01-01',
    qtyOnHand: 10,
    purchasePrice: 7.5,
    purchaseDiscountPercent: 0,
    costPrice: 7.5,
    ...overrides,
  };
}

beforeAll(async () => {
  catalog = (await import('./catalogStore')).useCatalogStore;
  cart = (await import('./cartStore')).useCartStore;
});

beforeEach(() => {
  catalog.setState({
    items: [syrup, packed],
    // The packed item is stocked in tablets and one box is 12, so keep two boxes on hand.
    batches: [batchFor(syrup), batchFor(packed, { qtyOnHand: 24 })],
    offers: [],
    receivingLog: [],
  });
  cart.getState().clear();
});

describe('scanning a serialised pack', () => {
  it('keeps the GTIN, serial, batch and expiry on the cart line', async () => {
    const result = await cart.getState().scan(datamatrix('06281007320021', 'AX24C09', 'SN-A1'));
    expect(result.type).toBe('added');

    const [line] = cart.getState().lines;
    expect(line.qty).toBe(1);
    expect(line.serials).toEqual([
      { gtin: '06281007320021', serialNo: 'SN-A1', batchNo: 'AX24C09', expiryDate: '2027-03-01' },
    ]);
  });

  it('adds each new serial as another sellable unit on the same line', async () => {
    await cart.getState().scan(datamatrix('06281007320021', 'AX24C09', 'SN-A1'));
    await cart.getState().scan(datamatrix('06281007320021', 'AX24C09', 'SN-A2'));

    const lines = cart.getState().lines;
    expect(lines).toHaveLength(1);
    expect(lines[0].qty).toBe(2);
    expect(lines[0].serials?.map((s) => s.serialNo)).toEqual(['SN-A1', 'SN-A2']);
  });

  it('refuses a serial that is already in the basket', async () => {
    await cart.getState().scan(datamatrix('06281007320021', 'AX24C09', 'SN-A1'));
    const result = await cart.getState().scan(datamatrix('06281007320021', 'AX24C09', 'SN-A1'));

    expect(result).toEqual({
      type: 'duplicate-serial',
      itemNameEn: 'Amoxicillin Syrup',
      serialNo: 'SN-A1',
    });
    expect(cart.getState().lines[0].qty).toBe(1);
    expect(cart.getState().lines[0].serials).toHaveLength(1);
  });

  it('matches the batch by batch number, not by a shared expiry date', async () => {
    catalog.setState({
      items: [syrup],
      batches: [
        batchFor(syrup, { id: 'bat-a', batchNo: 'LOT-A', expiryDate: '2027-03-01' }),
        batchFor(syrup, { id: 'bat-b', batchNo: 'LOT-B', expiryDate: '2027-03-01' }),
      ],
      offers: [],
      receivingLog: [],
    });

    await cart.getState().scan(datamatrix('06281007320021', 'LOT-B', 'SN-B1'));
    expect(cart.getState().lines[0].batchId).toBe('bat-b');
    expect(cart.getState().lines[0].batchNo).toBe('LOT-B');
  });

  it('refuses a pack whose batch is not on hand', async () => {
    const result = await cart.getState().scan(datamatrix('06281007320021', 'NOPE', 'SN-X1'));
    expect(result.type).toBe('no-batch-matched');
    expect(cart.getState().lines).toHaveLength(0);
  });

  it('normalises the printed GTIN to find an item stored as GTIN-13', async () => {
    // 06281007320021 is the padded form; the item master only has 6281007320021.
    await cart.getState().scan(datamatrix('06281007320021', 'AX24C09', 'SN-A1'));
    expect(cart.getState().lines[0].itemId).toBe('itm-syrup');
  });
});

describe('serialised quantities', () => {
  it('drops the last serials when the cashier lowers the quantity', async () => {
    await cart.getState().scan(datamatrix('06281007320021', 'AX24C09', 'SN-A1'));
    await cart.getState().scan(datamatrix('06281007320021', 'AX24C09', 'SN-A2'));
    await cart.getState().scan(datamatrix('06281007320021', 'AX24C09', 'SN-A3'));

    const { appliedQty } = cart.getState().updateQty(cart.getState().lines[0].id, 2);
    expect(appliedQty).toBe(2);

    const [line] = cart.getState().lines;
    expect(line.qty).toBe(2);
    expect(line.serials?.map((s) => s.serialNo)).toEqual(['SN-A1', 'SN-A2']);
  });

  it('cannot raise the quantity past the packs that were actually scanned', async () => {
    await cart.getState().scan(datamatrix('06281007320021', 'AX24C09', 'SN-A1'));
    await cart.getState().scan(datamatrix('06281007320021', 'AX24C09', 'SN-A2'));

    const { appliedQty } = cart.getState().updateQty(cart.getState().lines[0].id, 5);
    expect(appliedQty).toBe(2);
    expect(cart.getState().lines[0].qty).toBe(2);
    expect(cart.getState().lines[0].serials).toHaveLength(2);
  });

  it('freezes the selling level of a serialised packed line', async () => {
    await cart.getState().scan(datamatrix('00629000000123', 'AX24C09', 'SN-P1'));
    const [line] = cart.getState().lines;
    expect(line.packLevel).toBe('box');
    expect(line.baseQty).toBe(12);

    cart.getState().setLinePackLevel(line.id, 'strip');
    const after = cart.getState().lines[0];
    expect(after.packLevel).toBe('box');
    expect(after.qty).toBe(1);
    expect(after.serials).toHaveLength(1);
  });

  it('keeps a plain barcode line separate from serialised packs on the same batch', async () => {
    await cart.getState().scan(datamatrix('06281007320021', 'AX24C09', 'SN-A1'));
    cart.getState().pickItem(syrup);

    const lines = cart.getState().lines;
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.serials?.length)).toMatchObject({ qty: 1 });
    expect(lines.find((l) => !l.serials)).toMatchObject({ qty: 1 });
  });
});
