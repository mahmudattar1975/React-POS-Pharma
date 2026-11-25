// Incentive / profit bonus for salespeople on a curated list of items.
// Mirrors the legacy PowerBuilder mode 11 (read_bonuc_disc_rate_sal ... 3, 1, 11, 0 // PROFIT):
// a per-item rate (percentage of net sales excl. VAT, or a fixed amount per unit) that is
// granted to the cashier when selling from the incentive item list. Internal cost — never a
// tax line, never enters ZATCA UBL.
export type IncentiveType = 'percent' | 'amount';

export interface IncentiveItem {
  id: string;
  itemId: string;          // FK -> Item
  itemNameEn?: string;     // denormalized for display
  itemNameAr?: string;
  incentiveType: IncentiveType;
  rate: number;            // 0.05 = 5%  OR  SAR per unit
  activeFrom: string;      // ISO date (yyyy-mm-dd)
  activeTo: string;        // ISO date
  branchNo?: number;       // optional scope (legacy CORP_NO)
  active: boolean;
}

export interface IncentiveRecord {
  id: string;
  saleId: string;
  invoiceNo: string;
  invoiceDate: string;     // ISO
  itemId: string;
  itemNameEn: string;
  qty: number;
  saleAmount: number;      // net excl. VAT
  incentiveType: IncentiveType;
  rate: number;
  incentiveAmount: number;
  cashierName: string;
  createdAt?: string;
}

export interface IncentiveSummary {
  date: string;            // ISO date (day)
  invoiceCount: number;
  totalSaleAmount: number;
  totalIncentive: number;
}

// Pure calc input — no side effects, easy to unit test.
export interface IncentiveCalcInput {
  incentiveItem: IncentiveItem | null;
  qty: number;
  netExclVat: number;      // line net excl. VAT
  today?: string;          // ISO date (yyyy-mm-dd); defaults to now
}
