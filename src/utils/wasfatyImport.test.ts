import { describe, expect, it } from 'vitest';
import type { Item } from '../types/catalog';
import { parseDelimitedRows, planWasfatyImport } from './wasfatyImport';

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'itm-1',
    itemNo: 1001,
    barcode: '6281007320014',
    nameAr: 'باراسيتامول',
    nameEn: 'Paracetamol 500mg',
    unit: 'Strip',
    category: 'Analgesics',
    basePrice: 4.5,
    vatRate: 0,
    requiresBatchTracking: true,
    reorderLevel: 10,
    ...overrides,
  };
}

const items: Item[] = [
  item({ id: 'itm-1', itemNo: 1001, barcode: '6281007320014', nameEn: 'Paracetamol 500mg' }),
  item({
    id: 'itm-2',
    itemNo: 1002,
    barcode: '6281007320021',
    barcodes: ['6281007320090'],
    gtin: '6281007320091',
    nameEn: 'Amoxicillin 500mg',
  }),
  item({ id: 'itm-3', itemNo: 101682, barcode: '6281007320038', nameEn: 'Insulin Lantus' }),
];

describe('parseDelimitedRows', () => {
  it('parses comma, tab and semicolon files', () => {
    expect(parseDelimitedRows('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseDelimitedRows('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseDelimitedRows('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('handles quoted fields, escaped quotes and embedded delimiters', () => {
    expect(parseDelimitedRows('code,name\n1,"Para, 500mg"\n2,"Say ""ah"""')).toEqual([
      ['code', 'name'],
      ['1', 'Para, 500mg'],
      ['2', 'Say "ah"'],
    ]);
  });

  it('drops blank lines and a UTF-8 BOM', () => {
    expect(parseDelimitedRows('\uFEFFa,b\r\n\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('planWasfatyImport', () => {
  it('maps a header CSV by barcode and records the approved price', () => {
    const preview = planWasfatyImport(
      'nupco_code,barcode,price\n6281007320014,6281007320014,4.25\n',
      items,
    );
    expect(preview.errors).toBe(0);
    expect(preview.ready).toBe(1);
    expect(preview.apply).toEqual([
      { itemId: 'itm-1', nupcoCode: '6281007320014', wasfatyPrice: 4.25, wasfatyEligible: true },
    ]);
    expect(preview.rows[0]).toMatchObject({ status: 'ready', itemName: 'Paracetamol 500mg', itemNo: 1001 });
  });

  it('reads a headerless paste as code, barcode, price', () => {
    const preview = planWasfatyImport('6281007320014,6281007320014,4.25', items);
    expect(preview.apply[0]).toMatchObject({ itemId: 'itm-1', wasfatyPrice: 4.25 });
  });

  it('accepts a single column where the code is also the barcode', () => {
    const preview = planWasfatyImport('6281007320014', items);
    expect(preview.ready).toBe(1);
    expect(preview.apply[0]).toMatchObject({ itemId: 'itm-1', nupcoCode: '6281007320014' });
  });

  it('matches by item number when the file is an internal export', () => {
    const preview = planWasfatyImport('nupco code,item no\n6281007320014,101682', items);
    expect(preview.errors).toBe(0);
    expect(preview.apply[0]).toMatchObject({ itemId: 'itm-3' });
  });

  it('matches alias barcodes and GTINs', () => {
    const alias = planWasfatyImport('nupco_code,barcode\n6281007320090,6281007320090', items);
    expect(alias.apply[0]).toMatchObject({ itemId: 'itm-2' });
    const gtin = planWasfatyImport('nupco_code,gtin\n6281007320091,6281007320091', items);
    expect(gtin.apply[0]).toMatchObject({ itemId: 'itm-2' });
  });

  it('falls back to the code as a barcode when the barcode column does not match', () => {
    const preview = planWasfatyImport('nupco_code,barcode\n6281007320014,0000000000000', items);
    expect(preview.ready).toBe(1);
    expect(preview.apply[0]).toMatchObject({ itemId: 'itm-1' });
  });

  it('skips rows for items this pharmacy does not stock, without blocking the import', () => {
    const preview = planWasfatyImport(
      'nupco_code,barcode\n6281007320014,6281007320014\n6281007999999,6281007999999',
      items,
    );
    expect(preview.ready).toBe(1);
    expect(preview.skipped).toBe(1);
    expect(preview.errors).toBe(0);
    expect(preview.rows[1].status).toBe('skipped');
  });

  it('rejects a code that is not 13 digits', () => {
    const preview = planWasfatyImport('nupco_code,barcode\n123,6281007320014', items);
    expect(preview.errors).toBe(1);
    expect(preview.apply).toHaveLength(0);
    expect(preview.rows[0].reason).toMatch(/13 digits/);
  });

  it('rejects a duplicate code inside the file', () => {
    const preview = planWasfatyImport(
      'nupco_code,barcode\n6281007320014,6281007320014\n6281007320014,6281007320014',
      items,
    );
    expect(preview.errors).toBe(1);
    expect(preview.rows[1].reason).toMatch(/Duplicate of line 1/);
  });

  it('rejects the same local item appearing twice', () => {
    const preview = planWasfatyImport(
      'nupco_code,barcode\n6281007320014,6281007320014\n6281007320015,6281007320014',
      items,
    );
    expect(preview.errors).toBe(1);
    expect(preview.rows[1].reason).toMatch(/already appears on line 1/);
  });

  it('rejects a code already mapped to another local item', () => {
    const mapped = [
      item({ id: 'itm-9', itemNo: 1009, barcode: '6281007320045', nameEn: 'Other item', nupcoCode: '6281007320014' }),
      ...items,
    ];
    const preview = planWasfatyImport('nupco_code,barcode\n6281007320014,6281007320014', mapped);
    expect(preview.errors).toBe(1);
    expect(preview.rows[0].reason).toMatch(/Already mapped to Other item/);
  });

  it('rejects a match that hits more than one local item', () => {
    const duplicateBarcode = [...items, item({ id: 'itm-4', itemNo: 1004, nameEn: 'Duplicate barcode' })];
    const preview = planWasfatyImport('nupco_code,barcode\n6281007320014,6281007320014', duplicateBarcode);
    expect(preview.errors).toBe(1);
    expect(preview.rows[0].reason).toMatch(/more than one/);
  });

  it('marks an already-identical mapping as unchanged and does not apply it again', () => {
    const already = [item({ id: 'itm-1', nupcoCode: '6281007320014', wasfatyPrice: 4.25 })];
    const preview = planWasfatyImport('nupco_code,barcode,price\n6281007320014,6281007320014,4.25', already);
    expect(preview.unchanged).toBe(1);
    expect(preview.ready).toBe(0);
    expect(preview.apply).toHaveLength(0);
  });

  it('applies a changed price even when the code is already mapped', () => {
    const already = [item({ id: 'itm-1', nupcoCode: '6281007320014', wasfatyPrice: 4.25 })];
    const preview = planWasfatyImport('nupco_code,barcode,price\n6281007320014,6281007320014,5.00', already);
    expect(preview.ready).toBe(1);
    expect(preview.apply[0]).toMatchObject({ itemId: 'itm-1', wasfatyPrice: 5 });
  });

  it('rejects a negative or non-numeric price', () => {
    expect(planWasfatyImport('nupco_code,barcode,price\n6281007320014,6281007320014,-1', items).errors).toBe(1);
    expect(planWasfatyImport('nupco_code,barcode,price\n6281007320014,6281007320014,abc', items).errors).toBe(1);
  });

  it('rejects an explicit "not eligible" row', () => {
    const preview = planWasfatyImport('nupco_code,barcode,eligible\n6281007320014,6281007320014,no', items);
    expect(preview.errors).toBe(1);
    expect(preview.rows[0].reason).toMatch(/eligible/);
  });

  it('accepts common header aliases', () => {
    const preview = planWasfatyImport(
      'NUPCO Item Code,GTIN,Approved Price,On Wasfaty List\n6281007320014,6281007320014,4.25,yes',
      items,
    );
    expect(preview.errors).toBe(0);
    expect(preview.apply[0]).toMatchObject({ itemId: 'itm-1', wasfatyPrice: 4.25 });
  });

  it('returns an empty preview for blank input', () => {
    const preview = planWasfatyImport('   \n\n', items);
    expect(preview.rows).toHaveLength(0);
    expect(preview.ready).toBe(0);
    expect(preview.errors).toBe(0);
  });
});
