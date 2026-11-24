// Prescription rules: validity, refills, partial fills and the checkout gate.
//
// Pure functions only - no store, no React - so every rule the POS enforces is unit-tested. The
// quantity model is cumulative and deliberately simple:
//
//   authorised = quantityPrescribed × (1 + refillsAuthorized)
//   remaining  = authorised − quantityDispensed
//
// A 30-tablet prescription with 2 refills therefore authorises 90 tablets. Dispensing 10 then 20
// leaves 60 and still counts as one fill in progress; the third fill of 30 is allowed, a fourth is
// refused because the authorised total is used up. Refills left is derived from the same numbers,
// so it can never drift out of sync with the dispensed quantity.
import type {
  DispenseEvent,
  Prescription,
  PrescriptionLine,
  PrescriptionStatus,
} from '../types/prescriptions';

export const DEFAULT_VALIDITY_DAYS = 30;
// Wasfaty's own cap: up to 2 refills, 90 days of treatment in total (represcription.md §3.1).
export const MAX_SUPPLY_DAYS = 90;
// A refill requested before this share of the previous fill's supply has elapsed is flagged as an
// early refill. Soft warning only - pharmacies legitimately dispense early on clinical grounds.
export const EARLY_REFILL_RATIO = 0.75;
const EPSILON = 1e-6;

