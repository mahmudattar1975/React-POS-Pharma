import type { Batch } from '../types/catalog';

// First-Expired-First-Out: the standard pharmacy stock rule. Batches with stock, soonest expiry first.
export function fefoSort(batches: Batch[]): Batch[] {
  return batches
    .filter((b) => b.qtyOnHand > 0)
    .slice()
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
}

const NEAR_EXPIRY_DAYS = 60;

export function daysUntil(isoDate: string): number {
  const ms = new Date(isoDate).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export function isNearExpiry(isoDate: string): boolean {
  const d = daysUntil(isoDate);
  return d >= 0 && d <= NEAR_EXPIRY_DAYS;
}

export function isExpired(isoDate: string): boolean {
  return daysUntil(isoDate) < 0;
}
