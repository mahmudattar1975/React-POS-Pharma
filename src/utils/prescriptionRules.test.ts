// Prescription rules (see utils/prescriptionRules.ts and .mdfile/represcription.md §11). These are
// the numbers the POS gate enforces, so each rule gets an exact-value test: a wrong remainder or
// refill count either over-dispenses a controlled medicine or blocks a legitimate sale.
import { describe, expect, it } from 'vitest';

import type { DispenseEvent, Prescription, PrescriptionLine } from '../types/prescriptions';
import {
  addDays, applyDispense, earlyRefillWarning, expiryFor, isExpired, lineRemaining, planDispense,
  prescriptionRemaining, refillsLeft, refillsUsed, startsNewFill, statusFor, supplyWarnings, withStatus,
} from './prescriptionRules';

function line(overrides: Partial<PrescriptionLine> = {}): PrescriptionLine {
  return {
    id: 'rx-line-1',
    itemId: 'itm-1',
    itemNameEn: 'Amoxicillin 500mg',
    itemNameAr: 'أموكسيسيلين',
    unit: 'Box',
    quantityPrescribed: 30,
    quantityDispensed: 0,
    refillsAuthorized: 0,
    ...overrides,
  };
}

function prescription(overrides: Partial<Prescription> = {}): Prescription {
  return {
    id: 'rx-1',
    prescriptionNo: 'RX-1001',
    source: 'private',
    patientNationalId: '1234567890',
    prescriberName: 'Dr. Demo',
    issuedDate: '2026-01-01',
    expiryDate: '2026-01-31',
    validityDays: 30,
    status: 'active',
    lines: [line()],
    dispenseEvents: [],
    createdAt: '2026-01-01T08:00:00.000Z',
    createdBy: 'cashier',
    ...overrides,
  };
}

function dispenseEvent(qty: number, at: string, lineId = 'rx-line-1'): DispenseEvent {
  return {
    id: `evt-${at}-${qty}`,
    invoiceId: 'inv-1',
    invoiceNo: 'SIM-000001',
    dispensedAt: at,
    dispensedBy: 'cashier',
    lines: [{ prescriptionLineId: lineId, itemId: 'itm-1', qty, unit: 'Box' }],
  };
}

describe('validity', () => {
  it('adds the validity window in whole days', () => {
    expect(addDays('2026-01-01', 30)).toBe('2026-01-31');
    expect(addDays('2026-12-20', 30)).toBe('2027-01-19');
    expect(expiryFor('2026-01-01')).toBe('2026-01-31');
    expect(expiryFor('2026-01-01', 7)).toBe('2026-01-08');
  });

  it('treats the prescription as valid through its expiry date, expired the next day', () => {
    const rx = prescription();
    expect(isExpired(rx, '2026-01-30')).toBe(false);
    expect(isExpired(rx, '2026-01-31')).toBe(false);
    expect(isExpired(rx, '2026-02-01')).toBe(true);
    expect(statusFor(rx, '2026-02-01')).toBe('expired');
  });

  it('recomputes a stale active status when the record is read', () => {
    expect(withStatus(prescription(), '2026-03-01').status).toBe('expired');
  });
});

describe('partial dispensing', () => {
  it('dispenses 10 then 20 and refuses a third fill', () => {
    let rx = prescription();
    const first = planDispense(rx, [{ prescriptionLineId: 'rx-line-1', qty: 10 }], { today: '2026-01-02' });
    expect(first.ok).toBe(true);
    expect(first.nextStatus).toBe('partially_dispensed');
    rx = applyDispense(rx, dispenseEvent(10, '2026-01-02T09:00:00.000Z'), '2026-01-02');
    expect(rx.status).toBe('partially_dispensed');
    expect(prescriptionRemaining(rx)).toBe(20);

    const second = planDispense(rx, [{ prescriptionLineId: 'rx-line-1', qty: 20 }], { today: '2026-01-03' });
    expect(second.ok).toBe(true);
    expect(second.nextStatus).toBe('dispensed');
    rx = applyDispense(rx, dispenseEvent(20, '2026-01-03T09:00:00.000Z'), '2026-01-03');
    expect(rx.status).toBe('dispensed');
    expect(prescriptionRemaining(rx)).toBe(0);

    const third = planDispense(rx, [{ prescriptionLineId: 'rx-line-1', qty: 1 }], { today: '2026-01-04' });
    expect(third.ok).toBe(false);
    expect(third.errors.join(' ')).toMatch(/fully dispensed/i);
  });

  it('refuses a quantity larger than what remains', () => {
    const rx = prescription({
      lines: [line({ quantityDispensed: 25 })],
      status: 'partially_dispensed',
    });
    const plan = planDispense(rx, [{ prescriptionLineId: 'rx-line-1', qty: 6 }], { today: '2026-01-10' });
    expect(plan.ok).toBe(false);
    expect(plan.errors.join(' ')).toMatch(/only 5 Box\(s\) remain/);
    expect(lineRemaining(rx.lines[0])).toBe(5);
  });
});

