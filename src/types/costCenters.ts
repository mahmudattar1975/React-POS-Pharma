// Cost-center module types (Phase A of the cost-center roadmap, see costcenter.md §7.4/§8.3).
//
// A cost center is the unit ACCOUNTABLE for an expense - deliberately NOT the same thing as a
// branch location (the design doc's §1.2 key decision): one branch can hold several centers
// (pharmacy operations, facilities, insurance desk...), while head-office/shared costs live in
// their own overhead centers until an allocation run (Phase B/D) pushes them out to branches.
//
// The field naming intentionally keeps the legacy XPH naming DNA (verified against server
// Mahmoud-pc/xph, GLCOSTCNTR: COSTCNO/COSTNAME_A/E/COSTMAIN/COSTLEVEL) - same columns the SQL
// Server mirror table GLCOSTCNTR_APP (costcenter.md §7.2) will carry one-to-one - while the
// hierarchy itself is an explicit parentId tree instead of the legacy's positional 10-digit
// codes (costcenter.md §3.4), because a browser tree can validate parent/child far better than
// string prefixes can, and the human-facing `code` field still keeps legacy-style short codes
// like BR001-OPS for accountant familiarity.

// 'branch'    earns revenue directly: a pharmacy outlet (multi-branch chain, see the
//             requirements contract in costcenter.md §7).
// 'activity'  a service desk/department attached to a parent (insurance desk, delivery) that
//             can carry its own expenses without grossing sales.
// 'overhead'  head-office/shared cost pools - normally allocatable, waiting for a Phase-D
//             allocation run to distribute them to branch centers.
export type CostCenterKind = 'branch' | 'activity' | 'overhead';

export interface CostCenter {
  id: string;
  // Human-facing short code (BR001-OPS catalog style from costcenter.md §1.2) - informational,
  // NOT the hierarchy key: moving a node in the tree never rewrites other rows.
  code: string;
  nameAr: string;
  nameEn: string;
  // Parent center id, undefined at the root. Explicit reference (not code-prefix inheritance)
  // so a center can be re-parented without touching any other record.
  parentId?: string;
  kind: CostCenterKind;
  isActive: boolean;
  // Legacy GLCOSTCNTR.IsPostingAllowed semantic: whether NEW documents/expenses may be booked
  // against this center. Rollup parents usually stay false - money lands on leaf centers.
  IsPostingAllowed: boolean;
  effectiveFrom: string; // yyyy-mm-dd - inclusive; postings before this date are rejected
  effectiveTo?: string; // yyyy-mm-dd - inclusive; undefined = open-ended
  notes?: string;
  // Allocation drivers (Phase B.1, consumed by Phase D). Informational until an allocation run
  // reads them, so they are optional: every Phase-A center predates them. The SQL mirror's
  // SPACE_SQM / HEADCOUNT columns (costcenter.md §7.2) carry exactly these two numbers, which is
  // why they live on the master here instead of on a separate driver table.
  spaceSqm?: number;
  headcount?: number;
}

// Defaulting rule: "items in category X are accounted for by center Y" (Phase B.1).
//
// Keyed by a NORMALISED category string, not by an id. Item.category is free text (types/catalog.ts)
// and the seed already ships nine spellings - including 'XPH', which is a data-source tag rather
// than a therapeutic category - while live XPH imports may bring their own spelling. A category
// master table would therefore be a migration project with no reporting benefit; instead
// normalizeCategoryKey() is the single place the spelling rule lives, and the map is populated
// from categories actually OBSERVED in the item master (see observedCategories), never from a
// hard-coded list. categoryLabel keeps the spelling the accountant saw when they made the rule,
// so the map stays readable without re-deriving the normalisation by hand.
export interface CategoryCenterMap {
  categoryKey: string; // normalizeCategoryKey(Item.category) - the join key
  categoryLabel: string; // display spelling, as first observed/saved
  costCenterId: string; // must be an active, posting-open, non-overhead center
  updatedAt: string; // ISO datetime - when this mapping row last changed
  updatedBy?: string; // authStore session name when one exists
}

// direct      charged to this center as-is; it belongs to exactly this branch/department.
// allocatable  recorded at a shared/overhead center and still owed to the branches by the
//             Phase-B/D allocation engine (HQ rent, IT, chain-wide salaries...). Until a run
//             posts, these stay sitting ON the overhead center, so the report must mark them -
//             treating them as "branch cost" before allocation would double-count once the
//             allocation posts (the design doc's anti-double-count rule, §5.3).
export type ExpenseKind = 'direct' | 'allocatable';

export interface ExpenseEntry {
  id: string;
  date: string; // yyyy-mm-dd - the expense's accrual date, not the entry timestamp
  amount: number; // SAR, round2 - display money follows the same convention as sales
  description: string;
  costCenterId: string; // the accountable center - every entry MUST name one (this app never
  // lets an expense stay unassigned at entry time; "unassigned" exception reporting instead
  // applies to documents tagged with a center that no longer resolves, see the report page)
  // WHAT was spent - account label (Rent/Utilities/Salaries...). Phase A keeps this a free-text
  // label / fixed option list; a GL account number hookup (matching legacy GLJRNDTL.GLJRNACCT)
  // arrives with the GL integration of a later phase. Never encode the cost center here - skip
  // creating a center per expense type (design doc §1.2).
  expenseAccount: string;
  kind: ExpenseKind;
  // Where the entry came from - Phase A only writes 'manual' through the Expenses page; future
  // feeds (payroll, utilities import) extend this enum rather than shape-shifting old rows.
  source: 'manual';
  createdAt: string; // ISO datetime - audit trail (legacy faddedon equivalent)
}
