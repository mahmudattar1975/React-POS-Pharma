// Types for the RSD (SFDA Drug Track & Trace) adapter.
//
// RSD is unit-level: every message names exactly one physical pack by GTIN + serial number,
// with its batch and expiry. The pharmacy only ever sends the two operations in scope -
// Pharmacy Sale and Pharmacy Sale Cancel - so this module deliberately has no Dispatch/Accept/
// Return/Transfer models.
//
// The field names here are the app's own (camelCase); wire.ts maps them to the uppercase
// SOAP element names SFDA expects.
export type RsdMode = 'mock' | 'live';
export type RsdEnvironment = 'test' | 'production';

// One physical pack. GTIN is normalised to the 14 digits printed under GS1 AI (01).
export interface RsdUnit {
  gtin: string;
  serialNo: string;
  batchNo: string;
  expiryDate: string; // ISO yyyy-mm-dd (day 00 already resolved by the caller/server)
}

export interface RsdSaleInput extends RsdUnit {
  // 'direct' (default) means the patient at the counter; a 13-digit GLN means a reimbursement
  // agency/payer. The portal calls the first case "Direct Sale".
  toGln?: string;
  prescriptionId?: string;
  prescriptionDate?: string;
  doctorId?: string;
  // Optional in the ISD's element ordering; not needed for a direct sale.
  patientNationalId?: string;
  // Local references, stored for reconciliation/audit. Never sent to SFDA.
  invoiceId?: string;
  invoiceNo?: string;
  saleLineId?: string;
}

export interface RsdCancelInput extends RsdUnit {
  // The cancel reuses the sale's stored context (to-GLN, prescription id/date), so these are
  // only recorded for the local audit trail.
  invoiceId?: string;
  invoiceNo?: string;
  saleLineId?: string;
  reason?: string;
}

export type RsdRecordKind = 'sale' | 'cancel';
export type RsdRecordStatus = 'sent' | 'rejected' | 'failed';

// One network attempt. Kept for every retry: the forensic rule is that a later attempt must
// never overwrite what SFDA said the first time.
export interface RsdAttempt {
  at: string;
  mode: RsdMode;
  environment: RsdEnvironment;
  status: RsdRecordStatus;
  rc?: string;
  message?: string;
  notificationId?: string;
  // true only for infrastructure failures (timeout, connection reset, HTTP 5xx/429). A business
  // return code or a SOAP fault is terminal until a human fixes the data.
  retryable: boolean;
  durationMs?: number;
  requestXml?: string;
  responseXml?: string;
}

export interface RsdRecord {
  id: string;
  kind: RsdRecordKind;
  gtin: string;
  serialNo: string;
  batchNo: string;
  expiryDate: string;
  toGln: string;
  prescriptionId?: string;
  prescriptionDate?: string;
  doctorId?: string;
  patientNationalId?: string;
  invoiceId?: string;
  invoiceNo?: string;
  saleLineId?: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
  status: RsdRecordStatus;
  rc?: string;
  message?: string;
  notificationId?: string;
  retryable: boolean;
  attempts: RsdAttempt[];
}

export type RsdOutcome =
  | 'sent'
  | 'already_reported'
  | 'rejected'
  | 'failed'
  | 'already_cancelled'
  | 'sale_not_reported'
  | 'sale_not_sent';

export interface RsdReportResult {
  record: RsdRecord;
  outcome: RsdOutcome;
  message?: string;
}

export interface RsdUnitStatus {
  gtin: string;
  serialNo: string;
  sale?: RsdRecord;
  cancel?: RsdRecord;
}

export interface RsdStatus {
  mode: RsdMode;
  environment: RsdEnvironment;
  gln: string | null;
  credentialsConfigured: boolean;
  saleUrl: string;
  cancelUrl: string;
  directToGln: string;
  directPrescriptionId: string;
  ledger: { records: number; salesSent: number; cancelsSent: number; pendingOrFailed: number };
  // Only populated in mock mode, where the ledger does not reflect a real pharmacy inventory.
  mockInventoryUnits?: number;
}

// Settings > RSD "Test connection": a read-only probe that never sells or cancels anything. In
// mock mode there is nothing remote to reach, so the local state machine is the check.
export interface RsdConnectionCheck {
  name: 'sale' | 'cancel' | 'mock';
  ok: boolean;
  httpStatus?: number | null;
  message?: string;
  operations?: string[];
}

export interface RsdConnectionTest {
  ok: boolean;
  mode: RsdMode;
  environment: RsdEnvironment;
  checkedAt: string;
  checks: RsdConnectionCheck[];
}

export interface RsdResponseProduct {
  gtin?: string;
  sn?: string;
  bn?: string;
  xd?: string;
  rc?: string;
}

export interface RsdParsedResponse {
  notificationId?: string;
  // Some responses carry a single top-level RC next to NOTIFICATIONID; the parser keeps it
  // separate from the per-product codes so a batch answer can never be mistaken for a single one.
  rc?: string;
  products: RsdResponseProduct[];
  fault?: { code?: string; message: string };
}
