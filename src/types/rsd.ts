// One physical unit as RSD's Pharmacy Sale sees it: the four fields the service accepts.
//
// Kept separate from api/rsdApi.ts so pure helpers (utils/rsdUnits.ts) can use the type without
// pulling in the HTTP client.
export interface RsdUnit {
  gtin: string;
  serialNo: string;
  batchNo: string;
  expiryDate: string;
}
