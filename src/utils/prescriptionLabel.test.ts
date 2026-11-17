// Prescription label builder (utils/prescriptionLabel.ts). The label is a compliance document: if it
// drops a field (patient, refills left, batch/expiry) or prints the wrong quantity, the pharmacy is
// handing over a mislabelled medicine. Each test pins one of those fields to an exact value.
import { describe, expect, it } from 'vitest';

import type { DosageSnapshot } from '../types/dosage';
import type { DispenseEvent, Prescription, PrescriptionLine } from '../types/prescriptions';
import { buildPrescriptionLabels, type LabelStore } from './prescriptionLabel';

const store: LabelStore = {
  nameEn: 'Nour Pharmacy',
  nameAr: 'صيدلية النور',
  address: 'Riyadh, Olaya St.',
  phone: '0112223344',
  branchName: 'Olaya',
};

function dosage(overrides: Partial<DosageSnapshot> = {}): DosageSnapshot {
  return {
    code: 'DOS-000007',
    doseAmount: '1',
    doseUnit: 'capsule',
    route: 'oral',
    frequency: 'every_8_hours',
    timing: 'none',
    durationDays: 5,
    additionalInstructionsEn: 'Do not exceed 3 capsules in 24 hours.',
    additionalInstructionsAr: 'لا تتجاوز 3 كبسولات في 24 ساعة.',
    textEn: 'Take 1 capsule by mouth every 8 hours for 5 days.',
    textAr: 'تناول كبسولة عن طريق الفم كل 8 ساعات لمدة 5 أيام.',
    ...overrides,
  };
}

function line(overrides: Partial<PrescriptionLine> = {}): PrescriptionLine {
  return {
    id: 'rx-line-1',
    itemId: 'itm-8',
    itemNameEn: 'Tramadol 50mg (20 caps)',
    itemNameAr: 'ترامادول 50 مجم',
    unit: 'Strip',
    quantityPrescribed: 2,
    quantityDispensed: 1,
    refillsAuthorized: 2,
    dosage: dosage(),
    ...overrides,
  };
}

function event(overrides: Partial<DispenseEvent> = {}): DispenseEvent {
  return {
    id: 'evt-1',
    invoiceId: 'inv-1',
    invoiceNo: 'SIM-000001',
    dispensedAt: '2026-11-17T10:30:00.000Z',
    dispensedBy: 'cashier',
    lines: [
      {
        prescriptionLineId: 'rx-line-1',
        itemId: 'itm-8',
        qty: 1,
        unit: 'Strip',
        batchNo: 'TR24L19',
        expiryDate: '2027-05-01',
      },
    ],
    ...overrides,
  };
}

function prescription(overrides: Partial<Prescription> = {}): Prescription {
  return {
    id: 'rx-1',
    prescriptionNo: 'RX-2026-0042',
    source: 'private',
    patientNationalId: '1012345678',
    patientName: 'Ahmed Al-Otaibi',
    prescriberName: 'Dr. Demo',
    issuedDate: '2026-11-01',
    expiryDate: '2026-12-01',
    validityDays: 30,
    status: 'partially_dispensed',
    lines: [line()],
    dispenseEvents: [event()],
    createdAt: '2026-11-01T08:00:00.000Z',
    createdBy: 'cashier',
    ...overrides,
  };
}

