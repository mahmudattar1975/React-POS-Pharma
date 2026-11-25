// A pharmacy branch. The list is shared in PharmaDB and edited from Settings > Branches; which
// branch a terminal IS comes from that PC's server/config/branch.json, exposed by /api/context.
export interface Branch {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  address?: string | null;
  phone?: string | null;
  vatNumber?: string | null;
  crNumber?: string | null;
  glnNo?: string | null;
  costCenterId?: string | null;
  isActive: boolean;
  createdAt?: string;
}

export interface BranchContext {
  branch: Branch;
  configured: boolean;
  branches: Branch[];
  source: 'database' | 'fallback';
}

export interface BranchStock {
  branchId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  qtyOnHand: number;
}
