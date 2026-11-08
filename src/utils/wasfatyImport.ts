// Bulk NUPCO item-list import - parsing and matching, no React and no store.
//
// The pharmacy receives NUPCO's approved Wasfaty item list as a spreadsheet/CSV and needs to map
// hundreds of rows onto the local catalogue. Doing that one row at a time in the mapping screen is
// error-prone, so this module turns the pasted/imported text into a REVIEWABLE PLAN:
//
//   - every row is matched to exactly one local item (barcode, GTIN, alias barcode or item number);
//   - a code that is not 13 digits, is duplicated in the file, belongs to another item, or matches
//     more than one local item is an ERROR and blocks the whole import;
//   - a row whose item is simply not stocked by this pharmacy is SKIPPED (the NUPCO list is
//     national, the catalogue is not), not an error;
//   - a row that already has exactly this mapping is UNCHANGED and is not written again.
//
// Nothing here touches NUPCO itself: the list is authoritative only because the pharmacy imported
// it. The store re-validates the whole batch before applying it (catalogStore.applyWasfatyMappings),
// so a caller cannot bypass these rules.
import type { Item } from '../types/catalog';
import { itemNumberOf } from './itemMaster';
import { isValidNupcoCode, normaliseNupcoCode, nupcoCodeOwner } from './wasfaty';

export type WasfatyImportStatus = 'ready' | 'unchanged' | 'skipped' | 'error';

export interface WasfatyMappingUpdate {
  itemId: string;
  nupcoCode: string;
  wasfatyPrice?: number;
  wasfatyEligible: boolean;
}

export interface WasfatyImportRow {
  line: number; // 1-based data row number, so the user can find it in the file
  raw: string; // the original row, shown when a match fails
  nupcoCode: string;
  matchKey: string;
  price?: number;
  eligible: boolean;
  status: WasfatyImportStatus;
  reason?: string;
  itemId?: string;
  itemName?: string;
  itemNo?: number;
}

export interface WasfatyImportPreview {
  rows: WasfatyImportRow[];
  ready: number;
  unchanged: number;
  skipped: number;
  errors: number;
  apply: WasfatyMappingUpdate[];
}

const CODE_HEADERS = [
  'nupco code',
  'nupco item code',
  'nupco code 13 digits',
  'nupco item code 13 digits',
  'nupco',
  'wasfaty code',
  'code',
];

const MATCH_HEADERS = [
  'barcode',
  'bar code',
  'local barcode',
  'gtin',
  'gtin no',
  'item no',
  'item number',
  'item code',
  'local item no',
  'local item code',
  'sku',
];

const PRICE_HEADERS = [
  'price',
  'nupco price',
  'nupco unit price',
  'nupco approved price',
  'approved price',
  'wasfaty price',
  'unit price',
  'price sar',
];

const ELIGIBLE_HEADERS = [
  'eligible',
  'wasfaty eligible',
  'on list',
  'on wasfaty list',
  'wasfaty list',
  'active',
];

const FALSE_VALUES = new Set(['no', 'false', '0', 'n', 'off', 'private', 'not on list', 'لا']);

function normaliseHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normaliseKey(value: string): string {
  return value.replace(/[\s-]/g, '').toLowerCase();
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') i += 1;
      else quoted = !quoted;
    } else if (!quoted && ch === delimiter) {
      count += 1;
    }
  }
  return count;
}

