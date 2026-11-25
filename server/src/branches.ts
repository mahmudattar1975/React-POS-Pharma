// Shared branch master. The authoritative list is the [dbo].[branches] table in PharmaDB, edited
// from Settings > Branches. This copy is the OFFLINE FALLBACK: a pharmacy with no network must
// still be able to open the till, stamp a sale with its branch code and keep selling locally.
// It is also the seed list used by the migration when a database is first created.

export interface BranchRecord {
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
  createdAt?: Date;
}

export const DEFAULT_BRANCHES: BranchRecord[] = [
  {
    id: 'cc-br-001',
    code: 'RIY',
    nameEn: 'Riyadh Branch - Pharmacy Operations',
    nameAr: 'فرع الرياض - عمليات الصيدلية',
    costCenterId: 'cc-br-001',
    isActive: true,
  },
  {
    id: 'cc-br-002',
    code: 'JED',
    nameEn: 'Jeddah Branch - Pharmacy Operations',
    nameAr: 'فرع جدة - عمليات الصيدلية',
    costCenterId: 'cc-br-002',
    isActive: true,
  },
  {
    id: 'cc-br-003',
    code: 'DAM',
    nameEn: 'Dammam Branch - Pharmacy Operations',
    nameAr: 'فرع الدمام - عمليات الصيدلية',
    costCenterId: 'cc-br-003',
    isActive: true,
  },
  {
    id: 'cc-br-004',
    code: 'MKK',
    nameEn: 'Makkah Branch - Pharmacy Operations',
    nameAr: 'فرع مكة المكرمة - عمليات الصيدلية',
    costCenterId: 'cc-br-004',
    isActive: true,
  },
];

export const DEFAULT_BRANCH_ID = DEFAULT_BRANCHES[0].id;

// Invoice numbers are prefixed with this code. Uppercase letters/digits only: it appears in a
// document number and in ZATCA XML references, so spaces and punctuation are not safe.
export function normalizeBranchCode(raw: string): string {
  const code = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) throw new Error('Branch code must contain at least one letter or digit.');
  if (code.length > 8) throw new Error('Branch code must be 8 characters or fewer.');
  return code;
}

export function defaultBranchById(id: string): BranchRecord | undefined {
  return DEFAULT_BRANCHES.find((b) => b.id === id);
}
