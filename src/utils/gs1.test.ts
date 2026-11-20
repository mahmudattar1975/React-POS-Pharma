// GS1 parsing is the entry point for RSD's unit identity: if the serial or batch is misread here,
// the wrong pack is sold/reported and SFDA rejects it later. These tests pin the payload shapes the
// pharmacy's scanners actually produce, plus the GTIN normalisation the item master depends on.
import { describe, expect, it } from 'vitest';
import { gtinCandidates, looksLikeGs1, normalizeGtin, parseGs1, serialKey } from './gs1';

const GS = '\x1d';

describe('parseGs1', () => {
  it('reads GTIN, expiry, batch and serial from a full pharmaceutical DataMatrix', () => {
    const parsed = parseGs1(`01062810073200141727010110PC24A17${GS}21SN123456`);
    expect(parsed).toEqual({
      gtin: '06281007320014',
      expiryDate: '2027-01-01',
      batchNo: 'PC24A17',
      serialNo: 'SN123456',
    });
  });

  it('reads a serial that runs to the end of the payload (no trailing separator)', () => {
    expect(parseGs1('010628100732002421SNAMOX0001')).toMatchObject({
      gtin: '06281007320024',
      serialNo: 'SNAMOX0001',
    });
  });

  it('stops at the separator between two variable-length AIs', () => {
    const parsed = parseGs1(`010628100732002421SN1${GS}10AX24C09`);
    expect(parsed.gtin).toBe('06281007320024');
    expect(parsed.serialNo).toBe('SN1');
    expect(parsed.batchNo).toBe('AX24C09');
  });

  it('recognises a GS1 payload by its 14-digit GTIN prefix', () => {
    expect(looksLikeGs1('010628100732001421SN1')).toBe(true);
    expect(looksLikeGs1('6281007320014')).toBe(false);
  });
});

describe('normalizeGtin', () => {
  it('pads a GTIN-13 to the 14 digits printed under AI (01)', () => {
    expect(normalizeGtin('6281007320014')).toBe('06281007320014');
  });

  it('leaves an already 14-digit GTIN alone', () => {
    expect(normalizeGtin('06281007320014')).toBe('06281007320014');
  });

  it('rejects empty and over-long codes', () => {
    expect(normalizeGtin(null)).toBeNull();
    expect(normalizeGtin('')).toBeNull();
    expect(normalizeGtin('123456789012345')).toBeNull();
  });
});

describe('gtinCandidates', () => {
  it('offers the unpadded form the item master stores for a GTIN-13', () => {
    expect(gtinCandidates('06281007320014')).toEqual(['06281007320014', '6281007320014']);
  });

  it('does not invent a shorter code when there is nothing to strip', () => {
    expect(gtinCandidates('6281007320014')).toEqual(['6281007320014']);
  });
});

describe('serialKey', () => {
  it('keeps the same serial string distinct across different products', () => {
    expect(serialKey('06281007320014', 'SN1')).not.toBe(serialKey('06281007320024', 'SN1'));
  });
});
