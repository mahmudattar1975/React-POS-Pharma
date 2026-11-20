// Minimal GS1 Application Identifier parser for pharmaceutical DataMatrix/QR scans (SFDA/GS1
// drug track-and-trace). Not a complete GS1 implementation - covers the AIs that matter for a
// pharmacy register: GTIN, batch/lot, expiry, serial. Fixed-length AIs are read by position;
// variable-length AIs are read up to the next GS separator (ASCII 29, \x1D) or end of string.
const FIXED_LENGTH_AIS: Record<string, number> = {
  '01': 14, // GTIN
  '11': 6, // production date, YYMMDD
  '17': 6, // expiry date, YYMMDD
  '15': 6, // best-before date, YYMMDD
};

const VARIABLE_LENGTH_AIS = new Set(['10', '21', '240', '30']); // 10=batch/lot, 21=serial

export interface ParsedGs1 {
  gtin?: string;
  batchNo?: string;
  expiryDate?: string; // ISO yyyy-mm-dd
  serialNo?: string;
}

function yymmddToIso(yymmdd: string): string {
  const yy = Number(yymmdd.slice(0, 2));
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  // GS1 pivots two-digit years at 51: 00-50 -> 2000-2050, 51-99 -> 1951-1999. Pharma expiry dates
  // are always in the future, so this window is generous enough without needing a real pivot config.
  const yyyy = yy <= 50 ? 2000 + yy : 1900 + yy;
  return `${yyyy}-${mm}-${dd}`;
}

// Heuristic mirrored from the legacy PowerBuilder screen: a GS1 payload is recognized by being
// longer than a plain barcode and starting with a 14-digit numeric GTIN under AI (01).
export function looksLikeGs1(scan: string): boolean {
  return scan.length > 16 && /^\d{14}/.test(scan);
}

export function parseGs1(scan: string): ParsedGs1 {
  const GS = '\x1d';
  const result: ParsedGs1 = {};
  let s = scan.startsWith('01') ? scan : `01${scan}`; // tolerate scanners that strip the leading AI
  let i = 0;

  while (i < s.length) {
    const remaining = s.slice(i);
    const ai2 = remaining.slice(0, 2);
    const ai3 = remaining.slice(0, 3);

    if (ai2 in FIXED_LENGTH_AIS) {
      const len = FIXED_LENGTH_AIS[ai2];
      const value = remaining.slice(2, 2 + len);
      if (ai2 === '01') result.gtin = value;
      if (ai2 === '17' || ai2 === '15') result.expiryDate = yymmddToIso(value);
      i += 2 + len;
      continue;
    }

    const variableAi = VARIABLE_LENGTH_AIS.has(ai2) ? ai2 : VARIABLE_LENGTH_AIS.has(ai3) ? ai3 : null;
    if (variableAi) {
      const rest = remaining.slice(variableAi.length);
      const gsIndex = rest.indexOf(GS);
      const value = gsIndex === -1 ? rest : rest.slice(0, gsIndex);
      if (variableAi === '10') result.batchNo = value;
      if (variableAi === '21') result.serialNo = value;
      i += variableAi.length + value.length + (gsIndex === -1 ? 0 : 1);
      continue;
    }

    // Unrecognized AI - stop parsing rather than risk misreading the rest of the payload.
    break;
  }

  return result;
}

// The 14-digit GTIN exactly as GS1 prints it under AI (01). A GTIN-13 (the code most Saudi
// medicine cartons carry as a plain barcode) is the same number with one leading zero, and a
// GTIN-12 with two - so padding is normalisation, not a change of identity.
export function normalizeGtin(code: string | null | undefined): string | null {
  const digits = (code ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length > 14) return null;
  return digits.padStart(14, '0');
}

// Lookup candidates for a scanned GTIN: the printed 14-digit form first, then the unpadded code
// the item master usually stores (6281007320014 is 13 digits, not 06281007320014). Without this a
// real DataMatrix scan would miss every locally-stored item whose barcode is GTIN-13.
export function gtinCandidates(gtin: string): string[] {
  const digits = gtin.replace(/\D/g, '');
  if (!digits) return [];
  const candidates = [digits];
  const unpadded = digits.replace(/^0+/, '');
  if (unpadded && unpadded !== digits && unpadded.length >= 8) candidates.push(unpadded);
  return candidates;
}

// A serial number is unique per GTIN, not globally - the same SN string may legitimately exist on
// two different products. Used for basket/history duplicate checks.
export function serialKey(gtin: string, serialNo: string): string {
  return `${gtin}\u0000${serialNo}`;
}

