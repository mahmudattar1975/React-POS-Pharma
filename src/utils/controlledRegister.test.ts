// Reconciliation is what the register is audited on: per item and branch, opening + in - out must
// equal the closing balance, and the closing balance must match stock when the owner reconciles a
// single branch. The CSV is the regulator hand-off, so its columns and masking are pinned too.
import { describe, expect, it } from 'vitest';
import type { ControlledRegisterEntry } from '../types/controlledRegister';
import { controlledRegisterCsv, reconcileControlledRegister } from './controlledRegister';

function entry(overrides: Partial<ControlledRegisterEntry> = {}): ControlledRegisterEntry {
  return {
    id: `creg-${Math.random().toString(36).slice(2)}`,
    at: '2026-11-05T09:00:00.000Z',
    kind: 'dispense',
    direction: 'out',
    itemId: 'itm-8',
    itemNameEn: 'Tramadol 50mg',
    itemNameAr: 'ترامادول 50 مجم',
    baseQty: 10,
    balanceAfter: 0,
    branchId: 'cc-riyadh',
    pharmacist: 'cashier',
    ...overrides,
  };
}

describe('reconcileControlledRegister', () => {
  const entries: ControlledRegisterEntry[] = [
    // October: the register opened at 30 and sold 5, so November starts from 25.
    entry({ at: '2026-10-01T08:00:00.000Z', kind: 'opening', direction: 'in', baseQty: 30, balanceAfter: 30 }),
    entry({ at: '2026-10-20T08:00:00.000Z', kind: 'dispense', direction: 'out', baseQty: 5, balanceAfter: 25 }),
    // November: sold 10, took 1 back.
    entry({ at: '2026-11-05T09:00:00.000Z', kind: 'dispense', direction: 'out', baseQty: 10, balanceAfter: 15 }),
    entry({ at: '2026-11-06T09:00:00.000Z', kind: 'return', direction: 'in', baseQty: 1, balanceAfter: 16 }),
  ];

  it('carries the previous closing balance forward and nets the month movement', () => {
    const [row] = reconcileControlledRegister(entries, '2026-11');
    expect(row.itemId).toBe('itm-8');
    expect(row.opening).toBe(25);
    expect(row.inQty).toBe(1);
    expect(row.outQty).toBe(10);
    expect(row.closing).toBe(16);
    // All-branch reconciliation has nothing trustworthy to compare against, so no stock columns.
    expect(row.stockOnHand).toBeUndefined();
    expect(row.variance).toBeUndefined();
  });

  it('compares closing balance with stock on hand for a single branch', () => {
    const balanced = reconcileControlledRegister(entries, '2026-11', 'cc-riyadh', new Map([['itm-8', 16]]));
    expect(balanced[0].variance).toBe(0);

    const short = reconcileControlledRegister(entries, '2026-11', 'cc-riyadh', new Map([['itm-8', 14]]));
    expect(short[0].variance).toBe(2);
  });

  it('starts a month at zero when the item had no earlier movements', () => {
    const [row] = reconcileControlledRegister(
      [entry({ at: '2026-11-02T10:00:00.000Z', kind: 'opening', direction: 'in', baseQty: 12, balanceAfter: 12 })],
      '2026-11',
    );
    expect(row.opening).toBe(0);
    expect(row.inQty).toBe(12);
    expect(row.closing).toBe(12);
  });

  it('ignores entries outside the month and other branches', () => {
    expect(reconcileControlledRegister(entries, '2026-12')).toEqual([]);
    expect(reconcileControlledRegister(entries, '2026-11', 'cc-jeddah')).toEqual([]);
  });
});

describe('controlledRegisterCsv', () => {
  it('writes one row per movement with in/out split, masked patient ID and the reversal link', () => {
    const csv = controlledRegisterCsv(
      [
        entry({
          at: '2026-11-05T09:00:00.000Z',
          kind: 'dispense',
          direction: 'out',
          baseQty: 10,
          balanceAfter: 15,
          batchNo: 'TR24L19',
          expiryDate: '2028-01-31',
          prescriptionNo: 'RX-2001',
          prescriberName: 'Dr. Saleh',
          patientNationalId: '1234567890',
          invoiceNo: 'SIM-000001',
          pharmacist: 'Mona',
          witness: 'Omar',
          reason: 'Dispensed, "as written"',
        }),
        entry({
          at: '2026-11-06T09:00:00.000Z',
          kind: 'return',
          direction: 'in',
          baseQty: 1,
          balanceAfter: 16,
          returnNo: 'RET-000001',
          reversalOf: 'creg-abc12345',
          reason: 'Customer changed their mind',
        }),
      ],
      { 'cc-riyadh': 'CC-01 — Riyadh' },
    );

    const lines = csv.split('\r\n');
    expect(lines[0].startsWith('Date/time,Type,Item,Arabic name,Batch,Expiry,Qty in,Qty out,Balance')).toBe(true);
    expect(lines).toHaveLength(3);

    // Dispense: the quantity sits in the "out" column, balance is carried, and the quoted reason is
    // escaped rather than breaking the row.
    const dispensed = lines[1];
    expect(dispensed).toContain('Dispense');
    expect(dispensed).toContain(',,10,15,CC-01 — Riyadh,RX-2001,Dr. Saleh,');
    expect(dispensed).toContain('"Dispensed, ""as written"""');
    expect(dispensed).toContain('Mona,Omar');
    // Full national ID never leaves the building.
    expect(dispensed).not.toContain('1234567890');

    const returned = lines[2];
    expect(returned).toContain('Return');
    expect(returned).toContain(',1,,16,');
    expect(returned).toContain('RET-000001');
    expect(returned).toContain('creg-abc12345');
  });

  it('labels an unassigned branch and blanks missing optional fields', () => {
    const csv = controlledRegisterCsv([entry({ branchId: undefined, batchNo: undefined, expiryDate: null })]);
    expect(csv.split('\r\n')[1]).toContain(',Unassigned,');
  });
});
