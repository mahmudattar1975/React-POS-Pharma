// Read-only analytics for the Dashboard page.
//
// Everything here is derived from the same records the operational screens already own (posted
// sales, sales returns, purchase invoices/returns, the item and batch master), so the dashboard can
// never drift from the ledger: no figures are stored twice. Purchases and purchase returns are split
// by PurchaseInvoice.isReturn, and sales returns are the separate ReturnHeader list, so a return is
// always its own positive figure instead of a minus row netted into the sale.
import type { SaleHeader, ReturnHeader, PaymentMethod } from '../types/sales';
import type { PurchaseInvoice, Vendor } from '../types/purchasing';
import type { Item, Batch } from '../types/catalog';
import type { Customer } from '../types/customer';
import { round2 } from './vat';
import { tabletsPerBox } from './packUnits';

export interface NamedValue {
  name: string;
  value: number;
  // Secondary caption in the bar row (e.g. "12 invoices", "1,240 units").
  meta?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return `${MONTHS[(month || 1) - 1]} ${String(year).slice(2)}`;
}

// The last `count` month keys ending at `anchor`'s month, oldest first. Pure string arithmetic so
// the dashboard never depends on the machine's clock or time zone for its axis labels.
export function monthsBack(anchor: string, count: number): string[] {
  let year = Number(anchor.slice(0, 4));
  let month = Number(anchor.slice(5, 7));
  const keys: string[] = [];
  for (let i = 0; i < count; i += 1) {
    keys.unshift(`${year}-${String(month).padStart(2, '0')}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return keys;
}

export function periodCutoff(days: number, todayISO: string): string {
  const date = new Date(`${todayISO}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function withinPeriod(iso: string, days: number | null, todayISO: string): boolean {
  if (days === null) return true;
  return iso.slice(0, 10) >= periodCutoff(days, todayISO);
}

// ---------------------------------------------------------------------------------------------
// Sales and sales returns
// ---------------------------------------------------------------------------------------------

const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  insurance: 'Insurance',
  points: 'Loyalty points',
  wasfaty: 'Wasfaty / NUPCO',
  other: 'Other',
};

export interface SalesSummary {
  invoiceCount: number;
  grossSales: number;
  vat: number;
  netExclVat: number;
  avgBasket: number;
  itemsSold: number;
  returnCount: number;
  refunded: number;
  returnedUnits: number;
  returnRate: number; // refunded ÷ gross sales, 0..1
  byPayment: NamedValue[];
  topItems: NamedValue[];
}

export function summariseSales(invoices: SaleHeader[], returns: ReturnHeader[]): SalesSummary {
  const grossSales = round2(invoices.reduce((s, i) => s + i.totalInclVat, 0));
  const vat = round2(invoices.reduce((s, i) => s + i.totalVatAmount, 0));
  const netExclVat = round2(invoices.reduce((s, i) => s + i.subtotalExclVat - i.totalDiscount, 0));
  const refunded = round2(returns.reduce((s, r) => s + r.totalRefund, 0));
  const returnedUnits = round2(returns.reduce((s, r) => s + r.lines.reduce((n, l) => n + l.qty, 0), 0));

  const paymentMap = new Map<PaymentMethod, number>();
  let itemsSold = 0;
  const itemMap = new Map<string, { qty: number; value: number }>();
  for (const inv of invoices) {
    for (const p of inv.payments) {
      paymentMap.set(p.method, (paymentMap.get(p.method) ?? 0) + p.amount);
    }
    for (const line of inv.lines) {
      itemsSold += line.qty;
      const row = itemMap.get(line.itemNameEn) ?? { qty: 0, value: 0 };
      row.qty += line.qty;
      row.value += line.totalInclVat;
      itemMap.set(line.itemNameEn, row);
    }
  }

  return {
    invoiceCount: invoices.length,
    grossSales,
    vat,
    netExclVat,
    avgBasket: invoices.length > 0 ? round2(grossSales / invoices.length) : 0,
    itemsSold: round2(itemsSold),
    returnCount: returns.length,
    refunded,
    returnedUnits,
    returnRate: grossSales > 0 ? Math.min(1, refunded / grossSales) : 0,
    byPayment: [...paymentMap.entries()]
      .map(([method, value]) => ({ name: PAYMENT_LABEL[method], value: round2(value) }))
      .sort((a, b) => b.value - a.value),
    topItems: [...itemMap.entries()]
      .map(([name, row]) => ({ name, value: round2(row.value), meta: `${round2(row.qty)} sold` }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5),
  };
}

// ---------------------------------------------------------------------------------------------
// Purchases and purchase returns
// ---------------------------------------------------------------------------------------------

export interface PurchaseSummary {
  invoiceCount: number;
  purchasesInclVat: number;
  purchasesExclVat: number;
  vat: number;
  paidUnits: number;
  bonusUnits: number;
  returnCount: number;
  returnedUnits: number;
  credit: number;
  returnRate: number; // credit ÷ purchases incl. VAT, 0..1
  topVendors: NamedValue[];
}

export function purchaseKind(invoice: PurchaseInvoice): 'purchase' | 'return' {
  return invoice.isReturn ? 'return' : 'purchase';
}

export function summarisePurchases(invoices: PurchaseInvoice[]): PurchaseSummary {
  const purchases = invoices.filter((i) => purchaseKind(i) === 'purchase');
  const returns = invoices.filter((i) => purchaseKind(i) === 'return');

  const purchasesInclVat = round2(purchases.reduce((s, i) => s + i.totalInclVat, 0));
  const purchasesExclVat = round2(purchases.reduce((s, i) => s + i.netExclVat, 0));
  const vat = round2(purchases.reduce((s, i) => s + i.totalVatAmount, 0));
  const paidUnits = round2(
    purchases.reduce((s, i) => s + i.lines.reduce((n, l) => n + l.qty, 0), 0)
  );
  const bonusUnits = round2(
    purchases.reduce((s, i) => s + i.lines.reduce((n, l) => n + l.bonusQty, 0), 0)
  );
  const credit = round2(returns.reduce((s, i) => s + i.totalInclVat, 0));
  const returnedUnits = round2(
    returns.reduce((s, i) => s + i.lines.reduce((n, l) => n + l.qty + l.bonusQty, 0), 0)
  );

  const vendorMap = new Map<string, { value: number; count: number }>();
  for (const inv of purchases) {
    const row = vendorMap.get(inv.vendorNameEn) ?? { value: 0, count: 0 };
    row.value += inv.totalInclVat;
    row.count += 1;
    vendorMap.set(inv.vendorNameEn, row);
  }

  return {
    invoiceCount: purchases.length,
    purchasesInclVat,
    purchasesExclVat,
    vat,
    paidUnits,
    bonusUnits,
    returnCount: returns.length,
    returnedUnits,
    credit,
    returnRate: purchasesInclVat > 0 ? Math.min(1, credit / purchasesInclVat) : 0,
    topVendors: [...vendorMap.entries()]
      .map(([name, row]) => ({
        name,
        value: round2(row.value),
        meta: `${row.count} invoice${row.count === 1 ? '' : 's'}`,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5),
  };
}

// ---------------------------------------------------------------------------------------------
// Goods on the shelf
// ---------------------------------------------------------------------------------------------

export interface StockRow {
  name: string;
  qty: number;
  reorderLevel: number;
  expiryDate?: string;
  batchNo?: string;
}

export interface StockSummary {
  itemCount: number;
  batchCount: number;
  units: number;
  costValue: number;
  retailValue: number;
  margin: number; // retail - cost, SAR
  lowStock: StockRow[];
  expiring: StockRow[];
  byCategory: NamedValue[];
}

// Stock is counted in tablets for packed items, so quantities are converted back to selling units
// (boxes) before they are compared with a reorder level or shown to the owner.
function sellingUnits(item: Item, qty: number): number {
  return item.pack ? qty / tabletsPerBox(item.pack) : qty;
}

export function summariseStock(items: Item[], batches: Batch[], todayISO: string): StockSummary {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const onHand = new Map<string, { qty: number; cost: number }>();
  const categoryCost = new Map<string, number>();
  let costValue = 0;
  let retailValue = 0;
  let units = 0;
  let activeBatches = 0;
  const expiring: StockRow[] = [];
  const expiryLimit = periodCutoff(-90, todayISO); // 90 days ahead

  for (const batch of batches) {
    if (batch.qtyOnHand <= 0) continue;
    const item = itemById.get(batch.itemId);
    if (!item) continue;
    activeBatches += 1;
    units += sellingUnits(item, batch.qtyOnHand);

    const cost = batch.qtyOnHand * batch.costPrice;
    const salePrice = batch.salePriceOverride ?? item.basePrice;
    const retail = item.pack
      ? (batch.qtyOnHand / tabletsPerBox(item.pack)) * salePrice
      : batch.qtyOnHand * salePrice;
    costValue += cost;
    retailValue += retail;
    categoryCost.set(item.category || 'Uncategorised', (categoryCost.get(item.category || 'Uncategorised') ?? 0) + cost);

    const row = onHand.get(item.id) ?? { qty: 0, cost: 0 };
    row.qty += batch.qtyOnHand;
    row.cost += cost;
    onHand.set(item.id, row);

    if (batch.expiryDate && batch.expiryDate <= expiryLimit) {
      expiring.push({
        name: item.nameEn,
        qty: batch.qtyOnHand,
        reorderLevel: item.reorderLevel,
        expiryDate: batch.expiryDate,
        batchNo: batch.batchNo,
      });
    }
  }

  const lowStock: StockRow[] = [];
  for (const item of items) {
    // A zero reorder level means no threshold has been set, and a discontinued item is not
    // something to chase - neither belongs in a "reorder now" list.
    if (item.isActive === false || item.reorderLevel <= 0) continue;
    const row = onHand.get(item.id);
    const qty = row ? sellingUnits(item, row.qty) : 0;
    if (qty <= item.reorderLevel) {
      lowStock.push({ name: item.nameEn, qty, reorderLevel: item.reorderLevel });
    }
  }
  lowStock.sort((a, b) => a.qty - b.qty);
  expiring.sort((a, b) => (a.expiryDate ?? '').localeCompare(b.expiryDate ?? ''));

  return {
    itemCount: items.length,
    batchCount: activeBatches,
    units: round2(units),
    costValue: round2(costValue),
    retailValue: round2(retailValue),
    margin: round2(retailValue - costValue),
    lowStock: lowStock.slice(0, 8),
    expiring: expiring.slice(0, 8),
    byCategory: [...categoryCost.entries()]
      .map(([name, value]) => ({ name, value: round2(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6),
  };
}

// ---------------------------------------------------------------------------------------------
// Stagnant stock
// ---------------------------------------------------------------------------------------------

export interface StagnantRow {
  itemId: string;
  name: string;
  category: string;
  qtyOnHand: number;
  costValue: number;
  retailValue: number;
  lastSoldDate?: string;
  daysIdle: number | null; // null = never sold on this device
}

export interface StagnantSummary {
  days: number;
  count: number;
  units: number;
  costValue: number;
  retailValue: number;
  rows: StagnantRow[];
}

function daysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(`${fromISO.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toISO.slice(0, 10)}T00:00:00Z`);
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

// An item is stagnant when it still has stock on the shelf but has not sold a single unit for
// `days`. New stock that has never sold counts too - it is money sitting in the store either way.
// Rows are ranked by the cost value tied up, so the biggest dead-stock problem is addressed first.
export function summariseStagnant(
  items: Item[],
  batches: Batch[],
  sales: SaleHeader[],
  days: number,
  todayISO: string
): StagnantSummary {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const stock = new Map<string, { qty: number; cost: number; retail: number }>();

  for (const batch of batches) {
    if (batch.qtyOnHand <= 0) continue;
    const item = itemById.get(batch.itemId);
    if (!item) continue;
    const row = stock.get(item.id) ?? { qty: 0, cost: 0, retail: 0 };
    row.qty += batch.qtyOnHand;
    row.cost += batch.qtyOnHand * batch.costPrice;
    const salePrice = batch.salePriceOverride ?? item.basePrice;
    row.retail += item.pack
      ? (batch.qtyOnHand / tabletsPerBox(item.pack)) * salePrice
      : batch.qtyOnHand * salePrice;
    stock.set(item.id, row);
  }

  // Last sale date per item, across every posted invoice. A line's itemId is stable even after an
  // item is renamed, so history is attributed to the right product.
  const lastSold = new Map<string, string>();
  for (const invoice of sales) {
    const day = invoice.date.slice(0, 10);
    for (const line of invoice.lines) {
      if (!lastSold.has(line.itemId) || day > lastSold.get(line.itemId)!) {
        lastSold.set(line.itemId, day);
      }
    }
  }

  const cutoff = periodCutoff(days, todayISO);
  const rows: StagnantRow[] = [];
  for (const [itemId, row] of stock.entries()) {
    const item = itemById.get(itemId);
    if (!item) continue;
    const sold = lastSold.get(itemId);
    if (sold && sold > cutoff) continue; // sold within the window - not stagnant
    rows.push({
      itemId,
      name: item.nameEn || item.nameAr,
      category: item.category,
      qtyOnHand: round2(item.pack ? row.qty / tabletsPerBox(item.pack) : row.qty),
      costValue: round2(row.cost),
      retailValue: round2(row.retail),
      lastSoldDate: sold,
      daysIdle: sold ? daysBetween(sold, todayISO) : null,
    });
  }

  rows.sort((a, b) => b.costValue - a.costValue);

  return {
    days,
    count: rows.length,
    units: round2(rows.reduce((s, r) => s + r.qtyOnHand, 0)),
    costValue: round2(rows.reduce((s, r) => s + r.costValue, 0)),
    retailValue: round2(rows.reduce((s, r) => s + r.retailValue, 0)),
    rows,
  };
}

// ---------------------------------------------------------------------------------------------
// Vendors and customers
// ---------------------------------------------------------------------------------------------

export interface PartySummary {
  vendorCount: number;
  activeVendorCount: number;
  customerCount: number;
  topVendors: NamedValue[];
  topCustomers: NamedValue[];
  loyaltyPoints: number;
}

export function summariseParties(
  parties: Vendor[],
  customers: Customer[],
  purchases: PurchaseInvoice[],
  sales: SaleHeader[]
): PartySummary {
  const vendors = parties.filter((p) => p.typeFlag !== 2);
  const businessCustomers = parties.filter((p) => p.typeFlag === 2);

  const vendorMap = new Map<string, { value: number; count: number }>();
  for (const inv of purchases) {
    if (inv.isReturn) continue;
    const row = vendorMap.get(inv.vendorNameEn) ?? { value: 0, count: 0 };
    row.value += inv.totalInclVat;
    row.count += 1;
    vendorMap.set(inv.vendorNameEn, row);
  }

  const customerMap = new Map<string, { value: number; count: number }>();
  for (const inv of sales) {
    if (!inv.customerId) continue; // walk-in is not a customer account
    const name = inv.customerNameEn || inv.customerNameAr || 'Unnamed customer';
    const row = customerMap.get(name) ?? { value: 0, count: 0 };
    row.value += inv.totalInclVat;
    row.count += 1;
    customerMap.set(name, row);
  }

  return {
    vendorCount: vendors.length,
    activeVendorCount: vendors.filter((v) => v.isActive !== false).length,
    customerCount: customers.length + businessCustomers.length,
    topVendors: [...vendorMap.entries()]
      .map(([name, row]) => ({
        name,
        value: round2(row.value),
        meta: `${row.count} invoice${row.count === 1 ? '' : 's'}`,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5),
    topCustomers: [...customerMap.entries()]
      .map(([name, row]) => ({
        name,
        value: round2(row.value),
        meta: `${row.count} visit${row.count === 1 ? '' : 's'}`,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5),
    loyaltyPoints: customers.reduce((s, c) => s + c.loyaltyPoints, 0),
  };
}

// ---------------------------------------------------------------------------------------------
// Six-month trend
// ---------------------------------------------------------------------------------------------

export interface TrendPoint {
  key: string;
  label: string;
  sales: number;
  purchases: number;
  salesReturns: number;
  purchaseReturns: number;
}

export function monthlyTrend(
  sales: SaleHeader[],
  salesReturns: ReturnHeader[],
  purchases: PurchaseInvoice[],
  monthCount = 6
): TrendPoint[] {
  const dates = [
    ...sales.map((s) => s.date),
    ...salesReturns.map((r) => r.date),
    ...purchases.map((p) => p.date),
  ]
    .filter(Boolean)
    .sort();
  const anchor = dates.length > 0 ? dates[dates.length - 1] : '1970-01-01';
  const keys = monthsBack(anchor, monthCount);
  const byKey = new Map<string, TrendPoint>(
    keys.map((key) => [key, { key, label: monthLabel(key), sales: 0, purchases: 0, salesReturns: 0, purchaseReturns: 0 }])
  );

  for (const inv of sales) {
    const point = byKey.get(monthKey(inv.date));
    if (point) point.sales += inv.totalInclVat;
  }
  for (const ret of salesReturns) {
    const point = byKey.get(monthKey(ret.date));
    if (point) point.salesReturns += ret.totalRefund;
  }
  for (const inv of purchases) {
    const point = byKey.get(monthKey(inv.date));
    if (!point) continue;
    if (inv.isReturn) point.purchaseReturns += inv.totalInclVat;
    else point.purchases += inv.totalInclVat;
  }

  return keys.map((key) => {
    const point = byKey.get(key)!;
    return {
      ...point,
      sales: round2(point.sales),
      purchases: round2(point.purchases),
      salesReturns: round2(point.salesReturns),
      purchaseReturns: round2(point.purchaseReturns),
    };
  });
}

// Latest activity date in the dataset, used as the trend anchor and never the machine clock.
export function latestActivity(
  sales: SaleHeader[],
  salesReturns: ReturnHeader[],
  purchases: PurchaseInvoice[]
): string {
  const dates = [
    ...sales.map((s) => s.date),
    ...salesReturns.map((r) => r.date),
    ...purchases.map((p) => p.date),
  ]
    .filter(Boolean)
    .sort();
  return dates.length > 0 ? dates[dates.length - 1] : '';
}
