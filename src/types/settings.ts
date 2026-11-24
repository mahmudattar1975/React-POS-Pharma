export interface StoreSettings {
  storeNameAr: string;
  storeNameEn: string;
  vatRegistrationNo: string; // 15 digits, ZATCA requires it start and end with '3'
  crNumber: string; // commercial registration number
  address: string;
  // Contact number printed on prescription labels (represcription.md Phase 2). Optional: an older
  // persisted settings object simply has no phone until the owner types one.
  storePhone?: string;
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
  // Opt-in for SFDA RSD (Drug Track & Trace) reporting. Off by default: a fresh register must not
  // send national movements until the pharmacy has confirmed its GLN/credentials in Settings > RSD.
  // Turning it off stops NEW units from being queued; already queued units are still sent, because
  // abandoning a half-reported movement is worse than finishing it.
  rsdEnabled?: boolean;
}
