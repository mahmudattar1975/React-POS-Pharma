import { describe, expect, it } from 'vitest';
import type { SaleHeader, ReturnHeader } from '../types/sales';
import type { PurchaseInvoice, Vendor } from '../types/purchasing';
import type { Item, Batch } from '../types/catalog';
import type { Customer } from '../types/customer';
import {
  monthlyTrend, monthsBack, summariseParties, summarisePurchases, summariseSales, summariseStock,
  withinPeriod,
} from './analytics';

function sale(overrides: Partial<SaleHeader> = {}): SaleHeader {
  return {
    id: 's1',
    invoiceNo: 'SIM-1',
    invoiceType: 'simplified',
    date: '2026-11-10T10:00:00.000Z',
    lines: [
      {
        id: 'l1', itemId: 'i1', itemNameAr: 'دواء', itemNameEn: 'Panadol', batchId: 'b1', batchNo: 'B1',
        expiryDate: '2027-01-01', qty: 2, unitPrice: 10, vatRate: 0, discountAmount: 0,
        netExclVat: 20, vatAmount: 0, totalInclVat: 20, returnedQty: 0,
      },
    ],
    subtotalExclVat: 20,
    totalDiscount: 0,
    totalVatAmount: 0,
    totalInclVat: 20,
    payments: [{ method: 'cash', amount: 20 }],
    zatcaQrBase64: '',
    zatcaStatus: 'phase1_fallback',
    status: 'completed',
    cashierName: 'Sara',
    ...overrides,
  };
}

function saleReturn(overrides: Partial<ReturnHeader> = {}): ReturnHeader {
  return {
    id: 'r1',
    returnNo: 'RET-1',
    date: '2026-11-11T10:00:00.000Z',
    originalInvoiceId: 's1',
    originalInvoiceNo: 'SIM-1',
    lines: [{ saleLineId: 'l1', itemNameEn: 'Panadol', qty: 1, refundAmount: 10 }],
    totalRefund: 10,
    reason: 'damaged',
    ...overrides,
  };
}

function purchase(overrides: Partial<PurchaseInvoice> = {}): PurchaseInvoice {
  return {
    id: 'p1',
    invoiceNo: 'PUR-000001',
    vendorInvoiceNo: 'V-77',
    vendorId: 'v1',
    vendorNameAr: 'مورد',
    vendorNameEn: 'Al Dawaa',
    date: '2026-11-05',
    receivedAt: '2026-11-05T09:00:00.000Z',
    receivedBy: 'Ali',
    lines: [
      {
        id: 'pl1', itemId: 'i1', itemNameAr: 'دواء', itemNameEn: 'Panadol', unit: 'Box', vatRate: 0.15,
        batchNo: 'B1', expiryDate: '2027-01-01', qty: 10, bonusQty: 1, totalQty: 11, bonusValue: 20,
        unitPurchasePrice: 20, discount1Percent: 0, discount2Percent: 0, discount3Percent: 0,
        discount1Amount: 0, discount2Amount: 0, discount3Amount: 0, discountTotal: 0,
        purchaseDiscountPercent: 0, unitCostPrice: 20, dilutedUnitCostPrice: 18.182,
        netExclVat: 200, vatAmount: 30, totalInclVat: 230,
      },
    ],
    subtotalExclVat: 200,
    totalDiscount: 0,
    totalBonusValue: 20,
    netExclVat: 200,
    totalVatAmount: 30,
    totalInclVat: 230,
    vatByRate: [{ rate: 0.15, taxableAmount: 200, vatAmount: 30 }],
    ...overrides,
  };
}

const item: Item = {
  id: 'i1', barcode: '1', nameAr: 'دواء', nameEn: 'Panadol', unit: 'Box', category: 'Pain',
  basePrice: 20, vatRate: 0, requiresBatchTracking: true, reorderLevel: 5,
};

const batch: Batch = {
  id: 'b1', itemId: 'i1', batchNo: 'B1', expiryDate: '2026-12-01', receivedDate: '2026-10-01',
  qtyOnHand: 10, purchasePrice: 10, purchaseDiscountPercent: 0, costPrice: 10,
};

