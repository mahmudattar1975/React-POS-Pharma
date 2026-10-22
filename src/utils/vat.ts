// All prices in this app are stored VAT-exclusive; VAT is calculated and added on top per line,
// matching the legacy pharmacy screen's own convention (net_sales_amount = price + price*vat_percent).
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// For cost/purchase pricing only, which needs sub-halala precision to match the real ERP's own
// data (e.g. net_pur_price: 2.402 on a bulk purchase) - everything customer-facing (VAT, totals,
// receipts) stays on round2, standard 2-decimal SAR formatting.
export function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

export function lineVat(netExclVat: number, vatRate: number): number {
  return round2(netExclVat * vatRate);
}

export function lineTotalInclVat(netExclVat: number, vatRate: number): number {
  return round2(netExclVat + lineVat(netExclVat, vatRate));
}

export interface VatBucket {
  rate: number;
  taxableAmount: number;
  vatAmount: number;
}

// Groups any set of priced lines (cart lines while shopping, or a saved invoice's lines on the
// receipt) by their VAT rate. A pharmacy invoice routinely mixes 0% (medicines) and 0.15 (other
// retail) lines, so this is what both the live cart totals and the printed receipt should show
// instead of a single flat "VAT (15%)" figure - see types/catalog.ts's note on Item.vatRate.
export function groupVatByRate<T extends { vatRate: number; vatAmount: number; netExclVat: number }>(lines: T[]): VatBucket[] {
  const byRate = new Map<number, VatBucket>();
  for (const l of lines) {
    const bucket = byRate.get(l.vatRate) ?? { rate: l.vatRate, taxableAmount: 0, vatAmount: 0 };
    bucket.taxableAmount = round2(bucket.taxableAmount + l.netExclVat);
    bucket.vatAmount = round2(bucket.vatAmount + l.vatAmount);
    byRate.set(l.vatRate, bucket);
  }
  return Array.from(byRate.values()).sort((a, b) => b.rate - a.rate);
}
