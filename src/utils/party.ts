// The legacy FCODCSVN party master keeps suppliers and customers in ONE table, distinguished by
// type_flag (1 = vendor, 2 = customer). The purchasing store is that table: vendor rows and
// business-customer rows live in the same array, share the vendor-file fields (number, names,
// phone, VAT, GLN, credit terms) and are only separated by the flag. POS patients are a different
// master (customerStore) and are deliberately never part of this table.
import type { Vendor } from '../types/purchasing';
import { PARTY_TYPE_FLAG, type PartyTypeFlag } from '../types/party';

export interface PartyRow {
  id: string;
  typeFlag: PartyTypeFlag;
  // System-assigned CUST_NO analogue: VEN-000001 for a vendor, CUS-000001 for a customer.
  no: string;
  nameAr: string;
  nameEn: string;
  phone: string;
  vatNumber?: string;
  glnNo?: string;
  isActive: boolean;
}

// One row shape for the UI. The array is already the one table; this only narrows the fields a
// picker/list needs, so a party is always rendered the same way whichever side it is.
export function buildPartyTable(parties: Vendor[]): PartyRow[] {
  return parties.map((p) => ({
    id: p.id,
    typeFlag: p.typeFlag,
    no: p.vendorNo,
    nameAr: p.nameAr,
    nameEn: p.nameEn,
    phone: p.phone,
    vatNumber: p.vatNumber,
    glnNo: p.glnNo,
    isActive: p.isActive !== false,
  }));
}

export function partyLabel(typeFlag: PartyTypeFlag): string {
  return typeFlag === PARTY_TYPE_FLAG.customer ? 'Customer' : 'Vendor';
}
