// One physical, serialised sellable unit read from a pharmaceutical GS1 DataMatrix
// ((01) GTIN, (21) serial, (10) batch, (17) expiry). Kept on the cart line while it is being
// sold and frozen onto the sale line at checkout, because RSD's Pharmacy Sale reports units -
// not invoices - and every later cancel/report has to point at the exact same unit.
//
// `gtin` is normalised to the 14 digits GS1 prints under AI (01); `batchNo`/`expiryDate` are the
// batch the unit was actually taken from, so they always agree with the stock record that was
// decremented.
export interface DrugSerial {
  gtin: string;
  serialNo: string;
  batchNo: string;
  expiryDate: string | null;
}