describe('dashboard analytics', () => {
  it('summarises sales and keeps returns as their own figure', () => {
    const summary = summariseSales([sale(), sale({ id: 's2', payments: [{ method: 'card', amount: 20 }] })], [saleReturn()]);
    expect(summary.invoiceCount).toBe(2);
    expect(summary.grossSales).toBe(40);
    expect(summary.avgBasket).toBe(20);
    expect(summary.refunded).toBe(10);
    expect(summary.returnCount).toBe(1);
    expect(summary.returnRate).toBe(0.25);
    expect(summary.byPayment.map((p) => p.name)).toEqual(['Cash', 'Card']);
    expect(summary.topItems[0]).toMatchObject({ name: 'Panadol', value: 40, meta: '4 sold' });
  });

  it('separates purchase invoices from purchase returns', () => {
    const credit = purchase({
      id: 'p2', invoiceNo: 'RET-000001', isReturn: true, totalInclVat: 23,
      lines: [{ ...purchase().lines[0], qty: 1, bonusQty: 0, totalQty: 1, netExclVat: 20, vatAmount: 3, totalInclVat: 23 }],
    });
    const summary = summarisePurchases([purchase(), credit]);
    expect(summary.invoiceCount).toBe(1);
    expect(summary.purchasesInclVat).toBe(230);
    expect(summary.paidUnits).toBe(10);
    expect(summary.bonusUnits).toBe(1);
    expect(summary.returnCount).toBe(1);
    expect(summary.credit).toBe(23);
    expect(summary.returnedUnits).toBe(1);
    expect(summary.topVendors[0]).toMatchObject({ name: 'Al Dawaa', value: 230 });
  });

  it('values stock at cost and retail and finds low and expiring batches', () => {
    const summary = summariseStock([item], [batch], '2026-11-14');
    expect(summary.units).toBe(10);
    expect(summary.costValue).toBe(100);
    expect(summary.retailValue).toBe(200);
    expect(summary.margin).toBe(100);
    expect(summary.lowStock).toHaveLength(0);
    expect(summary.expiring).toHaveLength(1);
    expect(summary.expiring[0]).toMatchObject({ name: 'Panadol', batchNo: 'B1' });
  });

  it('flags an item at or below its reorder level', () => {
    const summary = summariseStock([{ ...item, reorderLevel: 12 }], [batch], '2026-11-14');
    expect(summary.lowStock).toHaveLength(1);
    expect(summary.lowStock[0]).toMatchObject({ name: 'Panadol', qty: 10, reorderLevel: 12 });
  });

  it('rolls the six-month trend without a minus row', () => {
    const trend = monthlyTrend([sale()], [saleReturn()], [purchase()], 6);
    expect(trend).toHaveLength(6);
    expect(trend[trend.length - 1].label).toBe('Nov 26');
    expect(trend[trend.length - 1]).toMatchObject({ sales: 20, salesReturns: 10, purchases: 230, purchaseReturns: 0 });
    expect(trend[0]).toMatchObject({ sales: 0, purchases: 0 });
  });

  it('builds month keys across a year boundary', () => {
    expect(monthsBack('2026-02-10', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('filters by period using date-only comparison', () => {
    expect(withinPeriod('2026-11-10T23:00:00.000Z', 7, '2026-11-14')).toBe(true);
    expect(withinPeriod('2026-10-01T10:00:00.000Z', 7, '2026-11-14')).toBe(false);
    expect(withinPeriod('2020-01-01', null, '2026-11-14')).toBe(true);
  });

  it('ranks vendors and customers separately', () => {
    const vendors: Vendor[] = [
      { id: 'v1', typeFlag: 1, vendorNo: 'VEN-1', nameAr: 'مورد', nameEn: 'Al Dawaa', phone: '' },
      { id: 'v2', typeFlag: 2, vendorNo: 'VEN-2', nameAr: 'عميل', nameEn: 'Care Co', phone: '' },
    ];
    const customers: Customer[] = [
      {
        id: 'c1', nameAr: 'عميل', nameEn: 'Mona', phone: '0500000000', tier: 'normal',
        loyaltyPoints: 30,
      },
    ];
    const summary = summariseParties(
      vendors,
      customers,
      [purchase()],
      [sale({ customerId: 'c1', customerNameEn: 'Mona' })]
    );
    expect(summary.vendorCount).toBe(1);
    expect(summary.customerCount).toBe(2);
    expect(summary.loyaltyPoints).toBe(30);
    expect(summary.topVendors[0]).toMatchObject({ name: 'Al Dawaa', value: 230 });
    expect(summary.topCustomers[0]).toMatchObject({ name: 'Mona', value: 20 });
  });
});