function roundQty(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function todayIso(now: Date = new Date()): string {
  return toIsoDate(now);
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

export function expiryFor(issuedDate: string, validityDays: number = DEFAULT_VALIDITY_DAYS): string {
  return addDays(issuedDate, validityDays);
}

// Whole days from `fromIso` to `toIso`, positive when `toIso` is later. Date-only strings are
// compared in UTC so a daylight-saving shift cannot turn 30 days into 29.
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

export function lineTotalAuthorised(line: PrescriptionLine): number {
  return roundQty(line.quantityPrescribed * (1 + line.refillsAuthorized));
}

export function lineRemaining(line: PrescriptionLine): number {
  return roundQty(Math.max(0, lineTotalAuthorised(line) - line.quantityDispensed));
}

// How many *complete* extra fills have been used. A partial first fill is not a used refill.
export function refillsUsed(line: PrescriptionLine): number {
  if (line.quantityPrescribed <= 0) return 0;
  const completedFills = Math.ceil((line.quantityDispensed - EPSILON) / line.quantityPrescribed);
  return Math.max(0, Math.min(line.refillsAuthorized, completedFills - 1));
}

export function refillsLeft(line: PrescriptionLine): number {
  return Math.max(0, line.refillsAuthorized - refillsUsed(line));
}

export function prescriptionRemaining(rx: Prescription): number {
  return roundQty(rx.lines.reduce((sum, line) => sum + lineRemaining(line), 0));
}

export function isExpired(rx: Prescription, today: string = todayIso()): boolean {
  return daysBetween(rx.expiryDate, today) > 0;
}

// Precedence matters for the badge and the gate: an explicit cancellation or block always wins,
// then "nothing left to give", then expiry, then a fill in progress.
export function statusFor(rx: Pick<Prescription, 'lines' | 'expiryDate'>, today: string = todayIso()): PrescriptionStatus {
  const anyRemaining = rx.lines.some((line) => lineRemaining(line) > EPSILON);
  const anyDispensed = rx.lines.some((line) => line.quantityDispensed > EPSILON);
  if (!anyRemaining) return 'dispensed';
  if (daysBetween(rx.expiryDate, today) > 0) return 'expired';
  return anyDispensed ? 'partially_dispensed' : 'active';
}

export function withStatus(rx: Prescription, today: string = todayIso()): Prescription {
  if (rx.status === 'cancelled' || rx.status === 'blocked') return rx;
  const status = statusFor(rx, today);
  return status === rx.status ? rx : { ...rx, status };
}

export function totalSupplyDays(line: PrescriptionLine): number | undefined {
  const days = lineDurationDays(line);
  if (!days) return undefined;
  return days * (1 + line.refillsAuthorized);
}

// Soft checks shown while capturing a prescription. None of these block the capture: they are the
// pharmacist's decision to document, which is also why they are warnings rather than errors.
export function supplyWarnings(lines: PrescriptionLine[]): string[] {
  const warnings: string[] = [];
  lines.forEach((line) => {
    const days = totalSupplyDays(line);
    if (days !== undefined && days > MAX_SUPPLY_DAYS) {
      warnings.push(
        `${line.itemNameEn}: ${days} days of treatment exceeds Wasfaty's ${MAX_SUPPLY_DAYS}-day cap.`,
      );
    }
    if (line.refillsAuthorized > 2) {
      warnings.push(`${line.itemNameEn}: more than 2 refills — Wasfaty authorises at most 2.`);
    }
    if (line.quantityPrescribed <= 0) {
      warnings.push(`${line.itemNameEn}: the prescribed quantity must be greater than zero.`);
    }
  });
  return warnings;
}

export function lastDispenseFor(rx: Prescription, lineId: string): DispenseEvent | undefined {
  return [...rx.dispenseEvents]
    .reverse()
    .find((event) => event.lines.some((line) => line.prescriptionLineId === lineId));
}

// How long one fill is meant to last. New captures keep the course inside the dosage snapshot
// (alongside the directions the label prints); the flat field is the legacy/manual path.
export function lineDurationDays(line: PrescriptionLine): number | undefined {
  return line.dosage?.durationDays ?? line.durationDays;
}

// True when the dispensed quantity sits exactly on a fill boundary (30 of 30, 60 of 30…) and more
// authorised quantity remains - i.e. the next dispense opens a refill rather than continuing the
// current fill.
export function startsNewFill(line: PrescriptionLine): boolean {
  if (line.quantityPrescribed <= 0 || line.quantityDispensed <= EPSILON) return false;
  const fills = line.quantityDispensed / line.quantityPrescribed;
  const whole = Math.round(fills);
  return whole >= 1 && Math.abs(fills - whole) < 1e-6 && lineRemaining(line) > EPSILON;
}

export function earlyRefillWarning(
  rx: Prescription,
  line: PrescriptionLine,
  today: string = todayIso(),
): string | undefined {
  // The warning only applies when this request opens a refill; completing the current fill first
  // is normal and never "early".
  if (!startsNewFill(line)) return undefined;
  const last = lastDispenseFor(rx, line.id);
  if (!last) return undefined;
  const supplyDays = lineDurationDays(line) ?? DEFAULT_VALIDITY_DAYS;
  const elapsed = daysBetween(last.dispensedAt.slice(0, 10), today);
  if (elapsed >= supplyDays * EARLY_REFILL_RATIO) return undefined;
  return `${line.itemNameEn}: refill after ${elapsed} day(s); the previous fill should cover ${Math.round(
    supplyDays * EARLY_REFILL_RATIO,
  )} days before a refill is due.`;
}

export interface DispenseRequest {
  prescriptionLineId: string;
  qty: number; // in the line's selling unit
}

export interface DispensePlanLine {
  prescriptionLineId: string;
  itemId: string;
  requested: number;
  remainingBefore: number;
  remainingAfter: number;
  startsNewFill: boolean;
}

export interface DispensePlan {
  ok: boolean;
  errors: string[];
  warnings: string[];
  lines: DispensePlanLine[];
  // The status the prescription will have once this dispense is applied.
  nextStatus: PrescriptionStatus;
}

export interface DispenseOptions {
  today?: string;
  // Set when the pharmacist knowingly dispenses an expired/blocked prescription. Any non-empty
  // reason allows it through; the reason is stored on the DispenseEvent for the audit trail.
  overrideReason?: string;
}

function isBlockedStatus(status: PrescriptionStatus): boolean {
  return status === 'expired' || status === 'blocked' || status === 'cancelled';
}

export function planDispense(
  rx: Prescription,
  requests: DispenseRequest[],
  options: DispenseOptions = {},
): DispensePlan {
  const today = options.today ?? todayIso();
  const overrideReason = options.overrideReason?.trim();
  const errors: string[] = [];
  const warnings: string[] = [];
  const status = rx.status === 'cancelled' || rx.status === 'blocked' ? rx.status : statusFor(rx, today);

  if (requests.length === 0) {
    return { ok: false, errors: ['Nothing to dispense — the cart has no line on this prescription.'], warnings, lines: [], nextStatus: status };
  }

  if (status === 'dispensed') {
    errors.push('This prescription is fully dispensed; no quantity remains.');
  }
  if (status === 'cancelled') {
    errors.push('This prescription was cancelled and cannot be dispensed.');
  }
  if (status === 'expired' || status === 'blocked') {
    if (!overrideReason) {
      errors.push(
        status === 'expired'
          ? `This prescription expired on ${rx.expiryDate}. Record an override reason to dispense anyway.`
          : 'This prescription is blocked. Record an override reason to dispense anyway.',
      );
    } else {
      warnings.push(`Dispensing ${status} prescription — override recorded: ${overrideReason}.`);
    }
  }

  const planned: DispensePlanLine[] = [];
  requests.forEach((request) => {
    const line = rx.lines.find((candidate) => candidate.id === request.prescriptionLineId);
    if (!line) {
      errors.push('A cart line refers to a prescription line that no longer exists.');
      return;
    }
    const qty = roundQty(request.qty);
    const remainingBefore = lineRemaining(line);
    if (qty <= 0) {
      errors.push(`${line.itemNameEn}: the dispensed quantity must be greater than zero.`);
      return;
    }
    if (qty > remainingBefore + EPSILON) {
      errors.push(
        `${line.itemNameEn}: only ${remainingBefore} ${line.unit}(s) remain on this prescription, but the cart has ${qty}.`,
      );
      return;
    }
    const startsNew = startsNewFill(line);
    const early = startsNew ? earlyRefillWarning(rx, line, today) : undefined;
    if (early) warnings.push(early);
    planned.push({
      prescriptionLineId: line.id,
      itemId: line.itemId,
      requested: qty,
      remainingBefore,
      remainingAfter: roundQty(remainingBefore - qty),
      startsNewFill: startsNew,
    });
  });

  const linesByLineId = new Map(planned.map((line) => [line.prescriptionLineId, line]));
  const nextLines = rx.lines.map((line) => {
    const plannedLine = linesByLineId.get(line.id);
    return plannedLine
      ? { ...line, quantityDispensed: roundQty(line.quantityDispensed + plannedLine.requested) }
      : line;
  });
  const nextStatus = isBlockedStatus(status) && !overrideReason
    ? status
    : statusFor({ lines: nextLines, expiryDate: rx.expiryDate }, today);

  return { ok: errors.length === 0, errors, warnings, lines: planned, nextStatus };
}

export function applyDispense(rx: Prescription, event: DispenseEvent, today: string = todayIso()): Prescription {
  const qtyByLine = new Map(event.lines.map((line) => [line.prescriptionLineId, line.qty]));
  const lines = rx.lines.map((line) => {
    const qty = qtyByLine.get(line.id);
    return qty
      ? { ...line, quantityDispensed: roundQty(line.quantityDispensed + qty) }
      : line;
  });
  const status = rx.status === 'cancelled' || rx.status === 'blocked'
    ? rx.status
    : statusFor({ lines, expiryDate: rx.expiryDate }, today);
  return {
    ...rx,
    lines,
    status,
    dispenseEvents: [...rx.dispenseEvents, event],
  };
}

export interface PrescriptionSummary {
  lineCount: number;
  remaining: number;
  refillsLeft: number;
  fills: number;
  lastDispensedAt?: string;
}

export function prescriptionSummary(rx: Prescription): PrescriptionSummary {
  return {
    lineCount: rx.lines.length,
    remaining: prescriptionRemaining(rx),
    refillsLeft: rx.lines.reduce((sum, line) => sum + refillsLeft(line), 0),
    fills: rx.dispenseEvents.length,
    lastDispensedAt: rx.dispenseEvents[rx.dispenseEvents.length - 1]?.dispensedAt,
  };
}
