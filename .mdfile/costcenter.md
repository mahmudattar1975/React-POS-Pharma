# Cost Center Design for the Pharmacy App — Deep Analysis & Proposal

Prepared as an analysis document (same documentation discipline as `ANALYZE_PURCHASE.md`):
everything is marked **[verified]** (read directly from code/data in this session), **[assumed]**
(the best-supported reading of external standard practice), or **[proposal]** (a design
recommendation yet to be approved/built).

> ⚠️ Note on sources: in this session the web-search tools were unavailable (requests were
> cancelled), so the *industry practice* sections rest on standard managerial-accounting
> literature (responsibility accounting / cost-profit-investment center doctrine, typical
> retail pharmacy financial structures) rather than fresh web citations. The *legacy* sections
> are hard-verified against the live XPH database on server `Mahmoud-pc`. If you want, I can
> re-run the web research later and append citations.

> **Scope correction (from the owner's shared requirements doc, 2026-10-26):**
> pharmacy type = **chain**; branch structure = **multiple**; accounting objective =
> **expenses**; database = SQL Server. This doc's Phase-B "multi-store prep" therefore moves
> to the front, and the expense/allocation engine becomes the primary deliverable rather
> than a Phase-C extra. See §7 "Revised against the requirements doc".

---

## 1. What a cost center is, and why a pharmacy needs one

[assumed — standard managerial accounting]

A **cost center** is a segment of the business that does not own revenue but generates costs —
you collect its costs separately so someone is *accountable* for them. A **profit center** (or
revenue center) additionally owns the revenue it generates, so you can compute its own P&L. A
pharmacy business needs both faces of the same idea, and in practice both live in one
"dimension" tree, exactly as your legacy system already models it (section 2).

Industry-standard pharmacy segmentation, from the widest to the narrowest:

| Segment type | Example | Analogy in your app |
|---|---|---|
| **Branch / store** (the classic pharmacy "profit center") | Al-Nahdi / Al-Dawaa store #127 | your store (today: one) |
| **Departments within a store** | Dispensary (behind-the-counter Rx), OTC retail floor, cosmetics & skincare, baby corner, medical devices | natural `Item.category` groups |
| **Activity cost centers** | Insurance-desk (claims processing overhead), delivery/invoicing, ZATCA e-invoicing compliance desk | cost pools with no revenue of their own |
| **Support / overhead centers** | Head office, HR, rent of central warehouse, ERP licenses | everything that must be *allocated* to the earning centers |
| **Corporate strategies** | per-category profitability analysis (analgesics vs cosmetics vs supplements) | the category dimension you already carry on items |

Why this matters operationally for a pharmacy (versus, say, a factory):

1. **Labor dominates cost structure.** In retail pharmacy, staff wages are the single biggest
   controllable cost (often ~50–70% of operating cost of a branch). A branch cost center that
   only shows product margin without wages/rent tells the owner nothing.
2. **Margins differ enormously by department.** Dispensary Rx → SFDA-registered, commonly
   zero-rated VAT and thin headroom set by insurance/moi approvals; cosmetics → 15% VAT,
   60–80% margins. Rolling all up into one P&L hides that the OTC/cosmetics floor may subsidize
   the prescription counter (or vice versa).
3. **Inventory financing is invisible without segmentation.** Slow-turning cosmetics stock ties
   capital differently from fast-moving paracetamol; per-center "return on inventory"
   (branch profit / average stock value) is the number a pharmacy chain owner actually uses.
4. **Insurance-claim mix.** In KSA a growing share of sales goes through insurance (Bupa,
   Tawuniya, MedGulf). Claims carry remittance delays and rejections — a cost dimension on its
   own ("insurance receivable days per branch").

The doctrine the whole design below follows: **a transaction should carry exactly one primary
cost-center dimension, and indirect cost is charged to earning centers through a declared
allocation basis, never buried at HQ forever.**

## 2. What the legacy XPH system already does [verified]

Queried live from `xph` (server `Mahmoud-pc`, 2026-10-26). The legacy GL module has a complete
cost-center subsystem:

### 2.1 Master table `GLCOSTCNTR` — a 4-level hierarchical tree

| Column | Meaning |
|---|---|
| `COSTCNO` decimal(10) | **positional code**: digits encode the tree path (see below) |
| `COSTNAME_A` / `COSTNAME_E` | bilingual name |
| `COSTLEVEL` 0–4 | depth in the tree |
| `COSTMAIN` | the **parent** code (rollup target) |
| `COSTTYPE` 1/2 | center type (all 20 rows are type 2) |
| `COSTLDGR` | linked ledger flag |
| `COSTBAL`, `COSTDRAMTOT`, `COSTCRAMTOT`, `COSTDRTRNTOT`, `COSTCRTRNTOT` | **running rollup balances** maintained on the master row |

The live tree (20 centers, 1 root, 5 leaf branches at level 3) decodes as:

```
100000000  الشركة (company)                    level 0
└─ 110000000 <area>                          level 1
   └─ 111000000 <region>                     level 2
      ├─ 111100000 <branch>                  level 3  (leaf pharmacy)
      ├─ 111200000 <branch>                  level 3
      │  ├─ 111200001 صيدلية محل 7497        level 4  (individual pharmacy outlet)
      │  └─ 111200002 صيدلية محل 2133        level 4  (individual pharmacy outlet)
      └─ 111300000 <area office>             level 3
         ├─ 111300001 <dept>                 level 4
         └─ 111300003 <dept>                 level 4
```

[assumed] The reading of the 10-digit code: `1 | 1 | 1 | 2 | 0001` — consecutive digit groups
per level, so the code is self-describing and sorting by code gives you the tree. The *exact*
semantics of each Arabic name were garbled by the encoding in the dump, so which name maps to
"area"/"branch" is inferred from the tree shape (`.000001/.000002` siblings clearly being
individual shops).

### 2.2 Transaction tables

- `GLCOSTTRN` — per-line postings: `BRANCH_NO`, `GLCOSTACCT` (GL account),
  `GLCOSTDISCP` (description), `GLCOSTAMT`, `GLCOSTTYPE`, `GLCOSTPOST` (posted vs draft).
  Empty in this DB copy — transactions live in the separate accounting DB, or purged.
- `GLCOSTCNTR_DAILY` — **daily balance snapshots per center** (`FDATE`, `GLCOSTNO`,
  `GLCOST_BALANCE`, `TOTAL_DEBIT/CREDIT_TRANS/AMOUNT`): the period-close model — balances are
  *frozen on the master*, and the daily table answers "where was this center on date X".
- `GLLINKCOST` — **default cost center per GL account** (`GLLINKACCT` → `GLCOSTNO`): when an
  invoice hits account X, it defaults into center Y without the clerk choosing. Empty in this
  copy, but the *concept* matters: default routing by account/document type.
- `FTRANS_COST_GL` — bridge from operational transactions (`FTRANS…`) into cost-center GL.

**The legacy verdict for our design [proposal]:** the React app should not re-invent a scheme.
It should (a) adopt the **hierarchical parent/child tree** (not positional codes — explicit
`parentId` is far better for a web UI), (b) adopt **branch-first routing** (single-store today,
but every document gets a cost-center field from day one), (c) adopt **period snapshots** only
after transactions accumulate, computing live until then.

## 3. Chosen design for the React app [proposal]

### 3.1 Dimension model — one tree, two kinds of leaves

```
CostCenterKind = 'branch'      // earns revenue: store / future multi-store pharmacy outlet,
                                // or a "virtual" pharmacy department that sells
               | 'activity'    // service desk with costs, no revenue (insurance desk, delivery)
               | 'overhead'    // pure cost pool, must be allocated out (HQ, rent, ERP license)
```

Balances the legacies' type 1/2 idea with the standard doctrine: only **branch** centers are
allowed to hold revenue; the report refuses to mix kinds into a "profit" number — overhead
centers show allocation-out totals instead.

Node fields:

```
interface CostCenter {
  id: string;
  code: string;              // short human code (e.g. 'PH-1', 'HQ', 'INS-DESK') — NOT positional
  nameAr: string; nameEn: string;
  parentId: string | null;   // explicit tree — better than legacy positional codes
  kind: CostCenterKind;
  isActive: boolean;
  // allocation base only on earning centers
  spaceSqm?: number;         // for rent/electricity allocation
  headcount?: number;        // for salary allocation
}
```

Seed data [proposal]: a realistic minimal tree matching the demo business —
`HQ (overhead)` → `Main Pharmacy (branch)` with sub-departments `Dispensary`, `OTC Floor`,
`Cosmetics Corner` (branch-kind virtual departments), plus `Insurance Desk` and `Delivery`
(activity). This makes the first P&L report immediately meaningful with the existing seed
sales/purchase data.

### 3.2 Where the dimension attaches [proposal]

| Document | Cost-center attachment | Default routing rule |
|---|---|---|
| Sale (`SaleHeader`) | `costCenterId` | the store's POS → its branch center; per-line category → department (see 3.3) |
| Purchase invoice (`PurchaseInvoice`) — *the Phase-1 feature we just built* | `costCenterId` | the receiving branch; per line, overridable (e.g. stock bought for cosmetics corner) |
| Head-office transfer | `costCenterId` | destination branch |
| **Manual expense entry** (new) — rent, electricity, salary, credits | `costCenterId` + `allocationBasis` | picked by user; `overhead` centers must declare an allocation basis at entry time |
| Inventory value on hand | derived | attributed per department of its items |

The purchase-invoice integration is nearly free: `PurchaseInvoice` gets one optional
`costCenterId`, one store touch, the history table shows the center column. Sales tagging
needs one field on `SaleHeader` + default from settings (single store, so always the same
value until multi-store arrives).

### 3.3 Per-line department attribution without annoying the cashier [assumed → proposal]

Cashiers cannot be asked "which cost center?" at every line. Industry practice for retail is
**category-driven defaulting**: `Item.category` (you already have `category: 'Analgesics'`,
`'XPH'`, etc.) maps to a department cost center in a settings table:

```
categoryCostCenterMap: { category: string; costCenterId: string }[]
```

- The **sale header** carries the branch center; the **P&L report** optionally splits revenue
  by the category→department map. No POS friction at all; zero new input on the till.
- Purchase lines may override per line (a vendor delivery for the cosmetics corner).

### 3.4 The P&L model per center — contribution margin first [proposal]

For each node of the tree, for a chosen month:

```
Revenue            = Σ sales net excl. VAT tagged to node (+ category-derived departments)
− COGS             = Σ batch costPrice of sold units (already exact, round3, incl. bonus dilution!)
= Contribution margin
− Direct expenses  = Σ manual expenses charged directly to the node
= Segment result
Shared overhead    = allocated later (3.5), shown separately
Rollup             = parents sum their children + own costs
VAT note           = VAT is NEVER a cost in the report: input VAT is recoverable, output
                     VAT is a liability; report shows revenue excluding VAT, mirrors the
                     legacy's NET_PUR_NVAT/TOTAL_PUR_VAT split convention.
```

This is exactly why the Phase-1 purchase work pays off: batch cost already includes the
3-tier discount cascade and bonus dilution, so **segment COGS is truthful from day one**
(no re-work later).

### 3.5 Allocation engine for overhead [proposal, phased]

legacy keeps overhead up in the tree with rollups only [verified: children roll into
`COSTMAIN`]. The standard practice is better: allocate overhead into earning centers with a
declared basis. Design:

```
AllocationRule {
  expenseEntryId | recurringExpenseId   // rent, salary run…
  basis: 'revenue' | 'headcount' | 'spaceSqm' | 'transactions' | 'inventoryValue' | 'fixed'
  targets: costCenterId[] (default: all active branches)
}
```

- Run monthly, **preview before apply** (a table showing each node's computed share; totals
  must reconcile to the expense amount to the halala — same tolerance philosophy as the
  totals card).
- Legacy-compatible option: if the user wants the legacy behavior, basis = 'fixed' with all
  allocation to the root = "keep overhead up the tree" (i.e. skip allocation).
- Snapshots: applied allocations are written as transactions with a flag, so a closed period
  never re-computes — mirroring legacy `GLCOSTCNTR_DAILY` (freeze-on-close).

### 3.6 Persisted stores (following the app's zustand+persist conventions)

```
costCenterStore {
  centers: CostCenter[];                    // seed merged like seedVendors (append-only merge)
  categoryMap: categoryCostCenterMap[];     // category → department defaulting
  expenses: ExpenseEntry[];                 // manual entries with costCenterId or allocation
  allocations?: AllocationResult[];         // after close (phase C)
  addCenter / addExpense / applyAllocations…
}
```

Seeded expenses example (fictional, like seedVendors): rent of the main pharmacy, one salary
entry, electricity — so the report has data immediately.

### 3.7 UI plan (MUI pages, same patterns as `/purchases`)

1. **Cost Centers page** (`/cost-centers`) — MUI `TreeView` of centers with per-node card:
   month selector at top, node shows revenue / COGS / direct expense / result colored
   (green/red like the legacy st_* red-on-focus discipline), click → drill-down table of the
   contributing documents (sale invoices, expenses, allocations).
2. **Expenses page** (`/expenses`) — entry rows (date, vendor?, GL-ish select, amount,
   center or "allocate", basis), history table, per-month list. Direct-charge entries go
   straight into the center's P&L; overhead entries queue for allocation.
3. **Settings additions** — default branch center (route the whole POS), category→department
   map editor, allocation bases per overhead center.
4. **Reports integration** — a "Cost Centers" section in ReportsPage alongside Goods Received:
   table per center + a simple rollup; export later.
5. Explicit **not-in-UBL** note in the code comments: cost centers never go to ZATCA XML —
   invoice-level they don't exist (ZATCA knows branches via branch codes only, which is a
   different concept).

