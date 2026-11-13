// Legacy FCODCSVN party master flag (type_flag). The legacy pharmacy system keeps suppliers and
// customers in one table and distinguishes them by this flag, so a document can point at either
// side without a second id space. This app does the same in purchasingStore.vendors: vendor rows
// (1) and business-customer rows (2) share the vendor-file fields, and a purchase invoice can
// select either side through PurchaseInvoice.partyType. POS retail patients are a separate master
// and never carry this flag.
export type PartyTypeFlag = 1 | 2;

export const PARTY_TYPE_FLAG = {
  vendor: 1,
  customer: 2,
} as const satisfies Record<string, PartyTypeFlag>;
