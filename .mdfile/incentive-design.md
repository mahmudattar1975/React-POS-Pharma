# تصميم: حافز/ربح (Incentive/Profit) للبياع على أصناف محددة

**الهدف:** تحفيز الصيدلي/البياع — عند بيع أصناف من "لائحة حافز" محددة، يُمنح البياع **حافز (profit)**. يُكتب الحافز على **الفاتورة**، وفي **نهاية الشهر** تقرير بسجلات البيع وقيمة الحافز حسب **التاريخ**.

**المرجع (Legacy):** PowerBuilder `process_external_sales_invoice` → `read_bonuc_disc_rate_sal(..., 3, 1, 11, 0) // PROFIT` (mode 11 = profit incentive). تم تحليله في `pb-profit-analysis.md`.

---

## 1. المتطلبات (Requirements)

1. **لائحة أصناف الحافز (Incentive Item List):** أصناف محددة (curated) مؤهلة للحافز، مع:
   - نوع الحافز: `%` من صافي المبيعات (بدون VAT) **أو** مبلغ ثابت per وحدة.
   - rate (نسبة/مبلغ).
   - فترة صلاحية (from/to date).
   - فرع/مستودع (اختياري).
   - تفعيل/تعطيل.
2. **حساب الحافز at sale time:** لكل سطر (line) في الفاتورة، إذا كان الصنف في اللائحة (ضمن الفترة)، احسب الحافز وراكمه.
3. **كتابة الحافز على الفاتورة:** عرض/طباعة `incentiveAmount` per line و `totalIncentive` على الإيصال (ZATCA QR لا يتأثر — الحافز تكلفة داخلية).
4. **تقرير نهاية الشهر:** سجلات البيع (invoice, date, item, qty, sale amount, incentive) + إجمالي الحافز حسب **التاريخ** (ويمكن حسب البياع/الصنف).
5. **الإرجاع (Return):** عند إرجاع صنف مؤهل، **عكس** (clawback) الحافز (مثل loyalty points).
6. **RBAC:** فقط admin/manager يدير اللائحة؛ cashier يرى حافزه.

---

## 2. نموذج البيانات (Data Model)

### 2.1 Prisma (server) — جداول جديدة

```prisma
model IncentiveItem {
  id            String   @id @default(cuid())
  itemId        String   // FK -> Item (catalog)
  incentiveType String   // 'percent' | 'amount'
  rate          Float    // 0.05 = 5%  OR  SAR per unit
  activeFrom    DateTime
  activeTo      DateTime
  branchNo      Int?     // optional scope
  active        Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  records       IncentiveRecord[]
}

model IncentiveRecord {
  id             String   @id @default(cuid())
  saleId         String   // FK -> Sale
  invoiceNo      String
  invoiceDate    DateTime
  itemId         String
  itemNameEn     String
  qty            Float
  saleAmount     Float    // net excl VAT (or incl? define: net excl VAT)
  incentiveType  String
  rate           Float
  incentiveAmount Float
  cashierName    String
  branchNo       Int?
  createdAt      DateTime @default(now())
  incentiveItem  IncentiveItem? @relation(fields: [incentiveItemId], references: [id])
  incentiveItemId String?
}
```

### 2.2 Frontend types (src/types)

```ts
// src/types/incentive.ts
export type IncentiveType = 'percent' | 'amount';

export interface IncentiveItem {
  id: string;
  itemId: string;
  itemNameEn?: string;
  incentiveType: IncentiveType;
  rate: number;          // 0.05 = 5% OR SAR/unit
  activeFrom: string;    // ISO date
  activeTo: string;
  branchNo?: number;
  active: boolean;
}

export interface IncentiveRecord {
  id: string;
  saleId: string;
  invoiceNo: string;
  invoiceDate: string;
  itemId: string;
  itemNameEn: string;
  qty: number;
  saleAmount: number;    // net excl VAT
  incentiveType: IncentiveType;
  rate: number;
  incentiveAmount: number;
  cashierName: string;
}

export interface IncentiveSummary {
  date: string;          // ISO date (day)
  invoiceCount: number;
  totalSaleAmount: number;
  totalIncentive: number;
}
```

### 2.3 SaleLine extension (src/types/sales.ts)

أضف إلى `SaleLine`:
```ts
incentiveType?: IncentiveType;   // snapshot
incentiveRate?: number;          // snapshot
incentiveAmount?: number;        // computed at checkout
```
وإلى `SaleHeader`:
```ts
totalIncentive?: number;        // sum of line incentives
```