### 3.8 Sync / backup [proposal]

Same best-effort pattern: `costCenterApi.backup*` endpoints for centers/expenses/allocations
queued via `pendingSyncStore`; the local store stays primary like `salesApi`'s pattern.
Phase C along with the server mirror.

---

## 4. Phased roadmap [proposal]

**Phase A — dimension + manual expenses + first report (the recommended start):**
types + seed tree + `costCenterStore` + Expenses page + Cost Centers page reading
`saleStore`/`purchasingStore`/`catalogStore` live. No changes to POS yet except a default
center on new `SaleHeader` entries (backward-compatible optional field). Category map initial
version static in settings.

**Phase B — tagging everywhere + tree rollups corrected:** purchase-invoice `costCenterId`
column + per-line override; category→department map editor; drill-down lists; multi-store
prep (`SaleHeader.branch` etc.).

**Phase C — allocation engine + period close + snapshots + backup endpoints:** allocation
preview/apply, frozen snapshots like `GLCOSTCNTR_DAILY`, server mirror endpoints, export
(e.g. CSV for the accountant).

## 5. Open questions for the owner (before building)

1. **Payroll data**: where do salaries come from — a manual entry page is fine to start, but a
   future payroll feed changes the `ExpenseEntry` shape (headcount counts on each node).
2. **Departments as separate centers or category-report only?** If category-level reporting
   answers the question, we can skip virtual-branch centers entirely (less clutter; my
   recommendation, matching the cashier-friction analysis in 3.3).
3. **Multi-store timeline**: the `SaleHeader.costCenterId` + branch tree is future-proof for
   one store, but confirm whether a second store is realistic near-term — it changes which
   fields are worth adding in Phase A versus later.
4. **Does the accountant expect legacy codes** (10-digit positional) for continuity with
   financial statements, or is the React tree free-form? Both can coexist (the `code` field).

## 6. Verified vs assumed, condensed

**Verified against XPH:** `GLCOSTCNTR` master schema + live 4-level tree of 20 centers with
parent rollup, running balances; `GLCOSTTRN`/`GLCOSTCNTR_DAILY`/`GLLINKCOST`/`FTRANS_COST_GL`
schemas (transaction + snapshot + default-routing concepts). App side: category exists per
item, `SaleHeader`/`PurchaseInvoice` shapes, batch costPrice fidelity from Phase-1 purchase
work.
**Assumed (external practice, no fresh citations this session):** labordominant pharmacy cost
structure, department margin differentials, category-driven defaulting as the retail norm,
allocation-basis menu, contribution-margin-first reporting.
**Proposal (design decisions pending your approval):** tree kinds, seeding, phase order,
allocation engine, UI pages.

---

## 7. Revised against the requirements doc [proposal]

The owner's shared ChatGPT prompt (2026-10-26) fixed the requirements — the answers section of
that document never generated (connection failures in the share), so these four lines are the
requirements contract to design against:

```
Pharmacy type:        chain
Accounting objective: expenses
Branch structure:     multiple
Database environment: SQL Server
```

### 7.1 What changes versus the earlier sections

