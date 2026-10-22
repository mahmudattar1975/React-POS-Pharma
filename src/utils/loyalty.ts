import type { CustomerTier } from '../types/customer';

// Loyalty points scheme, modeled on STC's real Qitaf program rather than a flat rate: points
// accrue per complete SAR_PER_THRESHOLD spent (not continuously per riyal), and the amount per
// threshold scales by customer tier - Qitaf's own Classic/Platinum/Diamond tiers earn 1x/1.5x/2x
// per 15 SAR. Redemption stays a flat SAR-per-point rate, kept low enough that the program never
// pays out more than it takes in (see pointsToSar).
export const SAR_PER_THRESHOLD = 15;
export const POINTS_PER_THRESHOLD = 150; // normal tier's points per complete 15 SAR - same effective rate as the old flat 10 pts/SAR
export const SAR_PER_POINT_REDEEMED = 0.0025;

export const TIER_EARN_MULTIPLIER: Record<CustomerTier, number> = {
  normal: 1,
  special: 1.5,
  vip: 2,
};

// Only whole SAR_PER_THRESHOLD increments earn anything - a sale of SAR 29 earns the same as
// SAR 15, and SAR 14.99 earns nothing, exactly like Qitaf's own threshold behavior (never rounds
// in the customer's favor for a partial threshold).
export function pointsEarnedFor(amountInclVat: number, tier: CustomerTier): number {
  const thresholdsReached = Math.floor(amountInclVat / SAR_PER_THRESHOLD);
  return Math.round(thresholdsReached * POINTS_PER_THRESHOLD * TIER_EARN_MULTIPLIER[tier]);
}

export function pointsToSar(points: number): number {
  return points * SAR_PER_POINT_REDEEMED;
}

// Inverse of pointsToSar, for converting an SAR amount entered at the till back into the points
// it consumes - rounded up so a partial-point remainder is never given away for free.
export function sarToPoints(sar: number): number {
  return Math.ceil(sar / SAR_PER_POINT_REDEEMED);
}
