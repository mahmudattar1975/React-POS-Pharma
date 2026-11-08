// Pure numbering helpers for the manufacturer / company master. Kept out of the store so the
// "اخر رقم" (last number) rule is unit-tested directly: a company number is an integer >= 1, the
// form previews the next free one, and the master refuses to hand out a number already in use.
import type { Manufacturer } from '../types/manufacturer';

// Company numbers are plain integers in the legacy company-data screen, not prefixed codes, so
// they read the same on a printed list and in Item.manufacturerNo.
export function formatCompanyNo(n: number): string {
  return String(n);
}

// Highest number currently in use (0 when the master is empty). Malformed/legacy values are
// ignored rather than throwing, so one bad row can never stop the next company being numbered.
export function maxCompanyNumber(companies: Pick<Manufacturer, 'companyNo'>[]): number {
  let max = 0;
  for (const company of companies) {
    const n = Number(company.companyNo);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max;
}

// The number the NEXT saved company gets (shown read-only on the form; addManufacturer assigns it).
export function nextCompanyNumber(companies: Pick<Manufacturer, 'companyNo'>[]): number {
  return maxCompanyNumber(companies) + 1;
}

// True when another company already owns this number. Used both as-you-type on the form and as a
// final guard before saving, so two companies can never answer to the same number.
export function isCompanyNoTaken(
  companies: Pick<Manufacturer, 'id' | 'companyNo'>[],
  companyNo: number,
  editingId?: string
): boolean {
  return companies.some((c) => c.id !== editingId && Number(c.companyNo) === companyNo);
}

// One-line label used by pickers: number first so items stay readable even when two companies share
// a similar short name.
export function manufacturerLabel(company: Pick<Manufacturer, 'companyNo' | 'nameEn'>): string {
  return `${company.companyNo} — ${company.nameEn}`;
}

// The name to show on the item master row: the current master name when the stored number still
// resolves, otherwise the raw stored value (a legacy number typed before this master existed).
export function manufacturerDisplayName(
  companies: Pick<Manufacturer, 'companyNo' | 'nameEn'>[],
  companyNo: string | undefined
): string | undefined {
  if (!companyNo) return undefined;
  return companies.find((c) => String(c.companyNo) === companyNo)?.nameEn ?? companyNo;
}
