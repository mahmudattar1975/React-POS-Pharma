// RSD reports drugs only. The item master's "Batch / expiry tracking" switch is the marker; these
// tests pin that a supply line (tracking off) can never reach the RSD enqueue, and that a tracked
// drug still needs a captured serial + expiry to be reportable.
import { describe, expect, it } from 'vitest';
import type { SaleLine } from '../types/sales';
import type { DrugSerial } from '../types/serial';
import { isRsdReportableLine, rsdUnitsForLine } from './rsdUnits';

function line(overrides: Partial<SaleLine> = {}): SaleLine {
  return {
    id: 'line-1',
    itemId: 'itm-1',
    itemNameAr: 'دواء',
    itemNameEn: 'Drug',
    batchId: 'bat-1',
    batchNo: 'AX24C09',
    expiryDate: '2027-03-01',
    qty: 1,
    unitPrice: 10,
    vatRate: 0,
    discountAmount: 0,
    netExclVat: 10,
    vatAmount: 0,
    totalInclVat: 10,
    returnedQty: 0,
    ...overrides,
  };
}

const serial: DrugSerial = {
  gtin: '06281007320021',
  serialNo: 'SN-A1',
  batchNo: 'AX24C09',
  expiryDate: '2027-03-01',
};

describe('RSD reportable lines', () => {
  it('reports a batch-tracked drug with captured serials', () => {
    const tracked = line({ requiresBatchTracking: true, serials: [serial] });
    expect(isRsdReportableLine(tracked)).toBe(true);
    expect(rsdUnitsForLine(tracked)).toEqual([serial]);
  });

  it('skips an item whose Batch / expiry tracking is off, even with a serial', () => {
    const supply = line({ requiresBatchTracking: false, serials: [serial] });
    expect(isRsdReportableLine(supply)).toBe(false);
    expect(rsdUnitsForLine(supply)).toEqual([]);
  });

  it('treats a missing snapshot as not reportable', () => {
    expect(rsdUnitsForLine(line({ serials: [serial] }))).toEqual([]);
  });

  it('skips a tracked item with no captured serials', () => {
    expect(rsdUnitsForLine(line({ requiresBatchTracking: true }))).toEqual([]);
  });

  it('drops a serial without an expiry date', () => {
    const tracked = line({
      requiresBatchTracking: true,
      serials: [serial, { ...serial, serialNo: 'SN-A2', expiryDate: null }],
    });
    expect(rsdUnitsForLine(tracked)).toEqual([serial]);
  });
});
