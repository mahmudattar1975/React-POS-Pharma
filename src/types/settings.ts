export interface StoreSettings {
  storeNameAr: string;
  storeNameEn: string;
  vatRegistrationNo: string; // 15 digits, ZATCA requires it start and end with '3'
  crNumber: string; // commercial registration number
  address: string;
  defaultVatRate: number;
  currency: string;
  cashierName: string;
  // Play a short success/info/warning/error tone whenever the app shows a message. On by default;
  // the Settings toggle lets a quiet counter switch it off (see hooks/useAlertSounds.ts).
  alertSoundsEnabled?: boolean;
  // Which BRANCH cost center (see types/costCenters.ts) this register belongs to. New sale
  // headers and purchase invoices are tagged with it by default ("current store" defaulting,
  // costcenter.md §7.1) so branch-level expense/revenue reporting works with ZERO extra clicks
  // at the register - per-document/tag overrides stay optional and only exist on the purchase
  // invoice header, not the POS. settingsStore's merge backfills this for sessions persisted
  // before the field existed (same backfill idea as purchasingStore's merge).
  costCenterId?: string;
}