// Comma, tab and semicolon are all accepted. The delimiter is chosen from the first non-empty line,
// which is also how a spreadsheet paste usually arrives.
function detectDelimiter(line: string): string {
  const candidates = [',', '\t', ';'];
  let best = ',';
  let bestCount = 0;
  for (const candidate of candidates) {
    const count = countOutsideQuotes(line, candidate);
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

// Small RFC-4180-style parser: quoted fields, escaped quotes and embedded newlines are supported.
// Blank lines are dropped so a trailing newline does not become an empty error row.
export function parseDelimitedRows(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  const firstLine = clean.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
  const delimiter = detectDelimiter(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  function endRow() {
    row.push(field);
    field = '';
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
    row = [];
  }

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      endRow();
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  endRow();
  return rows;
}

function isHeaderRow(cells: string[]): boolean {
  const known = new Set([...CODE_HEADERS, ...MATCH_HEADERS, ...PRICE_HEADERS, ...ELIGIBLE_HEADERS]);
  return cells.some((cell) => known.has(normaliseHeader(cell)));
}

function findColumn(headers: string[], aliases: string[]): number {
  return headers.findIndex((header) => aliases.includes(header));
}

function parsePrice(value: string): { price?: number; error?: string } {
  const text = value.trim().replace(/,/g, '');
  if (!text) return {};
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { error: 'The NUPCO price must be 0 or more.' };
  }
  return { price: Math.round((parsed + Number.EPSILON) * 100) / 100 };
}

function parseEligible(value: string): boolean {
  const text = value.trim().toLowerCase();
  if (!text) return true;
  return !FALSE_VALUES.has(text);
}

// Every way the pharmacy's own catalogue can identify an item. The NUPCO list is national, so the
// local match key is whatever the supplier's file carries: a barcode/GTIN in the normal case, the
// item number when the file is an internal export.
function itemKeys(item: Item): string[] {
  const keys = [item.barcode, ...(item.barcodes ?? []), item.gtin ?? '']
    .map(normaliseKey)
    .filter(Boolean);
  const number = itemNumberOf(item);
  if (number !== undefined) keys.push(normaliseKey(String(number)));
  return Array.from(new Set(keys));
}

function buildIndex(items: Item[]): Map<string, Item[]> {
  const index = new Map<string, Item[]>();
  for (const item of items) {
    for (const key of itemKeys(item)) {
      const bucket = index.get(key);
      if (bucket) bucket.push(item);
      else index.set(key, [item]);
    }
  }
  return index;
}

function isUnchanged(item: Item, code: string, price: number | undefined, eligible: boolean): boolean {
  const currentCode = normaliseNupcoCode(item.nupcoCode ?? '');
  const currentEligible = item.wasfatyEligible === true || currentCode !== '';
  return currentCode === code && (item.wasfatyPrice ?? undefined) === price && currentEligible === eligible;
}

export function planWasfatyImport(text: string, items: Item[]): WasfatyImportPreview {
  const preview: WasfatyImportPreview = {
    rows: [],
    ready: 0,
    unchanged: 0,
    skipped: 0,
    errors: 0,
    apply: [],
  };
  const table = parseDelimitedRows(text);
  if (table.length === 0) return preview;

  const hasHeader = isHeaderRow(table[0]);
  const headers = hasHeader ? table[0].map(normaliseHeader) : [];

  const firstRowWidth = table[0].length;
  let codeCol = hasHeader ? findColumn(headers, CODE_HEADERS) : 0;
  let matchCol = hasHeader ? findColumn(headers, MATCH_HEADERS) : firstRowWidth > 1 ? 1 : -1;
  const priceCol = hasHeader ? findColumn(headers, PRICE_HEADERS) : firstRowWidth > 2 ? 2 : -1;
  const eligibleCol = hasHeader ? findColumn(headers, ELIGIBLE_HEADERS) : firstRowWidth > 3 ? 3 : -1;

  // A one-column paste (or a file with only a barcode column) is treated as "the code is the
  // barcode", which is the common case for NUPCO's GTIN-shaped codes.
  if (hasHeader && codeCol < 0) codeCol = matchCol;

  const index = buildIndex(items);
  const seenCodes = new Map<string, number>();
  const seenItems = new Map<string, number>();
  const dataRows = hasHeader ? table.slice(1) : table;

  dataRows.forEach((cells, offset) => {
    const line = offset + 1;
    const codeCell = codeCol >= 0 ? cells[codeCol] ?? '' : '';
    const matchCell = matchCol >= 0 ? cells[matchCol] ?? '' : '';
    const priceCell = priceCol >= 0 ? cells[priceCol] ?? '' : '';
    const eligibleCell = eligibleCol >= 0 ? cells[eligibleCol] ?? '' : '';
    const nupcoCode = normaliseNupcoCode(codeCell);
    const matchKey = normaliseKey(matchCell || nupcoCode);
    const eligible = parseEligible(eligibleCell);
    const { price, error: priceError } = parsePrice(priceCell);

    const row: WasfatyImportRow = {
      line,
      raw: cells.join(' | ').trim(),
      nupcoCode,
      matchKey,
      price,
      eligible,
      status: 'ready',
    };

    if (!nupcoCode) {
      row.status = 'error';
      row.reason = 'Missing NUPCO code.';
    } else if (!isValidNupcoCode(nupcoCode)) {
      row.status = 'error';
      row.reason = 'A NUPCO code is 13 digits.';
    } else if (seenCodes.has(nupcoCode)) {
      row.status = 'error';
      row.reason = `Duplicate of line ${seenCodes.get(nupcoCode)}.`;
    } else if (priceError) {
      row.status = 'error';
      row.reason = priceError;
    } else if (!eligible) {
      row.status = 'error';
      row.reason = 'A mapped NUPCO code must be marked as eligible.';
    } else {
      seenCodes.set(nupcoCode, line);

      let candidates = matchKey ? index.get(matchKey) ?? [] : [];
      // Fall back to the code itself as the barcode when the supplier's barcode column does not
      // match but the NUPCO code is the GTIN the pharmacy scans.
      if (candidates.length === 0 && matchCell && nupcoCode !== matchKey) {
        candidates = index.get(nupcoCode) ?? [];
      }

      if (candidates.length === 0) {
        row.status = 'skipped';
        row.reason = matchCell
          ? `No local item matches ${matchCell.trim()} or ${nupcoCode}.`
          : `No local item matches ${nupcoCode}.`;
      } else if (candidates.length > 1) {
        row.status = 'error';
        row.reason = 'Matches more than one local item.';
      } else {
        const item = candidates[0];
        row.itemId = item.id;
        row.itemName = item.nameEn;
        row.itemNo = itemNumberOf(item);

        if (seenItems.has(item.id)) {
          row.status = 'error';
          row.reason = `${item.nameEn} already appears on line ${seenItems.get(item.id)}.`;
        } else {
          seenItems.set(item.id, line);
          const owner = nupcoCodeOwner(items, nupcoCode, item.id);
          if (owner) {
            row.status = 'error';
            row.reason = `Already mapped to ${owner.nameEn}.`;
          } else if (isUnchanged(item, nupcoCode, price, eligible)) {
            row.status = 'unchanged';
            row.reason = 'Already mapped this way.';
          } else {
            preview.apply.push({ itemId: item.id, nupcoCode, wasfatyPrice: price, wasfatyEligible: eligible });
          }
        }
      }
    }

    if (row.status === 'ready') preview.ready += 1;
    else if (row.status === 'unchanged') preview.unchanged += 1;
    else if (row.status === 'skipped') preview.skipped += 1;
    else preview.errors += 1;

    preview.rows.push(row);
  });

  return preview;
}

// The column names the dialog advertises. Kept next to the parser so the help text cannot drift.
export const WASFATY_IMPORT_COLUMNS = [
  'nupco_code',
  'barcode',
  'price',
  'eligible',
] as const;