---

## 3. منطق الحساب (Calculation Logic)

### 3.1 Pure function (utils/incentive.ts)

```ts
export interface IncentiveCalcInput {
  item: Item;
  incentiveItem: IncentiveItem | null;  // active rule for this item on this date
  qty: number;
  netExclVat: number;                    // line net excl VAT
}

export function computeLineIncentive(input): number {
  const { incentiveItem, qty, netExclVat } = input;
  if (!incentiveItem || !incentiveItem.active) return 0;
  const today = new Date().toISOString().slice(0,10);
  if (today < incentiveItem.activeFrom || today > incentiveItem.activeTo) return 0;
  if (incentiveItem.incentiveType === 'percent') {
    return round2(netExclVat * incentiveItem.rate);
  }
  return round2(qty * incentiveItem.rate);
}
```

### 3.2 At checkout (POSPage / cartStore)
- For each cart line, look up active incentive rule (from `incentiveStore`).
- Set `line.incentiveType`, `line.incentiveRate`, `line.incentiveAmount`.
- `sale.totalIncentive = sum(line.incentiveAmount)`.

### 3.3 Return (clawback)
- When a line is returned, compute `returnedIncentive = incentiveAmount * (returnedQty / qty)` and subtract from a running `clawedBackIncentive` (mirror `pointsEarnedClawedBack`).

### 3.4 Recording
- On sale submit: POST to `/api/incentives/records` (batch) with saleId, invoiceNo, date, lines, cashier.
- Backend persists `IncentiveRecord` rows.

---

## 4. واجهات API (Backend)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/incentives/items` | list incentive items (with item names) |
| POST | `/api/incentives/items` | create |
| PUT | `/api/incentives/items/:id` | update |
| DELETE | `/api/incentives/items/:id` | delete |
| GET | `/api/incentives/active?date=YYYY-MM-DD` | active rules for a date |
| POST | `/api/incentives/records` | record sale incentives (batch) |
| GET | `/api/incentives/report?from=&to=&cashier=&itemId=` | monthly/daily report + totals |
| GET | `/api/incentives/report/summary?from=&to=` | daily summary (date, count, sale amount, incentive) |

---

## 5. واجهة المستخدم (UI)

### 5.1 Admin — "Incentive Items" screen (Settings / new page)
- Table: Item, Type, Rate, From, To, Active, Actions.
- Add dialog: pick item (search), type, rate, dates, branch.
- Validation: no duplicate active rule for same item overlapping period.

### 5.2 POS
- Cart line: small badge "حافز 5%" / "حافز 2.00 SAR" when item eligible.
- Checkout summary: "Total incentive: X SAR" (informational, not charged to customer).
- Receipt: line "حافز بيع (Sales incentive): X SAR" + total.

### 5.3 Reports
- New tab/page "Incentive Report" (under Dashboard & Reports or new menu).
- Filters: date range (default = current month), cashier, item.
- Table: Date, Invoice, Item, Qty, Sale amount, Incentive.
- Summary cards: total sales, total incentive, top items, top cashiers.
- Export Excel/CSV.

---

## 6. تكامل ZATCA
- الحافز **لا** يدخل في ZATCA UBL XML (internal cost, not a tax line).
- يُحفظ في SaleLine/SaleHeader (snapshot) و IncentiveRecord (backend).
- ZATCA Sales Invoices tab غير متأثر.

---

## 7. المهام (Tasks) — خطة تنفيذ

### Phase A — Foundation (data + calc)
- [ ] A1. Add Prisma models `IncentiveItem`, `IncentiveRecord` + migration.
- [ ] A2. Add types `src/types/incentive.ts`.
- [ ] A3. Add `src/utils/incentive.ts` (computeLineIncentive) + unit tests.
- [ ] A4. Extend `SaleLine`/`SaleHeader` with incentive snapshot fields.

### Phase B — Backend API
- [ ] B1. `server/src/routes/incentives.ts` — CRUD items.
- [ ] B2. `POST /api/incentives/records` — batch record.
- [ ] B3. `GET /api/incentives/report` + summary.
- [ ] B4. Register routes in `index.ts`.

### Phase C — Frontend store + POS
- [ ] C1. `src/store/incentiveStore.ts` (load active rules, CRUD).
- [ ] C2. POS cart: compute & show incentive per line + total.
- [ ] C3. Checkout: record incentive (batch) after sale.
- [ ] C4. Return clawback.

