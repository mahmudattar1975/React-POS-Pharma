import type { Batch } from '../types/catalog';

// First-Expired-First-Out: the standard pharmacy stock rule. Batches with stock, soonest expiry first.
// Items that do not carry an expiry date (expiryDate === null) sort last: they can never expire, so
// they should only be reached once every dated batch has been used up.
export function fefoSort(batches: Batch[]): Batch[] {
  return batches
    .filter((b) => b.qtyOnHand > 0)
    .slice()
    .sort((a, b) => {
      if (a.expiryDate === null && b.expiryDate === null) return 0;
      if (a.expiryDate === null) return 1;
      if (b.expiryDate === null) return -1;
      return a.expiryDate.localeCompare(b.expiryDate);
    });
}

const NEAR_EXPIRY_DAYS = 60;

// null = no expiry date at all. Callers that need a number get Infinity so "days until expiry"
// reads as "never" rather than as an epoch date (the old 1900-01-01 workaround).
export function daysUntil(isoDate: string | null): number {
  if (isoDate === null) return Number.POSITIVE_INFINITY;
  const ms = new Date(isoDate).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export function isNearExpiry(isoDate: string | null): boolean {
  if (isoDate === null) return false;
  const d = daysUntil(isoDate);
  return d >= 0 && d <= NEAR_EXPIRY_DAYS;
}

export function isExpired(isoDate: string | null): boolean {
  if (isoDate === null) return false;
  return daysUntil(isoDate) < 0;
}
