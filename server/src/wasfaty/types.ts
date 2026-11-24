// Provider-neutral Wasfaty (وصفتي) / NUPCO vocabulary for this app's OWN API.
//
// This is intentionally NOT a claim to be NUPCO's wire contract. NUPCO does not publish a public
// Wasfaty API specification, sandbox or self-service credentials, so inventing endpoint paths or
// payload shapes here would produce an "accurate-looking but wrong" integration. Instead:
//
//   browser -> our API (these types) -> provider adapter -> NUPCO (only where a signed contract
//   file supplies the real operations, auth and response mapping)
//
// `manual` (Phase 0) and `mock` (simulator) implement this contract entirely in-process. `direct`
// and `hub` fail closed until a contract file provides every operation they need. The browser never
// sees a NUPCO path or token.
//
// Field-for-field mirror of src/types/wasfaty.ts plus the server-only provider interfaces. The two
// files are kept in step by hand because the server tsconfig has its own rootDir; tests in
// src/utils/wasfaty.test.ts pin the shared behaviour.

export type WasfatyProvider = 'manual' | 'mock' | 'direct' | 'hub';

export type WasfatyDispenseStatus =
  | 'manual_recorded'
  | 'authorization_pending'
  | 'authorized'
  | 'partially_authorized'
  | 'rejected'
  | 'dispensed'
  | 'cancelled'
  | 'claim_pending'
  | 'claimed'
  | 'reconciled';

export type WasfatyClaimStatus =
  | 'pending'
  | 'submitted'
  | 'reported'
  | 'paid'
  | 'variance'
  | 'reconciled'
  | 'cancelled';

export interface WasfatySession {
  patientNationalId: string;
  prescriptionNo: string;
  wasfatyReferenceNo?: string;
  authorizationNo?: string;
  prescriberName: string;
  prescriberId?: string;
  prescriptionDate: string;
  pharmacistId?: string;
}

export interface WasfatyPrescriptionLine {
  lineId: string;
  nupcoCode: string;
  nameEn: string;
  nameAr?: string;
  qty: number;
  unit?: string;
  dose?: string;
  substitutionAllowed?: boolean;
}

export interface WasfatyPrescription {
  prescriptionId: string;
  prescriptionNo: string;
  patientIdLast4: string;
  prescriber: { name: string; id?: string };
  issuedAt: string;
  status: 'active' | 'dispensed' | 'expired' | 'cancelled';
  lines: WasfatyPrescriptionLine[];
  source: WasfatyProvider;
}

export interface WasfatyDispenseLineInput {
  lineId: string;
  nupcoCode: string;
  itemId: string;
  itemNameEn: string;
  itemNameAr?: string;
  batchNo?: string;
  expiryDate?: string;
  qty: number;
  unit?: string;
  nupcoUnitPrice: number;
  patientShare: number;
  claimAmount: number;
}

export interface WasfatyManualDispenseInput {
  saleId: string;
  invoiceNo: string;
  session: WasfatySession;
  lines: WasfatyDispenseLineInput[];
  invoiceTotalInclVat: number;
  claimTotal: number;
  currency: string;
}

export interface WasfatyDispenseRecord {
  id: string;
  provider: WasfatyProvider;
  status: WasfatyDispenseStatus;
  saleId?: string;
  invoiceNo?: string;
  prescriptionNo: string;
  wasfatyReferenceNo?: string;
  authorizationNo?: string;
  nupcoPrescriptionId?: string;
  nupcoDispenseId?: string;
  patientIdLast4?: string;
  pharmacistId?: string;
  submittedAt?: string;
  authorizedAt?: string;
  dispensedAt?: string;
  rejectionReason?: string;
  claimId?: string;
  claimStatus?: WasfatyClaimStatus;
  claimMonth?: string;
  totalClaimAmount?: number;
  totalPatientShare?: number;
  lines: WasfatyDispenseLineInput[];
  createdAt: string;
  updatedAt: string;
}

