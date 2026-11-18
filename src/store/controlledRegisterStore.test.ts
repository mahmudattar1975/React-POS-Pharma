// The register's acceptance criterion is that its running balance and Batch.qtyOnHand agree after a
// controlled dispense followed by a customer return. These tests drive the real stores (no mocks)
// in the same order the app does: register row first, stock mutation second.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlledMovementInput } from '../types/controlledRegister';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
  key: () => null,
  length: 0,
});

type RegisterModule = typeof import('./controlledRegisterStore');
type CatalogModule = typeof import('./catalogStore');

let register: RegisterModule['useControlledRegisterStore'];
let catalog: CatalogModule['useCatalogStore'];

const BRANCH = 'cc-riyadh';
const TRAMADOL = 'itm-8';

beforeAll(async () => {
  register = (await import('./controlledRegisterStore')).useControlledRegisterStore;
  catalog = (await import('./catalogStore')).useCatalogStore;
});

beforeEach(() => {
  register.setState({ entries: [] });
  catalog.setState({
    items: [],
    batches: [
      {
        id: 'b-tr-1',
        itemId: TRAMADOL,
        batchNo: 'TR24L19',
        expiryDate: '2028-01-31',
        receivedDate: '2026-01-01',
        qtyOnHand: 25,
        purchasePrice: 1,
        purchaseDiscountPercent: 0,
        costPrice: 1,
      },
    ],
  });
});

function stockOf(itemId = TRAMADOL): number {
  return catalog
    .getState()
    .batches.filter((batch) => batch.itemId === itemId)
    .reduce((sum, batch) => sum + batch.qtyOnHand, 0);
}

function dispense(qty: number, overrides: Partial<ControlledMovementInput> = {}) {
  return register.getState().recordMovement({
    kind: 'dispense',
    itemId: TRAMADOL,
    itemNameEn: 'Tramadol 50mg',
    itemNameAr: 'ترامادول 50 مجم',
    batchNo: 'TR24L19',
    expiryDate: '2028-01-31',
    baseQty: qty,
    branchId: BRANCH,
    prescriptionNo: 'RX-2001',
    prescriberName: 'Dr. Saleh',
    patientNationalId: '1234567890',
    invoiceId: 'inv-1',
    invoiceNo: 'SIM-000001',
    saleLineId: 'line-1',
    pharmacist: 'cashier',
    ...overrides,
  });
}

describe('controlledRegisterStore', () => {
  it('keeps the register balance equal to stock across a dispense and its return', () => {
    const [opening, dispensed] = dispense(1);
    expect(opening.kind).toBe('opening');
    // Seeded from the shelf before the sale moves stock: 25 on hand, nothing dispensed yet.
    expect(opening.baseQty).toBe(25);
    expect(opening.balanceAfter).toBe(25);
    expect(dispensed.balanceAfter).toBe(24);

    catalog.getState().decrementBatch('b-tr-1', 1);
    expect(stockOf()).toBe(24);

    const [returned] = register.getState().recordMovement({
      kind: 'return',
      itemId: TRAMADOL,
      itemNameEn: 'Tramadol 50mg',
      itemNameAr: 'ترامادول 50 مجم',
      batchNo: 'TR24L19',
      expiryDate: '2028-01-31',
      baseQty: 1,
      branchId: BRANCH,
      invoiceId: 'inv-1',
      invoiceNo: 'SIM-000001',
      saleLineId: 'line-1',
      returnNo: 'RET-000001',
      pharmacist: 'cashier',
      reason: 'Customer changed their mind',
    });
    catalog.getState().incrementBatch('b-tr-1', 1);

    expect(returned.direction).toBe('in');
    expect(returned.balanceAfter).toBe(25);
    expect(stockOf()).toBe(25);
    // The return points at the fill it reverses, matched on invoice + sale line.
    expect(returned.reversalOf).toBe(dispensed.id);
  });

  it('seeds the opening row only once per item and branch', () => {
    dispense(1);
    catalog.getState().decrementBatch('b-tr-1', 1);
    const [second] = dispense(2);
    expect(second.kind).toBe('dispense');
    expect(register.getState().entries.filter((entry) => entry.kind === 'opening')).toHaveLength(1);
    expect(second.balanceAfter).toBe(22);
  });

  it('gives each branch its own opening balance from the same shelf count', () => {
    const [riyadh] = dispense(1);
    const [jeddah] = dispense(1, { branchId: 'cc-jeddah' });
    expect(riyadh.kind).toBe('opening');
    expect(jeddah.kind).toBe('opening');
    expect(jeddah.branchId).toBe('cc-jeddah');
    expect(register.getState().entries).toHaveLength(4);
  });

  it('records write-offs as outward movements with a required reason', () => {
    dispense(1);
    const [writeOff] = register.getState().recordMovement({
      kind: 'expiry',
      itemId: TRAMADOL,
      itemNameEn: 'Tramadol 50mg',
      itemNameAr: 'ترامادول 50 مجم',
      baseQty: 3,
      branchId: BRANCH,
      pharmacist: 'cashier',
      reason: 'Expired 2026-01',
    });
    expect(writeOff.direction).toBe('out');
    expect(writeOff.balanceAfter).toBe(21);
    expect(writeOff.reason).toBe('Expired 2026-01');
  });

  it('ignores a movement with no quantity', () => {
    expect(register.getState().recordMovement({
      kind: 'dispense',
      itemId: TRAMADOL,
      itemNameEn: 'Tramadol 50mg',
      itemNameAr: 'ترامادول 50 مجم',
      baseQty: 0,
      pharmacist: 'cashier',
    })).toEqual([]);
    expect(register.getState().entries).toHaveLength(0);
  });
});