### Phase D — UI screens
- [ ] D1. Admin "Incentive Items" page (under Settings or new menu).
- [ ] D2. Receipt: print incentive line.
- [ ] D3. "Incentive Report" page (filters, table, summary, export).

### Phase E — Tests & polish
- [ ] E1. Unit tests (calc, store).
- [ ] E2. E2E: sale with incentive item → record → report.
- [ ] E3. Documentation update.

---

## 8. الافتراضات (Assumptions)
- الحافز **internal** (لا يُعرض للعميل كخصم؛ يُطبع للبياع/الإدارة).
- "لائحة" = قائمة أصناف (Item IDs) مع rate/validity.
- التقرير default = الشهر الحالي، قابل للتصفية.
- RBAC: admin يدير، cashier يرى حافزه.
- Mock mode (ZATCA) غير متأثر.

---

---

## 9. Legacy Data Source: `FSTOCK_DETAIL` (PH database)

**Server:** `DESKTOP-4MIGUDG\MSQL` · **DB:** `PH` · **User:** `SA`

### 9.1 Schema
| Column | Type | Notes |
|--------|------|-------|
| FAPPL_TYPE | int | application type (pharmacy module) |
| FAPPL_SUB | int | branch/sub |
| FSTORE_NO | int | store (0 = all) |
| ITEM_NO | decimal | item number |
| INVOICE_TYPE | decimal | 3 = sales |
| INVOICE_KIND | decimal | 0 or 1 (two rows per item — likely normal vs. credit/return or customer type) |
| DETAL_TYPE | decimal | 1 (profit detail) |
| DETAIL_SEQ | decimal | sequence |
| DETAIL_KIND | decimal | 1 |
| DETAIL_AMT | decimal | **rate** (0.05–0.89 → 5%–89%) |
| DETAIL_FROM | decimal | qty from (1) |
| DETAIL_TO | decimal | qty to (9999) |
| CONTRACT_NO | decimal | 0 |
| CUST_TYPE | decimal | 2 (all customers) |
| CUST_NO | decimal | 0 |
| CORP_NO | decimal | 64 (corporate/branch scope) |
| CONTRACT_KIND | decimal | 1 |
| Note | nvarchar | |
| SYSPARAM | nvarchar | |
| faddedby/faddedon/fmodifiedby/fmodifiedon | audit | |

### 9.2 Data stats
- **2,827 rows**, **1,543 distinct items**.
- `DETAIL_AMT` range: 0.05 – 0.89 (avg 0.365) → percentage rates.
- `DETAIL_FROM=1`, `DETAIL_TO=9999` → applies to any quantity (no tiered qty bands in this dataset).
- `INVOICE_KIND` 0/1 → two rates per item (likely normal sale vs. return/credit, or customer segment).
- `CORP_NO=64` → scoped to corporate 64.

### 9.3 Implication for new design
- The legacy "profit incentive" is stored as **per-item rate rows** in `FSTOCK_DETAIL`, keyed by (FAPPL_TYPE, FAPPL_SUB, ITEM_NO, INVOICE_KIND).
- `read_bonuc_disc_rate_sal(..., mode=3, ..., 11, 0)` reads these rows and returns type+rate.
- For the new app, we can **import** these 1,543 items as the initial "Incentive Item List" (rate = DETAIL_AMT as percent, type = 'percent', validity = open-ended, INVOICE_KIND 0/1 → two rules per item).
- `CORP_NO=64` → branch scope (optional in new model).

---

## 10. Implementation Status

| Phase | Status | Notes |
|-------|--------|-------|
| A — Foundation (data + calc) | ✅ Done | Prisma models, types, utils (13 tests), SaleLine/SaleHeader fields |
| B — Backend API | ✅ Done | /api/incentives/* (items, active, records, report, summary) |
| C — Frontend store + POS | ✅ Done | incentiveStore, POS badge/total, checkout record, totalIncentive |
| D — UI screens | ✅ Done | IncentiveItemsPage, IncentiveReportPage, ReceiptView incentive line, nav + routes |
| E — Return clawback + tests + docs | ✅ Done | ReturnsPage clawback (negative IncentiveRecords), tsc/build/vitest green |

### Verification
- `tsc -b` ✅ (no errors)
- `npm run build` ✅
- `vitest run` ✅ (527/527 tests)

*تم إعداد هذا التصميم بناءً على legacy PowerBuilder (mode 11 profit) + React-POS-Pharma codebase + DB PH (FSTOCK_DETAIL). Web search غير متاح (402).*
