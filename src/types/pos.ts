// Request/response shapes for dotnet-pos's /Pos/Create and /PosReturn/Create - see src/api/posApi.ts.
import type { PaymentMethod } from './sales';

// Matches dotnet-pos's PosPaymentMethod enum (Entity/Models/Pos.cs). Sent as this numeric value,
// not the string, since the backend doesn't use a JsonStringEnumConverter.
export const POS_PAYMENT_METHOD: Record<PaymentMethod, number> = {
  cash: 1,
  card: 2,
  insurance: 3,
  points: 4,
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