describe('refills', () => {
  it('authorises 1 fill + 2 refills = 90 units and stops there', () => {
    let rx = prescription({ lines: [line({ refillsAuthorized: 2 })] });
    expect(refillsLeft(rx.lines[0])).toBe(2);

    rx = applyDispense(rx, dispenseEvent(30, '2026-01-02T09:00:00.000Z'), '2026-01-02');
    expect(refillsUsed(rx.lines[0])).toBe(0);
    expect(refillsLeft(rx.lines[0])).toBe(2);
    expect(rx.status).toBe('partially_dispensed');

    rx = applyDispense(rx, dispenseEvent(30, '2026-01-20T09:00:00.000Z'), '2026-01-20');
    expect(refillsUsed(rx.lines[0])).toBe(1);
    expect(refillsLeft(rx.lines[0])).toBe(1);
    expect(lineRemaining(rx.lines[0])).toBe(30);

    rx = applyDispense(rx, dispenseEvent(30, '2026-02-10T09:00:00.000Z'), '2026-02-10');
    expect(refillsLeft(rx.lines[0])).toBe(0);
    expect(rx.status).toBe('dispensed');

    const fourth = planDispense(rx, [{ prescriptionLineId: 'rx-line-1', qty: 30 }], { today: '2026-02-11' });
    expect(fourth.ok).toBe(false);
    expect(fourth.errors.join(' ')).toMatch(/fully dispensed/i);
  });

  it('knows when a dispense opens a refill rather than continuing a fill', () => {
    expect(startsNewFill(line({ quantityDispensed: 0 }))).toBe(false);
    expect(startsNewFill(line({ quantityDispensed: 10 }))).toBe(false);
    expect(startsNewFill(line({ quantityDispensed: 30, refillsAuthorized: 1 }))).toBe(true);
    expect(startsNewFill(line({ quantityDispensed: 60, refillsAuthorized: 2 }))).toBe(true); // opens the third fill
    expect(startsNewFill(line({ quantityDispensed: 90, refillsAuthorized: 2 }))).toBe(false); // nothing left
  });

  it('warns early when a refill is requested too soon after the previous fill', () => {
    const rx = prescription({
      lines: [line({ refillsAuthorized: 2, durationDays: 10, quantityDispensed: 30 })],
      status: 'partially_dispensed',
      dispenseEvents: [dispenseEvent(30, '2026-01-02T09:00:00.000Z')],
    });
    expect(earlyRefillWarning(rx, rx.lines[0], '2026-01-05')).toMatch(/refill after 3 day\(s\)/);
    expect(earlyRefillWarning(rx, rx.lines[0], '2026-01-10')).toBeUndefined();
  });

  it('flags more than 2 refills and more than 90 days of supply', () => {
    const warnings = supplyWarnings([
      line({ refillsAuthorized: 3, durationDays: 30, itemNameEn: 'A' }),
      line({ id: 'rx-line-2', quantityPrescribed: 0, itemNameEn: 'B' }),
    ]);
    expect(warnings.join(' | ')).toMatch(/more than 2 refills/);
    expect(warnings.join(' | ')).toMatch(/exceeds Wasfaty's 90-day cap/);
    expect(warnings.join(' | ')).toMatch(/quantity must be greater than zero/);
    expect(supplyWarnings([line({ durationDays: 30, refillsAuthorized: 2 })])).toEqual([]);
  });
});

describe('gate overrides', () => {
  it('blocks an expired prescription unless a reason is recorded, then keeps the reason', () => {
    const rx = prescription({ status: 'partially_dispensed', lines: [line({ quantityDispensed: 5 })] });
    const today = '2026-02-05';

    const blocked = planDispense(rx, [{ prescriptionLineId: 'rx-line-1', qty: 5 }], { today });
    expect(blocked.ok).toBe(false);
    expect(blocked.errors.join(' ')).toMatch(/expired on 2026-01-31/);

    const override = planDispense(rx, [{ prescriptionLineId: 'rx-line-1', qty: 5 }], {
      today,
      overrideReason: 'Patient travelling; prescriber confirmed by phone.',
    });
    expect(override.ok).toBe(true);
    expect(override.warnings.join(' ')).toMatch(/override recorded/);

    const updated = applyDispense(
      rx,
      { ...dispenseEvent(5, '2026-02-05T10:00:00.000Z'), overrideReason: 'Patient travelling; prescriber confirmed by phone.' },
      today,
    );
    expect(updated.dispenseEvents[0].overrideReason).toMatch(/prescriber confirmed/);
    expect(updated.status).toBe('expired');
  });

  it('never allows a cancelled prescription through, with or without an override', () => {
    const rx = prescription({ status: 'cancelled' });
    const plan = planDispense(rx, [{ prescriptionLineId: 'rx-line-1', qty: 1 }], {
      today: '2026-01-05',
      overrideReason: 'N/A',
    });
    expect(plan.ok).toBe(false);
    expect(plan.errors.join(' ')).toMatch(/cancelled/);
  });
});
