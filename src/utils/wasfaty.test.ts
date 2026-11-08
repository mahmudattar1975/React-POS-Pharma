import { describe, expect, it } from 'vitest';
import type { Item } from '../types/catalog';
import type { SaleHeader, SaleLine } from '../types/sales';
import {
  buildWasfatyClaimRows,
  claimMonths,
  claimsToAoa,
  claimsToCsv,
  isWasfatyCoveredItem,
  isValidNupcoCode,
  maskNationalId,
  nupcoCodeConflictMessage,
  nupcoCodeOwner,
  normaliseNupcoCode,
  summariseWasfatyClaims,
  summariseWasfatyClaimsByItem,
  unmappedWasfatyLines,
  validateWasfatySession,
  WASFATY_CLAIM_COLUMNS,
  wasfatyCoverage,
  wasfatyCoveredTotal,
  wasfatyPricingBatch,
  wasfatyPricingItem,
} from './wasfaty';

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'itm-1',
    barcode: '6281007320014',
    nameAr: 'باراسيتامول',
    nameEn: 'Paracetamol 500mg',
    unit: 'Strip',
    category: 'Analgesics',
    basePrice: 4.5,
    vatRate: 0,
    requiresBatchTracking: true,
    reorderLevel: 10,
    ...overrides,
  };
}

function saleLine(overrides: Partial<SaleLine> = {}): SaleLine {
  return {
    id: 'sl-1',
    itemId: 'itm-1',
    itemNameAr: 'باراسيتامول',
    itemNameEn: 'Paracetamol 500mg',
    batchId: 'b-1',
    batchNo: 'PC23F02',
    expiryDate: '2027-03-31',
    qty: 2,
    unit: 'Strip',
    unitPrice: 4.5,
    vatRate: 0,
    discountAmount: 0,
    netExclVat: 9,
    vatAmount: 0,
    totalInclVat: 9,
    returnedQty: 0,
    nupcoCode: '5000000000017',
    nupcoUnitPrice: 4.5,
    patientShare: 0,
    claimAmount: 9,
    ...overrides,
  };
}

function sale(overrides: Partial<SaleHeader> = {}): SaleHeader {
  return {
    id: 'sale-1',
    invoiceNo: 'SIM-000001',
    invoiceType: 'simplified',
    date: '2026-11-06T10:15:00.000Z',
    lines: [saleLine()],
    subtotalExclVat: 9,
    totalDiscount: 0,
    totalVatAmount: 0,
    totalInclVat: 9,
    payments: [{ method: 'wasfaty', amount: 9 }],
    zatcaQrBase64: '',
    zatcaStatus: 'phase1_fallback',
    status: 'completed',
    cashierName: 'Cashier',
    costCenterId: 'cc-riyadh',
    channel: 'wasfaty',
    wasfaty: {
      provider: 'manual',
      status: 'manual_recorded',
      patientNationalId: '1012345678',
      prescriptionNo: 'RX-1',
      prescriberName: 'Dr. A',
      prescriptionDate: '2026-11-05',
      authorizationNo: 'A-778899',
      dispenseId: 'disp-1',
      pharmacistId: 'user-12',
    },
    ...overrides,
  };
}

describe('NUPCO code mapping helpers', () => {
  it('normalises spaces and dashes and accepts only 13 digits', () => {
    expect(normaliseNupcoCode('5120 1599 0030 0')).toBe('5120159900300');
    expect(isValidNupcoCode('5120159900300')).toBe(true);
    expect(isValidNupcoCode('512015990030')).toBe(false);
    expect(isValidNupcoCode('512015990030A')).toBe(false);
  });

  it('refuses a code already mapped to another item, ignoring spacing', () => {
    const other = item({ id: 'itm-2', nameEn: 'Omeprazole', nupcoCode: '5120 1599 0030 0' });
    expect(nupcoCodeOwner([other], '5120159900300')?.id).toBe('itm-2');
    expect(nupcoCodeConflictMessage([other], '5120159900300')).toContain('Omeprazole');
    expect(nupcoCodeConflictMessage([other], '5120159900300', 'itm-2')).toBeUndefined();
  });

  it('treats an explicitly ineligible item as not covered even if it still has a code', () => {
    expect(isWasfatyCoveredItem(item({ nupcoCode: '5120159900300' }))).toBe(true);
    expect(isWasfatyCoveredItem(item({ wasfatyEligible: true }))).toBe(true);
    expect(isWasfatyCoveredItem(item({ nupcoCode: '5120159900300', wasfatyEligible: false }))).toBe(false);
    expect(isWasfatyCoveredItem(item({}))).toBe(false);
  });

  it('reports mapping coverage for active items only', () => {
    const coverage = wasfatyCoverage([
      item({ id: '1', nupcoCode: '5120159900300' }),
      item({ id: '2', wasfatyEligible: true }),
      item({ id: '3' }),
      item({ id: '4', isActive: false }),
    ]);
    expect(coverage).toEqual({ total: 3, mapped: 1, eligible: 2, unmappedEligible: 1, percent: 33 });
  });
});

describe('patient ID handling', () => {
  it('masks all but the last four digits', () => {
    expect(maskNationalId('1012345678')).toBe('••••••5678');
    expect(maskNationalId('5678')).toBe('••••5678');
    expect(maskNationalId('')).toBe('');
  });

  it('validates the manual session fields', () => {
    const errors = validateWasfatySession({ patientNationalId: '123', prescriptionNo: '', prescriberName: '' });
    expect(errors.patientNationalId).toBeDefined();
    expect(errors.prescriptionNo).toBeDefined();
    expect(errors.prescriberName).toBeDefined();
    expect(errors.prescriptionDate).toBeDefined();
    expect(
      validateWasfatySession({
        patientNationalId: '1012345678',
        prescriptionNo: 'RX-1',
        prescriberName: 'Dr. A',
        prescriptionDate: '2026-11-05',
      }),
    ).toEqual({});
  });
});

