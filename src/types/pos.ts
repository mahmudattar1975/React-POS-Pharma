// Request/response shapes for dotnet-pos's /Pos/Create and /PosReturn/Create - see src/api/posApi.ts.
import type { PaymentMethod } from './sales';

// Matches dotnet-pos's PosPaymentMethod enum (Entity/Models/Pos.cs). Sent as this numeric value,
// not the string, since the backend doesn't use a JsonStringEnumConverter.
//
// 'other' = any non-standard tender (store credit note etc.), mapped to dotnet-pos's Other=5 -
// added to that enum in Entity/Models/Pos.cs in sync with this. Other legs are ignored by the
// backend's drawer reconciliation (only Cash rows are summed, like Points) but ARE recorded on
// the sale, so nothing is silently dropped from a payment list anymore.
export const POS_PAYMENT_METHOD: Record<PaymentMethod, number> = {
  cash: 1,
  card: 2,
  insurance: 3,
  points: 4,
  other: 5,
  // dotnet-pos has no Wasfaty tender. The coverage leg is sent as Other so the commission mirror
  // still records the full invoice instead of dropping it; the real Wasfaty record lives on the
  // sale and in the Wasfaty API, not in that commission backend.
  wasfaty: 5,
};

export interface CreatePosLinePayload {
  barcode: string;
  name: string;
  qty: number;
  unitPrice: number; // VAT-exclusive, net of any discount already applied
  vatRate: number;
  lineTotal: number; // VAT-inclusive total actually charged for this line
}

export interface CreatePosPaymentPayload {
  method: number;
  amount: number;
}

export interface CreatePosPayload {
  invoiceNo: string;
  customerName?: string;
  payments: CreatePosPaymentPayload[];
  items: CreatePosLinePayload[];
}

export interface PosSaleResult {
  id: number;
  items: { id: number }[]; // same order as the request's items[] - zip by index to get each line's PosItem id
}

export interface CreatePosReturnLinePayload {
  posItemId: number;
  qty: number;
}

export interface CreatePosReturnPayload {
  originalPosId: number;
  reason?: string;
  items: CreatePosReturnLinePayload[];
}