export interface WasfatyClaim {
  id: string;
  dispenseId: string;
  invoiceNo?: string;
  prescriptionNo: string;
  month: string;
  expectedAmount: number;
  reportedAmount?: number;
  paidAmount?: number;
  status: WasfatyClaimStatus;
  varianceReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WasfatyAuthorizationLine {
  lineId: string;
  nupcoCode: string;
  approvedQty: number;
}

export interface WasfatyAuthorizationResult {
  authorizationNo: string;
  status: 'authorized' | 'partially_authorized' | 'rejected' | 'authorization_pending';
  approvedLines: WasfatyAuthorizationLine[];
  rejectedLines?: { lineId: string; nupcoCode: string; reason: string }[];
  authorizationId?: string;
  message?: string;
}

export interface WasfatyCapabilities {
  lookupPrescription: boolean;
  requestAuthorization: boolean;
  submitDispense: boolean;
  submitClaim: boolean;
}

// What a provider adapter must implement. `manual` is deliberately allowed to answer "not
// supported" for lookup/authorization (the pharmacist has the paper/portal in front of them) while
// still recording the dispense; that is Phase 0 and it is a first-class mode, not a stub.
export interface WasfatyProviderAdapter {
  readonly id: WasfatyProvider;
  readonly capabilities: WasfatyCapabilities;
  lookupPrescription(input: {
    prescriptionNo: string;
    patientNationalId?: string;
  }): Promise<WasfatyPrescription>;
  requestAuthorization(input: {
    prescriptionNo: string;
    patientNationalId: string;
    lines: WasfatyDispenseLineInput[];
  }): Promise<WasfatyAuthorizationResult>;
  submitDispense(record: WasfatyDispenseRecord): Promise<{
    status: WasfatyDispenseStatus;
    nupcoPrescriptionId?: string;
    nupcoDispenseId?: string;
    authorizationNo?: string;
    rejectionReason?: string;
  }>;
  cancelDispense(record: WasfatyDispenseRecord, reason: string): Promise<{ status: WasfatyDispenseStatus }>;
  submitClaim(claim: WasfatyClaim): Promise<{
    status: WasfatyClaimStatus;
    reportedAmount?: number;
    varianceReason?: string;
  }>;
  reconcileClaim(
    claim: WasfatyClaim,
    input: { reportedAmount?: number; paidAmount?: number; varianceReason?: string },
  ): Promise<{ status: WasfatyClaimStatus; reportedAmount?: number; paidAmount?: number; varianceReason?: string }>;
}

// Contract file shape. Every value is supplied by NUPCO onboarding; nothing here is guessed by the
// app. See Wasfaty-API.md for the checklist and a sample file.
export type WasfatyOperationName =
  | 'lookupPrescription'
  | 'requestAuthorization'
  | 'submitDispense'
  | 'cancelDispense'
  | 'submitClaim'
  | 'reconcileClaim';

export interface WasfatyOperationContract {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  path: string;
}

export interface WasfatyAuthContract {
  type: 'none' | 'bearer' | 'apiKey';
  // A literal token/key may live here for a local test harness; production should use an env var
  // reference (`tokenEnv`) so credentials are never committed with the contract.
  token?: string;
  tokenEnv?: string;
  header?: string;
}

// Maps fields in the supplier's response to our neutral shape. Only needed when the supplier's
// payload is not already our shape; a path is dot notation with `[n]` array indexes.
export interface WasfatyOperationMapping {
  id?: string;
  authorizationNo?: string;
  status?: string;
  lines?: string;
  lineId?: string;
  nupcoCode?: string;
  approvedQty?: number | string;
  qty?: string;
  rejectionReason?: string;
  prescriptionId?: string;
  patientIdLast4?: string;
  prescriberName?: string;
  prescriberId?: string;
  issuedAt?: string;
  nupcoDispenseId?: string;
  nupcoPrescriptionId?: string;
  reportedAmount?: string;
  paidAmount?: string;
  month?: string;
  varianceReason?: string;
}

export interface WasfatyContractFile {
  version?: string;
  environment?: string;
  baseUrl?: string;
  auth?: WasfatyAuthContract;
  operations?: Partial<Record<WasfatyOperationName, WasfatyOperationContract>>;
  mappings?: Partial<Record<WasfatyOperationName, WasfatyOperationMapping>>;
}

export interface WasfatyContractInfo {
  source: 'none' | 'file' | 'env';
  path?: string;
  version?: string;
  baseUrl?: string;
  environment?: string;
  missingOperations?: string[];
}

export interface WasfatyHealth {
  ok: boolean;
  provider: WasfatyProvider;
  configured: boolean;
  environment: string;
  capabilities: WasfatyCapabilities;
  contract?: WasfatyContractInfo;
  checkedAt: string;
}
