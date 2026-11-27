// Shared request-boundary validation for the best-effort SQL mirrors. The browser stays the
// primary record for POS actions; these checks stop a malformed or hostile mirror request from
// corrupting the SQL stock/financial copy. They deliberately mirror the app's own money math
// (src/utils/vat.ts: round2 on customer-facing amounts) rather than inventing new rules.

export class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'RequestError';
  }
}

export function badRequest(message: string): RequestError {
  return new RequestError(400, message);
}

export function conflict(message: string): RequestError {
  return new RequestError(409, message);
}

export function object(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('A JSON object body is required.');
  return body as Record<string, unknown>;
}

export function text(value: unknown, name: string, max = 100, required = true): string {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`${name} is required.`);
    return '';
  }
  if (typeof value !== 'string') throw badRequest(`${name} must be a string.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw badRequest(`${name} is required.`);
  if (trimmed.length > max) throw badRequest(`${name} must be at most ${max} characters.`);
  return trimmed;
}

export function integer(value: unknown, name: string, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw badRequest(`${name} must be an integer between ${min} and ${max}.`);
  }
  return n;
}

export function money(value: unknown, name: string, max = 1_000_000_000): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > max) {
    throw badRequest(`${name} must be a finite non-negative number.`);
  }
  return n;
}

export function rate(value: unknown, name: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw badRequest(`${name} must be a fraction between 0 and 1.`);
  }
  return n;
}

export function date(value: unknown, name: string): Date {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`${name} must be an ISO date.`);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest(`${name} must be a valid ISO date.`);
  return d;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Money crosses the wire as JSON floats. 0.02 accepts the app's own round2 on a long line while
// still rejecting fabricated totals (a one-halala difference is never a rounding artefact).
export function near(actual: number, expected: number, tolerance = 0.02): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

export function oneOf(value: unknown, name: string, allowed: readonly string[]): string {
  const v = text(value, name);
  if (!allowed.includes(v)) throw badRequest(`${name} is not a supported value.`);
  return v;
}
