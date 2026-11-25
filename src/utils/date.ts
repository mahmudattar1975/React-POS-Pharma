// Invoice and batch dates are stored as ISO `YYYY-MM-DD` strings. A typed date input normally
// enforces that, but imported/edited records and keyboard entry can still leave a malformed year
// behind, so every date that reaches a purchase invoice is checked here as well.
export const ISO_DATE_BOUNDS = { min: '2000-01-01', max: '2100-12-31' } as const;

const ISO_DATE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day &&
    value >= ISO_DATE_BOUNDS.min &&
    value <= ISO_DATE_BOUNDS.max
  );
}