describe('prescription label', () => {
  it('prints every field SFDA expects on a dispensing label', () => {
    const [label] = buildPrescriptionLabels({ prescription: prescription(), store });

    expect(label.storeNameEn).toBe('Nour Pharmacy');
    expect(label.storeNameAr).toBe('صيدلية النور');
    expect(label.contact).toBe('Olaya · Riyadh, Olaya St. · 0112223344');
    expect(label.patientName).toBe('Ahmed Al-Otaibi');
    // Masked: a 50mm label must not carry a full national ID.
    expect(label.patientId).toBe('••••••5678');
    expect(label.itemNameEn).toBe('Tramadol 50mg (20 caps)');
    expect(label.itemNameAr).toBe('ترامادول 50 مجم');
    expect(label.prescriptionNo).toBe('RX-2026-0042');
    expect(label.quantityEn).toBe('Qty 1 Strip');
    expect(label.quantityAr).toBe('الكمية 1 Strip');
    expect(label.batchNo).toBe('TR24L19');
    expect(label.expiryDate).toBe('2027-05-01');
    expect(label.dispensedDate).toBe('2026-11-17');
    expect(label.prescriberName).toBe('Dr. Demo');
    expect(label.sourceEn).toBe('Private prescription');
  });

  it('states the remaining refills after this fill, in both languages', () => {
    const [label] = buildPrescriptionLabels({ prescription: prescription(), store });
    expect(label.refillsLeft).toBe(2);
    expect(label.refillsEn).toBe('Refills left: 2');
    expect(label.refillsAr).toBe('مرات الصرف المتبقية: 2');
    expect(label.fillEn).toBe('Fill 1 of 3');

    const exhausted = buildPrescriptionLabels({
      prescription: prescription({
        lines: [line({ quantityDispensed: 6, refillsAuthorized: 2 })],
      }),
      store,
    })[0];
    expect(exhausted.refillsLeft).toBe(0);
    expect(exhausted.refillsEn).toBe('No refills left');
    expect(exhausted.refillsAr).toBe('لا توجد مرات صرف متبقية');
  });

  it('prints compact bilingual directions plus the course length', () => {
    const [label] = buildPrescriptionLabels({ prescription: prescription(), store });
    expect(label.hasDirections).toBe(true);
    expect(label.directionsEn).toBe('every 8 hours');
    // The Arabic compact label always names the dose ("كبسولة"), because "كل 8 ساعات" alone does not
    // say how much to take; English omits a one-unit dose and keeps the same rule as the POS label.
    expect(label.directionsAr).toBe('كبسولة كل 8 ساعات');
    expect(label.durationEn).toBe('for 5 days');
    expect(label.durationAr).toBe('لمدة 5 أيام');
    expect(label.additionalEn).toMatch(/Do not exceed 3 capsules/);
    expect(label.additionalAr).toMatch(/لا تتجاوز 3 كبسولات/);
  });

  it('still labels a prescription with no directions recorded', () => {
    const [label] = buildPrescriptionLabels({
      prescription: prescription({ lines: [line({ dosage: undefined })] }),
      store,
    });
    expect(label.hasDirections).toBe(false);
    expect(label.directionsEn).toBe('Use as directed');
    expect(label.directionsAr).toBe('استخدم حسب التوجيه');
    expect(label.durationEn).toBeUndefined();
  });

  it('labels the fill it is given, not the newest one', () => {
    const firstFill = event();
    const secondFill = event({
      id: 'evt-2',
      invoiceNo: 'SIM-000002',
      dispensedAt: '2026-12-01T09:00:00.000Z',
      lines: [
        { prescriptionLineId: 'rx-line-1', itemId: 'itm-8', qty: 2, unit: 'Strip', batchNo: 'TR25A02', expiryDate: '2027-09-01' },
      ],
    });
    const rx = prescription({ dispenseEvents: [firstFill, secondFill] });

    const [latest] = buildPrescriptionLabels({ prescription: rx, store });
    expect(latest.quantityEn).toBe('Qty 2 Strip');
    expect(latest.batchNo).toBe('TR25A02');
    expect(latest.dispensedDate).toBe('2026-12-01');

    const [reprint] = buildPrescriptionLabels({ prescription: rx, event: firstFill, store });
    expect(reprint.quantityEn).toBe('Qty 1 Strip');
    expect(reprint.batchNo).toBe('TR24L19');
    expect(reprint.dispensedDate).toBe('2026-11-17');
  });

  it('previews the remaining quantity when nothing has been dispensed yet', () => {
    const [label] = buildPrescriptionLabels({
      prescription: prescription({
        status: 'active',
        lines: [line({ quantityDispensed: 0 })],
        dispenseEvents: [],
      }),
      store,
    });
    expect(label.quantityEn).toBe('Qty 2 Strip');
    expect(label.dispensedDate).toBe('2026-11-01'); // capture date
    expect(label.batchNo).toBeUndefined();
  });

  it('produces one label per prescription line', () => {
    const labels = buildPrescriptionLabels({
      prescription: prescription({
        lines: [
          line(),
          line({ id: 'rx-line-2', itemId: 'itm-9', itemNameEn: 'Diazepam 5mg (20 tabs)', unit: 'Strip' }),
        ],
        dispenseEvents: [
          event({
            lines: [
              { prescriptionLineId: 'rx-line-1', itemId: 'itm-8', qty: 1, unit: 'Strip' },
              { prescriptionLineId: 'rx-line-2', itemId: 'itm-9', qty: 1, unit: 'Strip' },
            ],
          }),
        ],
      }),
      store,
    });
    expect(labels.map((label) => label.itemNameEn)).toEqual([
      'Tramadol 50mg (20 caps)',
      'Diazepam 5mg (20 tabs)',
    ]);
    expect(new Set(labels.map((label) => label.key)).size).toBe(2);
  });

  it('names the source and its Wasfaty reference when the prescription came from Wasfaty', () => {
    const [label] = buildPrescriptionLabels({
      prescription: prescription({ source: 'wasfaty', wasfatyReferenceNo: 'WF-77' }),
      store,
    });
    expect(label.sourceEn).toBe('Wasfaty · WF-77');
    expect(label.sourceAr).toBe('وصفتي · WF-77');
  });
});