describe('Option A coverage arithmetic', () => {
  it('sums only covered lines and leaves non-covered lines to the patient', () => {
    const lines = [
      saleLine({ id: '1', claimAmount: 9 }),
      saleLine({ id: '2', nupcoCode: undefined, nupcoUnitPrice: undefined, patientShare: undefined, claimAmount: undefined, totalInclVat: 20 }),
    ];
    expect(wasfatyCoveredTotal(lines)).toBe(9);
  });

  it('uses the NUPCO-approved price for a covered line and ignores an ERP batch override', () => {
    const base = item({ basePrice: 5, wasfatyPrice: 4.5 });
    const batch = {
      id: 'b-1',
      itemId: 'itm-1',
      batchNo: 'PC23F02',
      expiryDate: '2027-03-31',
      receivedDate: '2026-01-01',
      qtyOnHand: 10,
      purchasePrice: 2,
      purchaseDiscountPercent: 0,
      costPrice: 2,
      salePriceOverride: 6,
    };
    expect(wasfatyPricingItem(base, true).basePrice).toBe(4.5);
    expect(wasfatyPricingBatch(batch, true, base).salePriceOverride).toBeUndefined();
    expect(wasfatyPricingItem(base, false).basePrice).toBe(5);
  });

  it('lists covered lines that have no NUPCO code', () => {
    expect(
      unmappedWasfatyLines([
        { itemNameEn: 'Mapped', wasfaty: true, nupcoCode: '5120159900300' },
        { itemNameEn: 'Unmapped', wasfaty: true },
        { itemNameEn: 'Private', wasfaty: false },
      ]),
    ).toEqual(['Unmapped']);
  });
});

describe('claim export', () => {
  const branchNames = { 'cc-riyadh': 'Riyadh - Olaya' };

  it('builds one stable row per covered line with a masked patient ID', () => {
    const rows = buildWasfatyClaimRows([sale()], { branchNames });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      invoiceNo: 'SIM-000001',
      branchName: 'Riyadh - Olaya',
      prescriptionNo: 'RX-1',
      authorizationNo: 'A-778899',
      patientIdMasked: '••••••5678',
      nupcoCode: '5000000000017',
      claimAmount: 9,
      patientShare: 0,
      exception: '',
    });
  });

  it('filters by month and branch', () => {
    const october = sale({ id: 'sale-2', invoiceNo: 'SIM-000002', date: '2026-10-01T10:00:00.000Z' });
    const otherBranch = sale({ id: 'sale-3', invoiceNo: 'SIM-000003', costCenterId: 'cc-jeddah' });
    expect(buildWasfatyClaimRows([sale(), october, otherBranch], { month: '2026-11', branchId: 'cc-riyadh' })).toHaveLength(1);
    expect(claimMonths([sale(), october])).toEqual(['2026-11', '2026-10']);
  });

  it('flags missing mapping, authorization and zero claim instead of exporting a clean zero', () => {
    const rows = buildWasfatyClaimRows([
      sale({
        lines: [saleLine({ nupcoCode: undefined, claimAmount: 0 })],
        wasfaty: {
          provider: 'manual',
          status: 'manual_recorded',
          patientNationalId: '1012345678',
          prescriptionNo: 'RX-1',
          prescriberName: 'Dr. A',
          prescriptionDate: '2026-11-05',
        },
      }),
    ]);
    expect(rows[0].exception).toContain('Unmapped item');
    expect(rows[0].exception).toContain('Missing authorization');
    expect(rows[0].exception).toContain('Zero claim');
    expect(summariseWasfatyClaims(rows).byException['Unmapped item']).toBe(1);
  });

  it('writes a header plus escaped CSV rows', () => {
    const csv = claimsToCsv(buildWasfatyClaimRows([sale({ invoiceNo: 'SIM,"1"' })]));
    expect(csv.split('\r\n')).toHaveLength(2);
    expect(csv).toContain('"SIM,""1"""');
    expect(csv.split('\r\n')[0]).toContain('Claim Amount');
  });

  it('builds numeric Excel rows with the same columns as the CSV', () => {
    const aoa = claimsToAoa(buildWasfatyClaimRows([sale()]));
    expect(aoa).toHaveLength(2);
    expect(aoa[0]).toEqual([...WASFATY_CLAIM_COLUMNS]);
    expect(aoa[1][0]).toBe('SIM-000001');
    expect(typeof aoa[1][16]).toBe('number'); // line total
    expect(aoa[1][18]).toBe(9); // claim amount
  });

  it('summarises claim rows by item and adds up repeated lines', () => {
    const rows = buildWasfatyClaimRows([
      sale({
        invoiceNo: 'SIM-A',
        lines: [
          saleLine({ id: 'l1', claimAmount: 5, totalInclVat: 5 }),
          saleLine({ id: 'l2', claimAmount: 7, totalInclVat: 7 }),
        ],
      }),
      sale({
        invoiceNo: 'SIM-B',
        lines: [
          saleLine({
            id: 'l3',
            nupcoCode: '5000000000024',
            itemNameEn: 'Amoxicillin 500mg',
            claimAmount: 12,
            totalInclVat: 12,
          }),
        ],
      }),
    ]);
    const summary = summariseWasfatyClaimsByItem(rows);
    expect(summary.map((entry) => entry.itemNameEn)).toEqual(['Amoxicillin 500mg', 'Paracetamol 500mg']);
    expect(summary[0]).toMatchObject({ claimAmount: 12, lines: 1, qty: 2 });
    expect(summary[1]).toMatchObject({ claimAmount: 12, lines: 2, qty: 4 });
  });
});
