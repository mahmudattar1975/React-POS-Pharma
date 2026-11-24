// The party table is the one-table view of the legacy FCODCSVN master: vendors (type_flag 1) and
// business customers (type_flag 2) are rows of the SAME purchasing array. POS retail patients are
// a different master and never appear here.
import { describe, expect, it } from 'vitest';

import type { Vendor } from '../types/purchasing';
import { PARTY_TYPE_FLAG } from '../types/party';
import { buildPartyTable, partyLabel } from './party';

const vendor: Vendor = {
  id: 'ven-1',
  typeFlag: PARTY_TYPE_FLAG.vendor,
  vendorNo: 'VEN-000001',
  nameAr: 'مورد',
  nameEn: 'Al-Hayat Drug Distribution Co.',
  phone: '0114445566',
  vatNumber: '310555123400003',
  isActive: true,
};

const customer: Vendor = {
  id: 'pcu-1',
  typeFlag: PARTY_TYPE_FLAG.customer,
  vendorNo: 'CUS-000001',
  nameAr: 'مركز النور الطبي',
  nameEn: 'Al-Noor Medical Center',
  phone: '0114567890',
  vatNumber: '311234567800003',
  isActive: true,
};

describe('party table', () => {
  it('puts vendors and business customers in one table with their type_flag', () => {
    const table = buildPartyTable([vendor, customer]);
    expect(table).toHaveLength(2);
    expect(table[0]).toMatchObject({ id: 'ven-1', typeFlag: PARTY_TYPE_FLAG.vendor, no: 'VEN-000001' });
    expect(table[1]).toMatchObject({ id: 'pcu-1', typeFlag: PARTY_TYPE_FLAG.customer, no: 'CUS-000001' });
  });

  it('carries the vendor-file fields on a customer row too', () => {
    const row = buildPartyTable([customer])[0];
    expect(row).toMatchObject({
      nameEn: 'Al-Noor Medical Center',
      phone: '0114567890',
      vatNumber: '311234567800003',
      isActive: true,
    });
  });

  it('treats a row with no explicit isActive flag as active', () => {
    const activeByDefault: Vendor = { ...customer, isActive: undefined };
    expect(buildPartyTable([activeByDefault])[0].isActive).toBe(true);
  });

  it('filters cleanly by type_flag for the vendor/customer switch', () => {
    const table = buildPartyTable([vendor, customer]);
    expect(table.filter((p) => p.typeFlag === PARTY_TYPE_FLAG.vendor).map((p) => p.id)).toEqual(['ven-1']);
    expect(table.filter((p) => p.typeFlag === PARTY_TYPE_FLAG.customer).map((p) => p.id)).toEqual(['pcu-1']);
  });

  it('labels the two sides', () => {
    expect(partyLabel(PARTY_TYPE_FLAG.vendor)).toBe('Vendor');
    expect(partyLabel(PARTY_TYPE_FLAG.customer)).toBe('Customer');
  });
});
