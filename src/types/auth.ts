export interface CashierSession {
  token: string;
  cashierId: number;
  username: string;
  fullName: string;
  isAdmin: boolean;
}

export interface Shift {
  id: number;
  cashierId: number;
  openedAt: string;
  closedAt: string | null;
  openingFloat: number;
  closingAmount: number | null;
  // Matches dotnet-pos's ShiftStatus enum (Entity/Models/Shift.cs): 1 = Open, 2 = Closed. Not
  // currently branched on client-side - GET /Shift/Current only ever returns the open shift or
  // null, so presence of a Shift here already means "open".
  status: number;
  commissionEarned: number | null;
  totalSales: number | null;
  totalReturns: number | null;
}

export interface ShiftCloseResult {
  id: number;
  openedAt: string;
  closedAt: string;
  openingFloat: number;
  closingAmount: number | null;
  totalSales: number;
  totalReturns: number;
  commissionEarned: number;
  expectedCash: number;
  cashVariance: number | null;
}
