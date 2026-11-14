// One display standard for every figure in the app: thousands separated, and a fixed two decimals
// for money (SAR 55,520.52). Quantities keep whole numbers clean (10) but show up to two decimals
// when a packed item is fractional (10.5, 10.25).
const MONEY = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const QTY = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
// Unit purchase/cost prices stay at the legacy three decimals; the formatter only adds the
// thousands separators so a large price never reads as an unbroken run of digits.
const UNIT_PRICE = new Intl.NumberFormat('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

function safe(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function formatMoney(value: number | null | undefined): string {
  return MONEY.format(safe(value));
}

export function formatSar(value: number | null | undefined): string {
  return `SAR ${formatMoney(value)}`;
}

export function formatQty(value: number | null | undefined): string {
  return QTY.format(safe(value));
}

export function formatUnitPrice(value: number | null | undefined): string {
  return UNIT_PRICE.format(safe(value));
}