| Earlier assumption | Requirement | Revised design |
|---|---|---|
| Single store, multi-store "later" | **multiple branches** | Branch tree is a **Phase-A citizen**: seed tree starts with 3+ branches; every document route (sale header, purchase invoice, head-office transfer) carries `costCenterId` from day one, defaulting by "current store" setting |
| Revenue/COGS P&L is the primary report | objective = **expenses** | The first-class report is **"Expenses by cost center"**: per branch/department, direct expense lines + allocated share + expense-to-revenue% as a ratio card; contribution margin follows in the same cube but second |
| Allocation engine deferred to Phase C | expense objective | Allocation of shared overhead (rent/HQ) is **Phase-B**, not C — it's the core of "expenses" accounting |
| Storage = browser-first, mirror later | database = **SQL Server** | Design a SQL Server schema up front (7.2) compatible with the app's best-effort mirror pattern; the local zustand store stays the cash-register source of truth (never blocks on the server), while the SQL tables are the accounting record |

### 7.2 SQL Server schema mapped one-to-one from the React types [proposal]

Chosen deliberately to **mirror the legacy naming** so the accountant's existing GL logic and
any PowerBuilder screens (`w_scrn_cost_center`-style masters in the accounting PBL) can read
the same rows later:

| React type/table | SQL Server table (proposed) | Legacy counterpart [verified] |
|---|---|---|
| `CostCenter` | `GLCOSTCNTR_APP`: `COSTCNO decimal(10) PK`, `COSTNAME_A/E nvarchar(200)`, `COSTLEVEL tinyint`, `COSTMAIN decimal(10)` (parent), `COSTTYPE tinyint` (1=branch 2=activity 3=overhead), `ISACTIVE bit`, `SPACE_SQM`, `HEADCOUNT`, `CODE varchar(20)` human code | `GLCOSTCNTR` [verified schema] — same columns, APP suffix avoids colliding with the live system |
| `ExpenseEntry` | `GLCOSTTRN_APP`: `GLCOSTSEQ` + `GLCOSTLINE` (PK pair), `BRANCH_NO`, `GLCOSTACCT` (nullable until GL module exists), `GLCOSTDATE`, `GLCOSTDISCP` description, `GLCOSTAMT decimal(16,5)`, `GLCOSTTYPE` (1=direct 2=allocatable 3=allocation-applied), `COSTCNO` target, `RECURRING_ID nullable` | `GLCOSTTRN` [verified schema] |
| `AllocationResult` | appended rows to `GLCOSTTRN_APP` with `GLCOSTTYPE=3` + `SOURCE_EXPENSE_SEQ` link — negative rows on the overhead center, positive on targets | — (legacy keeps overhead rolled up instead; we keep both by kind) |
| monthly snapshot | `GLCOSTCNTR_DAILY_APP`: `FDATE`, `GLCOSTNO`, `GLCOST_BALANCE`, `TOTAL_DEBIT/CREDIT_TRANS/AMOUNT` | `GLCOSTCNTR_DAILY` [verified schema] |
| default routing | `GLLINKCOST_APP`: document/account → default `COSTCNO` | `GLLINKCOST` [verified schema] |

Key decisions carried into SQL:
- **decimal(16,5) money** everywhere, same as the legacy, so accountants see familiar figures;
  the app's own round3/round2 rules live only at the display layer.
- Idempotent posting: an expense gets a stable `ExpenseEntry.id` (app-side GUID) carried as a
  unique key on the mirror so retry-queue replays (the pendingSyncStore pattern) can't
  double-post — the legacy guard `GLCOSTPOST` (draft→posted) becomes our server-side status.
- Hierarchy integrity: `CHECK (COSTCNO <> COSTMAIN)` + a recursive CTE maintenance query for
  cycle-detection on update, because the web UI will allow moving nodes.

### 7.3 PowerBuilder screen design (for the accounting-side build) [proposal]

The requirements doc asked for PB screens; items the existing SCR-style windows should get:
`w_scrn_cost_center_master` (tree master + bilingual names, per-branch space/headcount),
`w_scrn_cost_expense_entry` (per-line; F-key insert like the purchase-invoice line flow —
the same F1–F8 / me-flag discipline observed in `w_scrn_pur_invoice_1`), and
`w_scrn_cost_allocation_preview` (apply/preview toggle before commit). Also persists the
"posted invoices are history" rule with a reconciliation-period lock like the legacy's pos-128
parameter ((analogue already used by purchase invoices)).
If the user wants these built in PowerBuilder, the React app merely mirrors tables — the two
stacks can share the SQL Server layer; nothing in the React design must change.

### 7.4 Revised phased roadmap

