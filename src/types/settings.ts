export interface StoreSettings {
  storeNameAr: string;
  storeNameEn: string;
  vatRegistrationNo: string; // 15 digits, ZATCA requires it start and end with '3'
  crNumber: string; // commercial registration number
  address: string;
  defaultVatRate: number;
  currency: string;
  cashierName: string;
}
