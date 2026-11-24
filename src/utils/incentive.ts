import type { IncentiveItem, IncentiveCalcInput } from '../types/incentive';

// Round to 2 decimals (SAR) — matches the rest of the app's money helpers.
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Pure: given an active incentive rule (or null) and the line's net amount, return the incentive
// amount granted. No side effects — easy to unit test. Mirrors legacy mode 11 (read_bonuc_disc_rate_sal):
//   type 1 (percent)  -> rate * netExclVat
//   type 2 (amount)   -> rate * qty
// Returns 0 when no rule, inactive, or outside validity window.
export function computeLineIncentive(input: IncentiveCalcInput): number {
  const { incentiveItem, qty, netExclVat } = input;
  if (!incentiveItem || !incentiveItem.active) return 0;
  const today = (input.today ?? new Date().toISOString().slice(0, 10));
  if (today < incentiveItem.activeFrom || today > incentiveItem.activeTo) return 0;
  if (incentiveItem.incentiveType === 'percent') {
    return round2(netExclVat * incentiveItem.rate);
  }
  return round2(qty * incentiveItem.rate);
}

// Sum of incentives across a set of computed line amounts.
export function sumIncentives(amounts: number[]): number {
  return round2(amounts.reduce((s, a) => s + a, 0));
}

// Find the active incentive rule for an item on a given date from a list of rules.
// If multiple rules overlap, the most recently added (last in list) wins — matches legacy
// read_bonuc_disc_rate_sal which returns the last matching row.
export function findActiveIncentive(
  rules: IncentiveItem[],
  itemId: string,
  date: string = new Date().toISOString().slice(0, 10),
): IncentiveItem | null {
  const candidates = rules.filter(
    (r) => r.itemId === itemId && r.active && r.activeFrom <= date && r.activeTo >= date,
  );
  return candidates.length ? candidates[candidates.length - 1] : null;
}