**Phase A (revised) — chain tree + expense entry + "Expenses by center" report:** types +
multi-branch seed tree + `costCenterStore` + Expenses page (direct + allocatable) + report
page with per-branch cards and rollup; purchase-invoice & sale-header optional
`costCenterId` columns land here (default = settings' current branch), keeping POS friction
at zero.

**Phase B — allocation engine + category map + drill-downs:** allocation preview/apply
(revenue/headcount/space basis), category→department editor, document drill-downs, headcount
fields on branches (salary allocation).

**Phase C — period close + snapshots + SQL Server mirror + reports export:** monthly close
freezing snapshots (`GLCOSTCNTR_DAILY_APP`), best-effort mirror endpoints through the existing
`pendingSyncStore` queue, CSV export for the accountant.

Open question from before that the requirements doc already answers: **multi-store timeline =
confirmed near-term** (chain) — no longer a blocker. Still open: payroll feed (manual OK to
start), and department-level centers vs. category-map only.

---

## 8. Integrating the "Pharmacy Chain Cost Center System — Complete ERP Design" document
[verified where it touches XPH; adopted design marked per item]

The owner supplied a complete third-party ERP design (SQL Server schema `cc.*`, allocation
engine with driver bases, DRAFT→VALIDATED→APPROVED→POSTED→REVERSED batch workflow, validation
matrix, five reports, role/security matrix, six-phase implementation plan, acceptance
criteria). It is adopted as the **reference architecture** for everything the React app can
carry, with one important correction and several completions this session made against the
live XPH database. Its own final open question was: *"If you share the table and column names
for the GL journal header, GL journal details, chart of accounts, branch master, and fiscal
periods, I can adapt the schema…"* — answered below from `xph` (2026-10-26).

### 8.1 The illustrative SQL names mapped to the REAL legacy tables [verified]

| Design doc's illustrative table | REAL XPH table/columns | Notes |
|---|---|---|
| `COMPANY` | `FAPPL_TYPE` + `FAPPL_SUB` on every table; `YCOMPNO` in periods | company is a numeric key, not a table |
| `BRANCH` | `HSYSTEM_BRANCH` (`CUST_TYPE`, `CUST_NO`, `FBRANCH_NAME_A/E`, `FMUILTI_STORE`, `LOCK_FLAG`) | **branches are stored as customer-type records**, same key scheme as vendors (section 3.4 of ANALYZE_PURCHASE.md) |
| `GL_JOURNAL` (header) | `GLJRNHDR` (`GLJRNYEAR`+`GLJRNCOD`+`GLJRNSEQ` PK; `GLJRNREF`, `GLJRNDATE`, `GLJRNTOTDBT/CRD*`, `GLJRNPOST`; **plus `FRAPPL_TYPE`/`FRTRANS_TYPE`/`FRTRANS_NO` source-transaction link** — the audit provenance the design doc demands) | |
| `GL_JOURNAL_LINE` | `GLJRNDTL` (`GLJRNLINE`, `GLJRNACCT`, `GLJRNDISCRP`, `GLJRNAMT`, `GLJRNTYPE` d/c, `GLJRNPOST`, **`GLCOSTNO decimal(10)` — the per-line cost-center code ALREADY EXISTS**) | **The design's central integration requirement ("every eligible GL expense journal line carries a valid cost center") is already built into the legacy schema** |
| `GL_ACCOUNT` / chart of accounts | `GLACMAST` (`ACCNO`, `ACCMAIN` parent, `ACCLEVEL`, `ACCTYPE`, balance columns) — same hierarchical pattern as GLCOSTCNTR | |
| fiscal calendar | `GLPERIOD_HDR` (`YCOMPNO`,`YYEAR`,`YCURPRIOD`,`YCURSTATUS`,`YDURATION`) + `GLPERIOD_DTL` (`YPERIOD_SEQ`, `Y11DESCRIP`, `Y11INTDATE`, `Y11ENDDATE`, `Y11STATUS`) + `HPERIOD_NAME` (bilingual period names) | period status supports "closed accounting period" validation |
| budget | `GLBUDGET_HDR`/`GLBUDGET_DTL` (`BACCNO`+`BYEAR`+`BDUGET_SEQ`, `BBDGTBAL`, `BSTATUS`) | **gap confirmed: budget is per ACCOUNT + YEAR only — no cost-center and no per-branch dimension.** The design doc's `cc.CostCenterBudget` (center × account × period × version) is the right extension; legacy budgets cannot answer "Riyadh branch overspent on rent" |
| user-branch security | `user_branch_table` (`fuser_id`, `FAPPL_SUB_DEFAULT`, `fprofile_type/id/seq`, `LOCK_FLAG`) | the "restrict access by company and branch" requirement has a live framework |
| cost center actuals | — | legacy keeps totals ON the master (`COSTBAL`, `COSTDRAMTOT`…) rather than deriving them; the design doc explicitly warns against "an independent cost-center actuals total that can drift from the GL" — its deriving-from-journal-lines rule is the correction to adopt |

### 8.2 Design decisions reconciled [proposal]

1. **Adopt wholesale from the design doc:** allocation-rule + targets schema
   (`FIXED_PERCENT/HEADCOUNT/FLOOR_AREA/USAGE/DIRECT_COST` bases), deterministic rounding with
   remainder assignment, batch workflow states + posted-batch immutability + reversal with
   reason/authorization, duplicate-allocation prevention (idempotency), the validation matrix
   (100% rule, self-parenting/cycle checks, closed-period block, rowversion conflicts,
   `IsPostingAllowed`/inactive-center blocks), bilingual everything, the five reports, the
   role matrix, and the six-phase acceptance criteria.
2. **Budget: new dimension, old style.** The React app models
   budget = (costCenter × expenseAccount × period × version, status DRAFT→APPROVED→SUPERSEDED)
   mirroring `cc.CostCenterBudget`, while keeping column naming DNA of `GLBUDGET_*`
   (`BSTATUS`, amounts decimal(16,5)) for accountant familiarity.
3. **Actuals never duplicated.** The React report derives actual expenses from tagged
   transactions (saleStore/purchasingStore/manual expense entries) — and once GL integration
   exists, from `GLJRNDTL` where the expense lines carry `GLCOSTNO` — never from a stored total.
   Legacy's on-master totals stay as a cache that the close procedure refreshes, not as truth.
4. **Where React sits relative to the legacy GL:** two integration options, decision pending:
   - **Option 1 (safe):** React keeps its own `_APP` mirror tables (§7.2) and the report
     reconciles; no writes to live legacy tables.
   - **Option 2 (deep):** React writes expense entries straight into `GLJRNDTL`/`GLJRNHDR`
     (with `GLJRNTYPE/GLJRNPOST` workflow, `GLCOSTNO` mandatory on expense lines) — the legacy
     journal already has the source-link columns (`FRTRANS_*`) for traceability, but this
     needs the accounting team's sign-off on numbering (`GLJRNCOD/GLJRNSEQ`) and posting codes.
5. **Cash-register-only truths** (batch costPrice fidelity, round3 costs, bonus dilution) stay
   untouched: the cost-center module consumes them, never re-derives them.

### 8.3 Final phased roadmap (absorbing all three sources) [proposal]

| Phase | Contents | Source |
|---|---|---|
| **A** | **✅ DONE (2026-10-26).** Cost-center tree master (bilingual, parent/child, IsPostingAllowed, effective dates) + expense entry (direct/allocatable) + "Expenses by center" report from existing stores. Built as: `src/types/costCenters.ts`, `src/utils/costCenters.ts` (pure tree/printing/validation/rollup), `src/utils/costCenters.test.ts` (14 tests), `src/store/costCenterStore.ts` (persist + seed-append merge), `seedCostCenters` in `src/utils/seedData.ts` (HQ + branch + activity centers incl. an inactive closed kiosk), `CostCentersPage.tsx` + `ExpensesPage.tsx` (routes `/cost-centers`, `/expenses`), `costCenterId` on `SaleHeader` (POSPage auto-tags from `settings.costCenterId` — zero POS friction) and on `PurchaseInvoice` (picker defaulting to the register's branch, shown in history), settings backfilled via a merge. `npm run build` ✅ · 81/81 tests ✅ · lint: no new findings | my §4/§7.4 + doc's "start with master + expense report" recommendation |
| **B** | Tag all documents (`costCenterId` on SaleHeader/PurchaseInvoice/transfer), category→department map, branch-vs-center separation (a branch is a location, a center the accountable unit — doc §1.2) — **B.1 ✅ DONE (2026-11-01)**, see §9.1.1: category map keyed on normalised free-text category, per-line `SaleLine.costCenterId` snapshot at checkout, `spaceSqm`/`headcount` drivers, exception reporting on `/category-map` + `/expenses`; B.2 (transfer + `PurchaseLine.costCenterId`) and B.3 (drill-downs) still open | doc §1.2's key design decision + my §3.2 |
| **C** | Budget entry + approvals + **budget-vs-actual** + expense trends (unassigned-expense exception report from day one) | doc phases 3–4 |
| **D** | Allocation engine: rules + drivers + preview + reconciliation + DRAFT→VALIDATED→APPROVED→POSTED + reversal, duplicate-run prevention | doc phase 5 + my §3.5 |
| **E** | Period close, `GLCOSTCNTR_DAILY`-style snapshots, audit history, SQL Server mirror deployment, role matrix enforcement | doc phases 5–6 + my Phase C |

The design doc's recommended starting set (Master + Expense GL Integration + Monthly Expense
Report + Budget-vs-Actual) matches my A→C ordering; allocation is deliberately *after* reliable
classification — same conclusion, preserved.

### 8.4 Acceptance criteria (inherited verbatim as the definition of done)

1. Every eligible posted expense assigned to a valid cost center or appearing in an exception
   report.
2. Branch/company totals reconcile with the GL.
3. Allocation debits/credits balance exactly including rounding.
4. Re-running a posted allocation cannot create duplicates.
5. Approved budgets and posted transactions cannot be silently edited.
6. Branch managers see only authorized data.
7. Deactivating a cost center does not remove historical reporting.
8. Reversals and corrections retain a complete audit trail.

---

## 9. Build specs for the held phases (B–E) [proposal]

Phase A shipped in 2026-10-26 (§8.3 row A) and already covers some of what earlier rows filed
under "Phase B" — `costCenterId` tagging on `SaleHeader` (auto, zero POS friction) and
`PurchaseInvoice` (header picker + history column), the unassigned-exception baseline, and the
active-tree guards in `costCenterStore`. §9 therefore **re-baselines** the held phases against
what actually exists, and spells each one out at build-detail level (files, shapes, workflow,
validations, tests, acceptance mapping) so the next working session can start coding without
re-deriving any decision. Statuses stay [proposal] until each phase is built.

### 9.1 Phase B — Expense classification + the remaining tagging + drill-downs [B.1 built, see §9.1.1]

**Objective:** every expense source flows to the right center without manual rekeying; the
tree grows the driver fields the allocation engine (Phase D) will consume.

**Remaining scope (after A):**

| Item | Detail |
|---|---|
| Category → center map | `CategoryCenterMap { categoryId: string; costCenterId: string }` entries in `costCenterStore` (persisted, merged same style) + an editor tab on the `Expenses` page (or its own sub-page). Sale lines then carry an optional `costCenterId` snapshot at checkout, derived from the line item's `category` — this is the "department reporting" answer to the open question, so **no separate department-level centers are created** unless the map genuinely needs one. |
| Transfer tagging | `costCenterId` on the head-office receiving/transfer document (the `ReceivingEvent` already knows `source: 'head_office'`); the receiving branch is the default tag. |
| Per-line center override on purchase invoices | Optional `PurchaseLine.costCenterId` for invoices that supply several branches at once; a may-be-split workflow ("tag tree, split by %") is deferred until invoices actually arrive multi-branch — never invented complexity. |
| Drill-downs | From the "Expenses by Cost Center" row and the tree page: a center's linked documents (its tagged sales, purchase invoices, transfer events, expense entries) listed read-only in a dialog — the first read-only audit trail, no new store. |
| Driver fields | Optional `spaceSqm` and `headcount` on `CostCenter` (the SQL mirror's `SPACE_SQM`/`HEADCOUNT`, §7.2); editable on the Cost Centers page for active branches. They stay informational in B; Phase D reads them as allocation drivers. |
| GL account label | Promote `expenseAccount` from free label to an editable account list (name + optional legacy `ACCNO`) once the accountant supplies the chart fragment — until then nothing changes. |

**Files touched:** `types/costCenters.ts` (map type + optional center fields), `store/costCenterStore.ts` (map + moves editor), `src/components/CostCenters/*`, `POSPage`/checkout pricing path (category defaulting), `types/sales.ts` (line-level optional field). **Validation additions:** map targets must point to active posting branches when saved; a line-level override follows the same `isPostingOpen` rule.

**Acceptance:** 1 (exceptions gain the "mapped but unmapped category" bucket), 6 preparation.

#### 9.1.1 Status — B.1 shipped 2026-11-01 [built]

Phase B is too large for one sitting, so it was split **B.1 (classification core) → B.2 (transfer/purchase-line
tagging) → B.3 (drill-downs)**. B.1 is built in both projects (124/124 tests, clean build, lint exit 0) and
verified live against the seed data.

| B.1 item | Where | Notes |
|---|---|---|
| `CategoryCenterMap` + `spaceSqm`/`headcount` types | `types/costCenters.ts` | |
| `normalizeCategoryKey`, `resolveCenterForCategory`, `observedCategories`, `categoryMapExceptions`, `unmappedCategoryRevenue` | `utils/costCenters.ts` | pure, store-free, unit-tested |
| `categoryMap` + `setCategoryMapping` / `clearCategoryMapping` / `setDrivers` | `store/costCenterStore.ts` | upsert-by-key; guards below |
| `/category-map` page + nav item | `components/CostCenters/CategoryMapPage.tsx` | mapping table, three exception buckets, coverage chip, revenue-at-risk |
| Drivers dialog | `components/CostCenters/CostCentersPage.tsx` | "Drivers" button on non-overhead nodes only |
| Per-line stamping at checkout | `components/POS/POSPage.tsx` | `SaleLine.costCenterId` written from the map, header tag unchanged |
| Line-level revenue attribution + exception lines | `components/CostCenters/ExpensesPage.tsx` | `line.costCenterId ?? inv.costCenterId` |

**Deviation from the sketch above (adopted, see §10.5):** the map is keyed on
`normalizeCategoryKey(Item.category)` — `trim` + casefold + collapse inner spaces — **not** on a
`categoryId`. `Item.category` is free text and the seed already ships nine spellings including `XPH`
(a data-source tag, not a therapeutic category), so a category master would be a migration with no
reporting benefit. `categoryLabel` keeps the accountant's spelling for display. Consequence: a rule
is written for a category that **actually exists** in the item master (`observedCategories`), never
from a hard-coded list.

**Guards actually shipped (store level, so future feeds get them too):** a map target must be
non-overhead, active and posting-allowed; `setDrivers` rejects overhead pools, negatives and NaN.
A rule pointing at a centre that later closes does **not** keep posting — `resolveCenterForCategory`
falls back to the store centre and raises a note, and `categoryMapExceptions` reports it as a
stale target. Nothing throws at checkout: a stale map must never block a sale (§9.4).

**Snapshot semantics (verified live):** invoice 1 was issued while Baby Care mapped to `BR001-OPS`;
the rule was then changed to `BR001-INS` and invoice 2 issued. Invoice 1's lines still report
under `BR001-OPS`, invoice 2's Baby Care line under `BR001-INS` and its unmapped Analgesics line
under the `BR001-OPS` header fallback (report 57.00 / 48.00, 9.00 SAR flagged as on the branch
default). Editing a rule therefore never rewrites history.

**Still open in Phase B:** transfer tagging, `PurchaseLine.costCenterId` (B.2), drill-down dialogs
(B.3), and the GL account list (blocked on the accountant's chart fragment).

### 9.2 Phase C — Budgets + budget-vs-actual + trends

**Objective:** approved monthly budget per (center × expense account × period), versions you
can audit, and the variance report the design doc made a core requirement.

**Model:**

```ts
interface CostCenterBudget {
  id: string;
  costCenterId: string;
  expenseAccount: string;            // joins the same account labels the ExpenseEntry uses
  year: number;                      // legacy GLBUDGET_DTL.BYEAR DNA
  month: number;                     // 1..12; period lock arrives with Phase E
  amount: number;                    // round2, display-money convention
  version: number;                   // 1..n - an approved budget is never silently edited
  status: 'DRAFT' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
  approvedBy?: string; approvedAt?: string;
  createdBy: string; createdAt: string;
}
```

- **Workflow:** rows born `DRAFT`; approve locks that version and flips the previous approved
  version of the same key to `SUPERSEDED` (only one live approved version per key). Variance
  reporting reads the live approved version only — mirrors `cc.CostCenterBudget`'s version rule
  from the design doc, the fix for the verified legacy budget gap (`GLBUDGET_*` is account+year
  only, no center, §8.1).
- **UI:** budget entry grid on a new `/budgets` page (month selector, one row per center ×
  account; numbers editable in DRAFT, read-only otherwise) + approve button per row requiring a
  logged-in name (authStore session; branch-manager role restriction is Phase E's matrix).
- **Reports:** **Budget vs Actual** (per center × account: budget, actual = derived expense
  entry sums, remaining, variance %; budgetless-actuals and un-budgeted-approved rows both
  shown, like the design doc's SQL), and **expense trends** (monthly totals per center across
  the year, bar chart or simple table first).
- **Files:** `types/costCenters.ts` (+budget), `store/costCenterStore.ts` (+budget actions:
  upsertDraft, approve, revise), `components/CostCenters/BudgetsPage.tsx` + route, report
  section extends "Expenses by Cost Center" or a second tab. **Tests:** variance math, one
  live approved version per key, approving twice not creating duplicate SUPERSEDED churn.

**Acceptance:** 5 (no silent edit path exists — approve/revise only).

### 9.3 Phase D — The allocation engine

**Objective:** distribute approved shared (allocatable) expenses from overhead centers to the
branches on documented, rule-driven bases — with exact balance and idempotency.

**Model (matching §7.2's mirror plan):**

```ts
type AllocationBasis = 'FIXED_PERCENT' | 'HEADCOUNT' | 'FLOOR_AREA' | 'USAGE' | 'DIRECT_COST';

interface AllocationRule { id, code, nameEn, nameAr, sourceCostCenterId, basis,
  targets: { costCenterId, percent }[], effectiveFrom, effectiveTo?, isActive, createdAt }
interface AllocationBatch { id, batchNo, period (year+month), status: 'DRAFT' | 'VALIDATED'
  |'APPROVED'|'POSTED'|'REVERSED'|'REJECTED', ruleId, sourceExpenseIds: string[],
  sourceAmount, allocatedAmount, createdBy, approvedBy?, postedAt?, reversedFromId? }
```

- **Deterministic distribution:** per target, share = round2(source × driver_i / Σdrivers);
  the **rounding remainder is assigned deterministically** (largest-fractional-part target
  first, ties broken by target id sort) so Σallocations === sourceAmount **exactly** — the
  rule the design doc demanded and the same arithmetic discipline Phase 1 gave tier discounts.
- **Posting:** a POSTED batch appends `ExpenseEntry` rows in the local store — negative
  `allocated` rows on the source overhead center, positive on each target — each carrying
  `sourceExpenseIds` links. This requires the planned `ExpenseKind` extension to add
  `'allocated'` (Phase A's type comments already anticipate it; the totals utility then counts
  `allocatable` and `allocated` as moving, not double-counting, per the design doc's
  anti-double-count §5.3).
- **Duplicate-run prevention (idempotency):** a batch may be created only once per
  (source center × batch scope) while an earlier non-reversed one exists; POSTED is immutable;
  corrections go through reversal with reason + authorization + `reversedFromId` — acceptance
  criteria 3, 4, 8.
- **Workflow screens:** preview (per-rule table: driver, %, amount), validate (100% rule for
  FIXED_PERCENT; nonneg drivers with positive total), approve, post, reverse — the
  DRAFT→VALIDATED→APPROVED→POSTED→REVERSED chain, mirroring the worked example in the ERP doc
  (IT 20,000 → 10,000/6,000/4,000).
- **Files:** `types/costCenters.ts` (rule/batch/kind), `store/costCenterStore.ts` (+rules,
  +batches, +posting algorithm or a `utils/allocation.ts` for the pure math), `utils/allocation.test.ts`
  (exactness incl. remainder edge cases, double-run refusal, reversal audit), `components/CostCenters/AllocationsPage.tsx` + route.
- **Validation matrix hits:** closed-period block comes from Phase E; until then the batch's
  own period gates posting.

**Acceptance:** 2, 3, 4, 7, 8.

### 9.4 Phase E — Period close + snapshots + SQL Server mirror + role matrix

**Objective:** make history frozen, the accountant's SQL Server record real, and access
scoped — closing the loop with the verified legacy machinery.

| Item | Detail |
|---|---|
| Period lock | `costPeriods` in `costCenterStore` (or settings): month/year + status `OPEN/CLOSED`; posting paths (`addExpense`, budget approval, allocation POST) refuse a closed period. The analogue of `GLPERIOD_DTL.Y11STATUS` [verified]. Closing a month runs the freeze, below. |
| Close + snapshots | On close, `expenseTotals`' derived numbers are written as `CostCenterSnapshot { period, centerId, direct, allocatable, allocated, subtree, capturedAt }` — the GLCOSTCNTR_DAILY analogue [verified schema] — stored totals allowed ONLY as the close-time cache, never as running truth (§8.2.3 rule restated). |
| Server mirror | Best-effort endpoints for `GLCOSTCNTR_APP` / `GLCOSTTRN_APP` / `GLCOSTCNTR_DAILY_APP` (§7.2), queued through the existing `pendingSyncStore` pattern — the app must never fail or block because the server is down; replay is safe because the app-side `ExpenseEntry.id` / batch id is the mirror's unique key (no double-post). |
| Export | CSV export of the expense-by-center and budget-vs-actual reports for the accountant's walk to Excel/accounting. |
| Role matrix | Read-only enforcement client-side per authStore session (branch manager sees own branch's tagged documents/reports; accountant/finance roles unrestricted), mirroring the design doc's matrix and `user_branch_table`'s live concept [verified] — full server-side enforcement only exists when the mirror does. |
| Audit history | Every stored change (center, budget, batch) gains an append-only `AuditLog { entity, entityId, action, before/after summary, by, at }` — criterion 7/8's full realization. |

**Files:** `store/costCenterStore.ts` (+periods, +snapshots, +audit), `server/` mirror endpoints
(following the existing sales/receiving backup API pattern), Settings page period-lock UI,
report exports, tests for close-freeze reproducibility and period-lock refusals.

**Acceptance:** 2 (via mirror reconciliation), 6, and completes 1/7/8 hardening.

### 9.5 Sequencing note and still-open questions

Recommended order stays **B → C → D → E** (classification before budgets before allocation,
close/mirror last) — unchanged from §7.4/§8.3 because the ERP doc's six implementation phases
and the "reliably classified first, allocate after" recommendation both say the same. Still
open, unchanged from §5/§7: (1) payroll feed source (manual entry until then), (2) whether the
accountant wants legacy GL account numbers wired to `expenseAccount` at Phase B or waits for
the GL integration, (3) rounding-remainder tie-break policy sign-off (ties break by target id
default), and (4) which PowerBuilder screen, if any, hits the `_APP` tables first.

## 10. External research & citations [reference, appended 2026-11-01]

**Why this section exists.** §1–§9 were argued from the legacy XPH system [verified] and from the
owner's requirements. They were never checked against how established systems actually model cost
centres. On 2026-11-01 the design was compared against two large ERP suites (SAP S/4HANA
Controlling, Microsoft Dynamics 365 Finance) and against standard management-accounting
literature. This section records what was found, cites it, and states for each finding whether it
**confirms**, **changes**, or **does not affect** what is already written above. Nothing here
overrides §7/§8; where a finding changes the build spec it is tagged **[change adopted]** and the
affected subsection is named.

**How to read the tags.** `[verified]` keeps its §2 meaning: read out of the live XPH system.
Citations like `[3]` are external published sources, listed in §10.10 — evidence about *practice*,
never evidence about what XPH does. Items marked `[proposal]` are not built yet.

### 10.1 Findings at a glance

| # | Finding | Source | Effect on this design |
|---|---|---|---|
| 1 | A cost centre is a **responsibility unit judged on costs only**, normally by budget-vs-actual — not a location, not a profit unit | [1] [2] | **Confirms** §1.2/§3.1: `CostCenter` is deliberately a separate dimension from the branch location |
| 2 | Centres split into **operating (production) and service** centres; service-centre costs form a pool that is allocated to the units it serves | [1] [2] [11] | **Confirms** §3.5 and the `kind: 'branch' \| 'activity' \| 'overhead'` + `ExpenseKind: 'allocatable'` split |
| 3 | **Controllability principle**: judge a manager only on what they control; keep traceable costs separate from allocated common costs | [13] [12] | **[change adopted]** §10.3 — new reporting rule for the variance/scorecard view |
| 4 | Every centre must belong to **one global standard hierarchy** used for both reporting and allocation | [3] | **Confirms** the single-tree model; adds the "no orphan centre" validation rule |
| 5 | Master data is **time-sliced (validity periods)** rather than overwritten | [3] | **Confirms** `effectiveFrom` / `effectiveTo` already in `CostCenter` |
| 6 | Referenced dimension values are **never deleted** — only renamed or suspended | [5] | **Confirms** the absence of a hard delete; `isActive` is the only off-switch |
| 7 | Dimension values are **capped in length (30 chars)** and entity-backed values are edited at their **source master**, not in the dimension table | [4] | **[change adopted]** §10.5 — validation + naming rules |
| 8 | Budget = plan → **budget register entries** (revisions, transfers, carry-forward) → optional control, **hard (block) or soft (warn)**; a rolling forecast is recurring budget-vs-actual | [6] | **[change adopted]** §10.8 — Phase C gains transfers, control mode, carry-forward |
| 9 | Period close = finish subledgers → post → allocate → set the period to **On hold**; never **Permanently closed** | [7] | **[change adopted]** §10.8 — `CLOSED` must be reopenable with an audit row |
| 10 | Allocation bases must follow **causality/benefit**; sales- and profit-based bases distort results | [8] | **[change adopted]** §10.7 — default base per overhead type |
| 11 | **Step-down** is order-dependent and skips reciprocal flows; **reciprocal** is the accurate but heavy option | [9] [10] | **[considered, rejected]** §10.7 — stays direct-method only |
| 12 | Cost centres can be finer than a department (a machine, a position) but that "requires more detailed information tracking, and so is not commonly used" | [2] | **Confirms** the decision not to tag per cashier/till (§10.4) |

### 10.2 Cost centre vs profit centre vs responsibility centre

The literature is consistent and blunt: the manager of a cost centre "is not responsible for
revenue generation or asset usage", and performance is "usually evaluated through the comparison of
budgeted to actual costs" [2]. Wikipedia's definition matches — the centre's manager and staff "are
not accountable for the profitability and investment decisions of the business but they are
responsible for some of its costs" [1].

Responsibility accounting then classifies centres three ways — **cost** (costs only), **profit**
(revenues *and* costs), **investment** (revenues, costs and assets) — and names the controllability
principle as its "cornerstone" [13]. Lumen's managerial-accounting chapter frames the same ground
with the same deliverables we already committed to: identify cost centres, prepare a responsibility
report for a cost centre, allocate indirect expenses to departments, and prepare *departmental
contribution margin* income statements [12].

**What this confirms.** The owner's objective is expenses, so the chain's branches are cost centres
for this module. That is exactly why §3.1 refuses to make `CostCenter` a synonym for "branch": one
branch holds several accountability centres (operations, facilities, insurance desk), and
head-office pools live elsewhere until allocation.

**The trap it warns about.** Because the POS already tags revenue with `costCenterId` (§7.4), it is
tempting to relabel branches as *profit* centres and start judging branch managers on margin. The
sources say this is a category error unless the manager genuinely controls pricing, purchasing and
stock investment [13]. **[change adopted]** — the reporting language and the scorecard stay
cost-based. Revenue remains available for the contribution view in §3.4, but nothing in the UI
scores a branch manager on profit.

### 10.3 Controllability: what a branch manager may actually be judged on [change adopted]

> "Managers should be evaluated only on factors they can control or significantly influence." [13]

The same source lists why this is hard in practice: **shared responsibility** (several managers
influence one cost), **external factors** (market conditions move "controllable" items), and
**time horizon** (short-run vs long-run controllability differ) [13]. It also states the rule our
contribution-margin model depends on: "common costs allocated to segments should be distinguished
from directly traceable costs for fair evaluation" [13].

This matters here because Phase D will *create* expense rows: a posted allocation batch writes
negative `allocated` rows on the overhead centre and positive ones on each branch (§9.3). If those
rows land in the branch's variance numerator, every branch's "overspend" is really a head-office
policy decision, and the report becomes an argument instead of a control.

**Adopted rule (reporting contract, Phase C/D):**

1. A centre's **controllable variance** uses only `direct` expenses booked to that centre.
2. `allocated` rows never enter that variance. They render in their own column — *Allocated
   overhead* — with the batch number and the rule that produced them, so the number is auditable
   but not arguable.
3. Subtree rollups (`expenseTotals`) may total direct + allocated for the chain P&L, but the
   drill-down must keep the two labelled separately end-to-end (§8.2.3's stored-vs-derived rule
   applies to the *split*, not just the sum).
4. No allocation may change a centre's `kind` or create a posting fault the manager cannot fix.

### 10.4 Hierarchy: one global tree, and why the leaves stop at department level

SAP's rule is unambiguous: the standard hierarchy "is a structure to which **all** cost centers
within the controlling area are assigned", it may be organised "by areas of responsibility,
functional requirements, allocation criteria, geographic, locations, and so on", and it is "a global
hierarchy, which you can use for reporting and allocations" [3]. Every centre created in that
controlling area must be attached to it [3].

That is the same shape as the legacy 4-level `GLCOSTCNTR` tree [verified] and the same shape as the
`parentId` tree in §3.1 — so the model needs no change. Two things are added:

- **No orphan centre (validation).** `addCenter` already rejects unknown parents, self-parenting
  and cycles (`assertParentValid`). It must also reject a centre whose parent chain does not
  terminate at a root, so "assigned to the standard hierarchy" holds by construction rather than by
  convention. `[proposal]`
- **The root is a reporting node, not a posting node.** The same rule SAP expresses through posting
  locks [3] is already expressed here by `IsPostingAllowed: false` on rollup parents.

On granularity, AccountingTools is explicit that a centre *can* be smaller than a department — "a
particular job position, machine, or assembly line" — but that this "requires more detailed
information tracking, and so is not commonly used" [2]. **Confirms** §7.4: the cashier is never
asked a cost-centre question, and there is no per-till or per-employee centre. Branch → department
is the leaf depth.

Wikipedia's operating-vs-service split [1] maps directly onto the existing `kind` union, and that
mapping is the whole reason the allocation engine can be simple:

| Wikipedia / SAP concept | This app | Behaviour in Phase D |
|---|---|---|
| Production / operating centre | `kind: 'branch'`, `kind: 'activity'` | **Receives** allocations; never a source |
| Service centre | `kind: 'overhead'` | **Source** of a pool; never a target (§10.7) |

### 10.5 Dimension modelling: what to copy from Dynamics 365, and what not to

D365 models cost centres as *financial dimensions*. Two types exist: **custom** dimensions
(maintained by hand, "always shared across legal entities") and **entity-backed** dimensions whose
values are defined elsewhere — for example in Customers or Stores — and which therefore can't be
created or edited from the dimension page at all: "you can't create dimension values from the
Financial dimension values page. You also can't edit the dimension value and descriptions from
within the page" [4]. Dimension values are capped at **30 characters**, and account + dimension
combinations are checked on a dedicated *Dimension data validation* page rather than by eye [4].

Three rules follow, in decreasing order of importance:

1. **`code` is a dimension value — treat it as one.** Cap it at 30 characters and require
   uniqueness among active centres; reject edits that would collide instead of silently allowing
   duplicates. `[change adopted — validation in addCenter and in any future edit action]`
2. **Do not retype a branch's name into the centre row.** D365's entity-backed dimensions exist
   precisely because duplicating a source master's labels guarantees drift [4]. Today
   `CostCenter.nameEn/nameAr` are typed in even for `kind: 'branch'`. Keep the typed copy for now
   (the branch master is the POS "current store" setting, not a real table), but §7.2's SQL mirror
   must record the branch key so a future join can override the label. `[proposal — documented
   duplication, not yet removed]`
3. **Never let a dimension become the company structure.** D365 deliberately keeps dimensions
   separate from legal entities and only *overrides* a value's activity per legal entity and period
   [4]. Same rule here: a `CostCenter` is a reporting tag, never an accounting entity, never a
   licence, never a VAT registration. The mirror tables stay `_APP`-scoped (Option 1, §8).

**Explicit non-goal.** D365 supports arbitrary multi-dimension combinations (cost centre +
department + project + purpose, all on one line). This app needs exactly **one** dimension. Building
a generic dimension framework would double the schema and the UI for a requirement that does not
exist — and the legacy system has one 4-level tree [verified]. Rejected.

### 10.6 Master-data governance: never delete, time-slice instead

Both suites arrive at the same rule from different directions.

Microsoft: "To protect data integrity, the system restricts deletion of both financial dimensions and
their values. In most cases, you can't delete these elements once they're referenced." The
prescribed alternatives are to **rename** the value to mark it unusable (e.g. `___DONOTUSE_…`) or to
**suspend** it. Suspension "prevents it from being used on new transactions", and "suspended values
are hidden from lookups but can be renamed and reused later" [5]. The same page adds a detail worth
copying: "You can't delete a financial dimension once you use it in any of the following, **even if
you later remove the reference**" [5] — history, not current usage, is what makes a value
undeletable.

SAP: time-based fields are handled with **validity periods** — to keep the history of a cost
centre's responsible person up to year-end, "you create a new validity period for the cost center
starting next year" instead of overwriting the field [3]. And the mandatory **Cost Center Category**
"groups cost centers with the following common settings" including the **lock indicators** for
whether quantity values, primary costs, secondary costs, revenue and commitments may be posted
[3].

**What this confirms.** `CostCenter.isActive` is the right off-switch and there is (correctly) no
delete action anywhere in the module. `isPostingOpen()` already enforces the SAP-style lock: no
posting to an inactive centre, outside `effectiveFrom`/`effectiveTo`, or with
`IsPostingAllowed: false` — the store rejects it rather than the page, so future payroll/GL feeds
inherit the guard for free.

**What is still missing `[proposal]`:**

| Gap | Why it matters | Fix |
|---|---|---|
| Deactivation records no reason or timestamp | Once a centre is off, nobody can say when or why — the audit trail the accountants are used to | `deactivatedAt?: string`, `deactivationReason?: string` on `CostCenter`, written by the same action that flips `isActive` |
| `kind` can be changed on a centre that already has expenses | SAP's category carries the posting-lock defaults, so changing it retroactively changes what was allowed [3] | Treat `kind` as immutable once the centre has ≥1 expense row (UI disables it; store rejects it) |
| No rename-for-disuse convention | Trends read better when a retired centre is obviously retired | Prefix the display name on deactivation, keep the code and id untouched (§5.3 anti-rename-of-keys rule) |
| Hard delete exists nowhere (good) but also no explicit test | A future refactor could "helpfully" add one | Regression test: deactivating keeps every historical expense resolvable and totals unchanged |

### 10.7 Allocation method: direct first, step-down as an upgrade, reciprocal never

The three textbook methods, and what they actually do:

| Method | Flow allowed | Cost | Accuracy |
|---|---|---|---|
| **Direct** | service → operating only | trivial | ignores services consumed by other services |
| **Step-down** | service → other services (in ranked order) → operating | moderate; **order-dependent** | better, but never allocates back to a department that has already closed out [9] [10] |
| **Reciprocal** | both directions, solved as simultaneous equations | high | most accurate [9] |

AccountingTools spells out step-down's weaknesses plainly: "no reciprocal allocation… at no point
in the step allocation process is there any reciprocal allocation of service costs back to the
service departments that have already allocated their costs out"; "the order in which service
departments are allocated affects the final cost distribution"; and it "introduces personal
bias into allocations" because managers choose the sequence [9]. Accounting for Management confirms
that unlike the direct method, step-down "allocates the cost of a service department to other
service departments as well as to operating departments", starting with the department that
provides the greatest amount of service to other service departments [10].

**[considered, rejected] Reciprocal.** It would require iterative solves, produces numbers no
branch manager can reproduce by hand, and buys accuracy that a 4-level pharmacy tree cannot use.
The legacy system does rollups only [verified]; the jump is already large.

**[change adopted] Direct is the intended semantics — and it must be enforced.** §9.3's
`AllocationRule` allows any `sourceCostCenterId` and any `targets[]`, so today a pool could be
pointed at another pool, creating a chain that is really an ad-hoc, order-dependent step-down
without the ranking or the audit. Phase D validation therefore adds:

1. A rule's **targets must not be `kind: 'overhead'`**. Pools allocate to branches/activities only.
2. A source must be `kind: 'overhead'` **or** an activity centre flagged allocatable — never a
   branch, so no branch can tax another branch.
3. Two rules may not share a source centre within the same period unless one is reversed first
   (already implied by §9.3's idempotency guard; the check becomes explicit).
4. If a real service-to-service flow is ever needed (warehouse serving the delivery fleet), model
   it as **one documented step** with its own rule and its own batch — i.e. opt into step-down
   deliberately, with the sequence written down — rather than as an accident of rule ordering.
   `[proposal]`

**Choosing the basis.** AccountingTools evaluates the common bases and their failure modes:
direct labour ("the amount of direct labour consumed may be far smaller than the amount of factory
overhead… large allocations based on small amounts"), machine time, and square footage (accurate
for storage costs but "can be difficult to track" when inventory moves) [8]. For corporate costs it
reviews sales-based allocation — "high sales volume does not necessarily equate to high profits",
which can leave a low-profit entity "burdened with a substantial corporate allocation" — profit-based
(large charges land on the most profitable entities, hiding their inherent profitability) and
headcount ("the most specious basis") [8].

Default bases for this chain `[change adopted — Phase D seed rules]`:

| Overhead pool | Basis | Rationale from the sources |
|---|---|---|
| HQ rent, utilities | `FLOOR_AREA` | Square footage is the accurate basis for storage/space costs [8] |
| Chain administration, HR, finance | `HEADCOUNT` | Direct driver of administrative load; accept it is imperfect [8] |
| Warehouse / logistics | `USAGE` (lines shipped or units) | Usage-based bases beat financial ones for service consumption [11] |
| Insurance, licences, fixed chain fees | `FIXED_PERCENT` on documented agreement | No causal driver exists; make the arbitrary split explicit and approved rather than hidden |
| **Never** | revenue-based | High sales ≠ high profit; penalises the busiest branch [8] |

### 10.8 Budgeting, variance and period close

**Budgeting.** D365's cycle is planning → budget plan → **budget register entry**: "Budget register
entries let you revise original budgets, perform transfers, and carry forward budget amounts from
the previous year" [6]. Control is a policy choice: "hard control (which prevents postings that
would go over the budget) or soft control (where users are warned that they will exceed the
available budget funds but can decide for themselves how to proceed)" [6]. And a **rolling
forecast** is "a regular comparison of budget to actuals… also used to identify trends" [6].

Phase C's `CostCenterBudget` (per centre × account × month, versioned, one live `APPROVED` version
per key) already covers the *revise* half of that: a new version supersedes the old one and variance
reads the live version only. Three gaps against the register model `[change adopted]`:

1. **Transfers are a document, not two edits.** Moving SAR 5,000 from *Utilities* to *Rent* must
   write both rows as one audited pair with a shared reference, or the trail reads as two unrelated
   budget changes. Add `BudgetTransfer { id, code, fromBudgetId, toBudgetId, amount, reason,
   requestedBy, approvedBy }`.
2. **Carry-forward is explicit.** A year-end remaining balance becomes a new version with
   `origin: 'CARRY_FORWARD'` and a link to the source period — never a silent edit of next year's
   number.
3. **Control mode is per period, not global.** `control: 'NONE' | 'WARN' | 'BLOCK'`, seeded to
   `'WARN'` for go-live. Hard control is available, but a stale budget must not be able to stop a
   pharmacy from recording an expense that already happened — the mirror reconciliation would then
   be permanently short. Defaulting to warn matches the "level of control depends on the
   organizational culture and the organization's level of maturity" framing [6].

**Variance.** The §9.2 report is already budget-vs-actual with remaining and variance %. Add the
rolling-forecast framing [6]: a month-by-month line of *budget, actual, variance, and the trend*,
so the report answers "are we drifting" and not only "did we overspend". Keep §10.3's split —
controllable (direct) variance separate from allocated overhead.

**Period close.** Microsoft's period-end checklist is a sequence, and it is the same sequence §9.4
already specifies: complete activity in other modules, post journals, **process allocations**,
produce statements, then "Set ledger periods to **On hold**, so that no further posting occurs" —
with the explicit warning: "Don't set periods to **Permanently closed**, because you can't reopen a
period that you closed" [7].

**[change adopted]** `costPeriods` status becomes `OPEN → ON_HOLD → CLOSED(reopenable)` instead of a
binary `OPEN/CLOSED`:

- `ON_HOLD` blocks routine posting exactly as §9.4 requires; the close sequence (post entries →
  run allocations → freeze snapshots) happens here.
- Reopening requires an accountant role plus a reason, and writes an `AuditLog` row; the snapshots
  are **not** deleted — a re-close writes a new `capturedAt`, so the audited history keeps both
  versions. This is the local equivalent of D365's "you can't reopen a permanently closed period",
  without inheriting its dead end.
- No period may ever reach a state that cannot be reopened by an authorised user; that is a
  deliberate divergence from D365 and is the reason the word "permanent" appears nowhere in the
  schema.

### 10.9 What the research did not change

Explicitly unchanged, so a future reader does not re-litigate them:

- **Option 1 stands** — this app writes only its own `_APP` mirror tables; no writes to legacy XPH
  tables (§8).
- **One dimension stands** — no D365-style multi-dimension framework (§10.5).
- **No per-cashier / per-till centres** (§10.4), and the cashier still never answers a cost-centre
  question at checkout (§7.4).
- **No reciprocal allocation, and no implicit step-down** (§10.7).
- **No profit-centre evaluation of branches** (§10.2), even though revenue is tagged.
- **No hard delete of master data, ever** (§10.6).
- **Hard budget control is available but off by default** (§10.8).
- The SQL mirror stays best-effort and queued through `pendingSyncStore`; a down server never
  blocks an expense, an allocation post, or a close (§9.4).

### 10.10 References

All URLs fetched and read on **2026-11-01**. Page dates are the source's own "last updated" where it
published one.

| # | Source | URL | Used in |
|---|---|---|---|
| [1] | Wikipedia — *Cost centre* (definitions; production vs service centres; cost vs profit centre) | https://en.wikipedia.org/wiki/Cost_centre | §10.2, §10.4 |
| [2] | AccountingTools — *Cost center*, Steven Bragg, 11 Mar 2026 (budget-vs-actual evaluation; cost pools; granularity trade-off; discretionary centres) | https://www.accountingtools.com/articles/cost-center | §10.1, §10.2, §10.4 |
| [3] | SAP Learning — *Creating and Managing Cost Centers* (standard hierarchy covering all cost centres; validity periods; Cost Center Category and posting locks) | https://learning.sap.com/courses/explaining-cost-center-accounting/creating-and-managing-cost-centers_e1a4e69a-1c6d-4d4d-a7f6-0c2a869be8b1 | §10.4, §10.6 |
| [4] | Microsoft Learn — *Financial dimensions and tags* (custom vs entity-backed dimensions; 30-character values; editing at source; legal-entity overrides) | https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/financial-dimensions | §10.5 |
| [5] | Microsoft Learn — *Modifying and deleting financial dimensions* (deletion restricted once referenced; rename or suspend; suspended values hidden from lookups) | https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/modifying-deleting-financial-dimensions | §10.6 |
| [6] | Microsoft Learn — *Budgeting home page* (plan → budget register entries; revise/transfer/carry-forward; hard vs soft control; rolling forecasts) | https://learn.microsoft.com/en-us/dynamics365/finance/budgeting/budgeting-overview | §10.8 |
| [7] | Microsoft Learn — *Close the general ledger at period end* (post journals, process allocations, set periods *On hold*, never *Permanently closed*) | https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/close-general-ledger-at-period-end | §10.8 |
| [8] | AccountingTools — *Cost allocation methods*, Steven Bragg, 11 Feb 2026 (labour/machine-time/floor-area bases; sales-, profit- and headcount-based corporate allocation and their flaws) | https://www.accountingtools.com/articles/cost-allocation-methods.html | §10.7 |
| [9] | AccountingTools — *Step allocation method*, Steven Bragg, 27 Jul 2026 (ranking by service consumed; no reciprocal allocation; sequence affects the result) | https://www.accountingtools.com/articles/step-allocation-method.html | §10.7 |
| [10] | Accounting for Management — *Step down method of cost allocation*, 26 Mar 2024 (contrast with the direct method; greatest-service-first ordering) | https://www.accountingformanagement.org/step-method-of-cost-allocation/ | §10.7 |
| [11] | Wikipedia — *Cost allocation* (shared-service cost recovery: provider, consumers, service catalogue, chargeback) | https://en.wikipedia.org/wiki/Cost_allocation | §10.1, §10.7 |
| [12] | Lumen Learning — *Managerial Accounting*, Ch. 9 *Responsibility Accounting for Cost, Profit and Investment Centers* (identify cost centres, responsibility reports, allocate indirect expenses, departmental contribution margin) | https://courses.lumenlearning.com/suny-managacct/part/responsibility-accounting-for-cost-profit-and-investment-centers/ | §10.2 |
| [13] | Open Exam Prep — *Responsibility Accounting* (CMA Part 1), updated Jan 2026 (controllability principle and its practical challenges; three responsibility-centre types; traceable vs common costs) | https://open-exam-prep.com/study-guides/cma-part1/performance-management/responsibility-accounting | §10.1, §10.2, §10.3 |

**Note on source quality.** [3]–[7] are vendor documentation for the two systems whose cost-centre
and dimension models this design is closest to; [8]–[10] are practitioner/educational references
for allocation arithmetic; [1] and [11] are encyclopaedic and used only for definitions. None of
them is a substitute for §2's legacy verification, and no number in this document became `[verified]`
because of this section.

(end of document — statuses: §1–§3 proposals remain as diagnostics; §7 revised per
requirements; §8 is the governing integration layer, Option 1 chosen 2026-10-26; §9 is the
build-spec handoff for the held phases B–E; §10 is external research appended 2026-11-01, with its
adopted changes listed in §10.1 and applied to phases B–E as tagged.)
