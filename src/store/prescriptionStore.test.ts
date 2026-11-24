// The registry store must keep one prescription coherent across fills: captured once, dispensed
// many times, and findable later by any identifier the pharmacist has at the counter.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DispenseEvent } from '../types/prescriptions';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
  key: () => null,
  length: 0,
});

type StoreModule = typeof import('./prescriptionStore');

let store: StoreModule['usePrescriptionStore'];

beforeAll(async () => {
  store = (await import('./prescriptionStore')).usePrescriptionStore;
});

beforeEach(() => {
  store.setState({ prescriptions: [] });
});

function input() {
  return {
    prescriptionNo: 'RX-1001',
    source: 'private' as const,
    patientNationalId: '1234567890',
    patientName: 'Ahmed Ali',
    prescriberName: 'Dr. Demo',
    issuedDate: '2026-01-01',
    lines: [
      {
        itemId: 'itm-1',
        itemNameEn: 'Amoxicillin 500mg',
        itemNameAr: 'أموكسيسيلين',
        unit: 'Box',
        quantityPrescribed: 30,
        refillsAuthorized: 2,
      },
    ],
    createdBy: 'cashier',
  };
}

function event(qty: number, at: string): DispenseEvent {
  return {
    id: `evt-${at}`,
    invoiceId: 'inv-1',
    invoiceNo: 'SIM-000001',
    dispensedAt: at,
    dispensedBy: 'cashier',
    lines: [{ prescriptionLineId: 'ignored', itemId: 'itm-1', qty, unit: 'Box' }],
  };
}

describe('prescriptionStore', () => {
  it('captures a prescription with its expiry window and an active status', () => {
    const rx = store.getState().addPrescription(input());
    expect(rx.id).toBeTruthy();
    expect(rx.expiryDate).toBe('2026-01-31');
    expect(rx.validityDays).toBe(30);
    expect(rx.status).toBe('active');
    expect(rx.lines[0].id).toBeTruthy();
    expect(rx.lines[0].quantityDispensed).toBe(0);
    expect(rx.lines[0].substitutionAllowed).toBe(true);
  });

  it('applies a fill to the right line and derives the status', () => {
    const rx = store.getState().addPrescription(input());
    const lineId = rx.lines[0].id;

    const first = store.getState().recordDispense(rx.id, {
      ...event(10, '2026-01-02T09:00:00.000Z'),
      lines: [{ prescriptionLineId: lineId, itemId: 'itm-1', qty: 10, unit: 'Box' }],
    }, '2026-01-02');
    expect(first?.lines[0].quantityDispensed).toBe(10);
    expect(first?.status).toBe('partially_dispensed');
    expect(first?.dispenseEvents).toHaveLength(1);

    const second = store.getState().recordDispense(rx.id, {
      ...event(80, '2026-01-03T09:00:00.000Z'),
      lines: [{ prescriptionLineId: lineId, itemId: 'itm-1', qty: 80, unit: 'Box' }],
    }, '2026-01-03');
    expect(second?.lines[0].quantityDispensed).toBe(90);
    expect(second?.status).toBe('dispensed');
    expect(store.getState().byId(rx.id)?.dispenseEvents).toHaveLength(2);
  });

  it('finds a prescription by number (case-insensitive), national ID, Wasfaty reference or name', () => {
    const rx = store.getState().addPrescription({
      ...input(),
      source: 'wasfaty',
      wasfatyReferenceNo: 'WF-77',
    });

    expect(store.getState().byNo('rx-1001')?.id).toBe(rx.id);
    expect(store.getState().search('1234567890').map((r) => r.id)).toEqual([rx.id]);
    expect(store.getState().search('wf-77').map((r) => r.id)).toEqual([rx.id]);
    expect(store.getState().search('ahmed').map((r) => r.id)).toEqual([rx.id]);
    expect(store.getState().search('nothing')).toEqual([]);
  });

  it('lets the pharmacy cancel a prescription', () => {
    const rx = store.getState().addPrescription(input());
    store.getState().setStatus(rx.id, 'cancelled');
    expect(store.getState().byId(rx.id)?.status).toBe('cancelled');
  });
});
