# RSD (رصد) integration — pharmacy sale + sale cancel

Status: Phase 1 (capture the pack identity on the sale) is implemented locally. The server-side
reporting adapter (Phase 2+) still awaits SFDA credentials and the ISD schema.

Scope fixed by the owner: **only** the two pharmacy-facing RSD services —

- `Pharmacy Sale` — report one sold sellable unit to SFDA.
- `Pharmacy Sale Cancel` — cancel a previously reported sale.

Everything else in RSD (Accept, Accept by Batch, Accept Dispatch, Dispatch, Return,
Transfer, Deactivate, Consume, Import/Export/Supply, PTS upload/download/query) is **out of
scope**. Purchasing and stock receiving in this app stay local and are not reported.

---

## 1. What RSD actually requires (verified sources)

Sources:

- SFDA *Integration Guide for Drug Track & Trace System*, OPS-G-117-V2.1 (05 Aug 2024).
- SFDA *Stakeholder Operation Portal User Manual* v1.1.
- SFDA *Drug Barcoding Specifications* (GS1 DataMatrix contents).
- Live service roots (both HTTP-Basic protected, `WWW-Authenticate: Basic realm="DTTSJDBCRealm"`):
  - `https://rsd.sfda.gov.sa/ws/PharmacySaleService/PharmacySaleService?wsdl`
  - `https://rsd.sfda.gov.sa/ws/PharmacySaleCancelService/PharmacySaleCancelService?wsdl`

Key facts that drive the design:

1. RSD ("نظام التتبع الإلكتروني للمستحضرات الصيدلانية") is a **unit-level** track & trace
   system, not an invoice-level one.
2. Every tracked unit carries a **GS1 DataMatrix**: `(01) GTIN + (21) SN + (17) expiry +
   (10) batch`. The serial number is unique per physical pack.
3. `Pharmacy Sale` is used "by Pharmacy to sell a product to a patient". Unlike
   Dispatch/Return/Transfer/Accept there is **no "by batch number" variant** of Pharmacy
   Sale — each sold unit is identified by GTIN + SN (+ BN + XD).
4. The portal's Drug Sale page asks first for **"to GLN"**: `Direct Sale` means the
   customer is the patient (no reimbursement agency); otherwise a reimbursement agency is
   selected and a **prescription ID** is required.
5. Drug Sale Cancel re-registers the unit in the pharmacy's inventory; same identification
   model (to GLN + either prescription ID or the units themselves).
6. Transport: **SOAP 1.2 XML web services**, request/response, every request answers with
   success or an error code. Authentication is a username/password issued by SFDA per
   stakeholder (main user = GLN + `0000`); the service roots are additionally behind HTTP
   Basic (`DTTSJDBCRealm`).
7. A stakeholder's location is identified by a **GLN**. Without the pharmacy's GLN and
   credentials nothing can be reported.
8. The exact XML schema (operation names, element names, error codes) is in the
   **DTTS-ISD.PHARMACYSALE-nnn** interface specification, which SFDA only hands out after
   registration; the WSDL itself returns `401` without the Basic credentials.
9. Integration must be tested against SFDA's **test server** before production
   (`Tracking.drug@sfda.gov.sa`).

### Consequence that must be agreed before coding

A sale can only be accepted by RSD if the unit is already **in the pharmacy's RSD
inventory**, i.e. the warehouse's Dispatch was **Accepted** by this pharmacy. If nothing in
the pharmacy's stack performs Accept today (portal manually, supplier-side, or another POS),
every Pharmacy Sale call will be rejected by SFDA. The owner has limited the scope to the
two sale services, so this is a **prerequisite**, not something this feature can paper over.

---

## 2. Current state in this app (gap analysis)

| Area | Today | Gap for RSD |
| --- | --- | --- |
| GS1 scanning | `utils/gs1.ts` parses GTIN, batch, expiry, **serial**. `cartStore.scan` uses GTIN/batch/expiry to pick the batch and **drops the serial**. | Serial never reaches the sale; without it no Pharmacy Sale message can be built. |
| Sale line | `SaleLine` has `batchId`, `batchNo`, `expiryDate`, `qty`, pack level, prices. | No per-unit serial list; one line can stand for N packs with no identity. |
| Item identity | `Item.barcode`, optional `Item.gtin`, extra barcodes; `Batch.gtin`. | GTIN must be normalised to 14 digits (GTIN-12/13 → pad) and the **pack-level** GTIN must be the one on the DataMatrix. |
| Pharmacy identity | `StoreSettings` has name/VAT/CR/address; ZATCA identity on the server. | No GLN, no RSD username/password, no environment (test/production). |
| Sale cancellation | There is no "cancel sale". Only Returns (partial or full, restock + register reversal + ZATCA credit note). | `Pharmacy Sale Cancel` needs an explicit trigger and the exact units of the original sale. |
| Retry / outbox | `pendingSyncStore` retries **internal** mirrors (sale/return/receiving/Wasfaty) every 60 s. | RSD reporting needs its own durable outbox with per-unit status, attempt count and SFDA error code — an internal mirror retry is not the same contract. |
| Server | Express + ZATCA + Wasfaty adapters under `server/src/`, credentials in secure store/.env. | No RSD adapter; this is the right home for SOAP + Basic auth so the browser never holds credentials. |
| Reporting UI | ZATCA submissions visible in the Sales invoices tab. | No view of "reported / pending / rejected" per sale or per unit. |
| Offline-first | Selling never blocks on a backend. | Must keep that rule: RSD failures never block checkout; they queue and surface for follow-up. |

Additional practical gaps:

- **Partial packs.** If a box is sold as strips/tablets, the DataMatrix identity belongs to
  the box. RSD sells the registered sellable unit; the app must record which unit the serial
  was consumed from, and decide policy for loose sales.
- **Scanning order.** Today a DataMatrix scan adds qty 1 to a batch line and merges repeat
  scans. For RSD each scan is one unit with its own SN; a repeated SN must be refused before
  the sale is recorded (locally and by SFDA).
- **Non-serialised items.** Not every item sold in a pharmacy has a DataMatrix (cosmetics,
  some supplies). Policy needed: report only items with captured serials (recommended
  phase 1) or block their sale when RSD mode is on.

---

## 3. Proposed design

### 3.1 Shape

```
POS (browser, local-first)                    server/ (Node, holds secrets)          SFDA RSD
──────────────────────────                    ─────────────────────────────          ────────
scan DataMatrix ──► cart line.serials[]  ─┐
completeSale ──► SaleLine.serials[]        │
                ──► rsdStore.enqueue(unit) ├─► POST /api/rsd/sales ──► SOAP PharmacySale ──► test/prod
                 (pending, per unit)       │
cancelSale ──► rsdStore.enqueue(cancel) ──┘   POST /api/rsd/sales/cancel ► SOAP PharmacySaleCancel
                 retry every 60 s, manual retry, status per unit
```

- **Server-side adapter** (same pattern as ZATCA/Wasfaty): `server/src/rsd/`
  - `config.ts` — base URLs per environment, GLN, pharmacy username/password (secure store,
    never in the browser), mock mode.
  - `soapClient.ts` — SOAP 1.2 envelope, HTTP Basic, timeouts, response/error parsing.
  - `sale.ts` / `cancel.ts` — payload builders (pure, unit-testable once the ISD schema is
    confirmed).
  - `store.ts` — append-only reporting ledger keyed by `(GTIN, SN)` and by local invoice, so a
    retry can never double-report and a cancel always targets the accepted sale.
  - `routes/rsd.ts` — `GET /api/rsd/status`, `POST /api/rsd/sales`, `POST /api/rsd/sales/cancel`,
    `GET /api/rsd/reports`.
  - **Mock mode** (`RSD_MODE=mock`) implementing the same contract, so the whole flow and
    e2e tests run without SFDA credentials.
- **Client**:
  - `src/api/rsdApi.ts` — thin typed client.
  - `src/store/rsdStore.ts` — per-unit reporting state (`pending | sent | rejected`), attempts,
    error code, last attempt; persisted; flushed on load and every 60 s (like `pendingSyncStore`).
  - Settings → new **RSD** panel: enable, environment (test/production), pharmacy GLN,
    username/password (write-only; stored server-side), Direct Sale default, "test connection"
    button. Disabled by default.
- **Data model**:
  - `SaleLine.serials?: SaleSerial[]` where
    `SaleSerial = { gtin, serialNo, batchNo, expiryDate, reportedAt?, rsdStatus?, rsdError? }`.
  - Cart line keeps the same list so the cashier sees scanned units before payment.
  - No change to money fields; RSD carries identity only, not prices.
- **Mapping**:
  - GTIN: DataMatrix `(01)` if present, else item `gtin`, else barcode padded to 14 digits
    (warn when the code is not a valid GS1 key).
  - SN: DataMatrix `(21)`; manual entry fallback in a "serials for this line" dialog.
  - BN/XD: DataMatrix `(10)/(17)` when present, cross-checked against the chosen batch and
    **refused on mismatch** (a wrong batch is a compliance error, not a warning).
  - To GLN: `Direct Sale` by default (patient at the counter). Prescription/reimbursement GLN
    only if the owner supplies one; Wasfaty has no payer GLN in this app today.
  - Prescription ID: from the existing `PrescriptionInfo` when present.
- **Cancel mapping** (owner decision, 21 Nov 2026): a **full return** is the cancellation.
  When a return makes the invoice `returned` (every unit on every line fully returned back to
  stock), the app reports `Pharmacy Sale Cancel` for the units of that sale that were accepted by
  RSD. The original serials identify the units; the stored RSD response/notification id lets the
  cancel target the accepted sale instead of guessing.
  - A **partial return is not a cancel** and sends nothing: RSD's `Return` service is explicitly
    out of scope, so those units stay "sold" in RSD until the sale is fully returned. This is a
    known compliance limitation of the agreed scope and is called out in the UI.
  - Ordering is preserved per unit: a cancel never overtakes its sale in the outbox (oldest
    first). A sale still pending when the full return happens is cancelled once it lands, in the
    same queue position, so SFDA never sees a cancel for a sale it never received.
  - One cancel per unit, ever; a second full-return attempt is a no-op in both the local ledger
    and RSD.
- **Failure rules**: a sale always completes locally. RSD status is visible afterwards
  (invoice row + RSD tab). Rejections are never auto-retried blindly — SFDA error codes are
  shown with the affected GTIN/SN, and a human fixes the data (wrong batch, unknown serial,
  unit not in inventory).

### 3.2 Data flow on a sale

1. Cashier scans the DataMatrix. Parser extracts GTIN/SN/BN/XD.
2. Item + batch resolved as today; the serial is appended to the cart line (duplicate SN in the
   basket is refused immediately - Phase 1 checks the live basket only; a pack sold on an earlier
   invoice and scanned again is caught by SFDA when the sale is reported).
3. `completeSale` stores the serials on `SaleLine`, decrements stock once per unit, records the
   sale locally (unchanged).
4. One RSD outbox item is enqueued **per unit** (`invoiceId`, `saleLineId`, GTIN/SN/BN/XD,
   to-GLN/direct-sale, prescription id).
5. The server sends the SOAP call; the response is written to the reporting ledger and reflected
   on the outbox item.
6. Failures remain queued; the RSD tab lists them with SFDA's own error text.

---

## 4. Phased plan (proposal)

| Phase | Deliverable | Acceptance |
| --- | --- | --- |
| 0. Inputs | Credentials + WSDL + ISD for `PHARMACYSALE`, test GLN, confirmation of who accepts incoming units | WSDL retrievable; one manual SOAP call succeeds against the test server |
| 1. Serial capture | **Done:** GS1 serial kept on cart line, duplicate refused, serials frozen on `SaleLine`, selling level frozen for serialised lines. **Still open:** manual serial entry for a damaged DataMatrix label. | E2E: scan two DataMatrix units → two serials on the sale; rescanning the same SN is refused |
| 2. Server adapter + mock | **Done:** `server/src/rsd/*` (types, config, normalisation, wire, SOAP client, mock state machine, ledger, service), `/api/rsd` routes, `src/api/rsdApi.ts`, `npm run rsd:trial` | Mock: sale reported, duplicate retry idempotent, rejection surfaces the error code |
| 3. Sale reporting | Outbox in `rsdStore`, 60 s retry, RSD status column on the invoice + RSD monitoring tab, settings panel | POS completes with server down; sale reports automatically when it returns; status visible |
| 4. Sale cancel | Full return (invoice `returned`) triggers `PharmacySaleCancel` for its accepted units; partial returns send nothing | Full return reports cancel exactly once per unit; partial return leaves the RSD sale untouched; retry-safe |
| 5. Hardening | Reconciliation (RSD ledger vs sales), CSV export, error-code dictionary, docs | No unmatched sold unit; audit export for an SFDA inspection |

Rough effort: **8–12 development days**, excluding SFDA test-server turnaround, assuming
credentials and ISD arrive at the start of phase 1.

### 4.1 Phase 2 as built

- `server/src/rsd/` is a self-contained adapter: `config.ts` (mock/live, test/production,
  credentials only server-side), `normalize.ts` (GTIN/SN/BN/XD validation, GS1 day-00 expiry),
  `wire.ts` (verified SOAP 1.1 sale envelope + response parser), `soapClient.ts` (HTTP Basic,
  timeout, WSDL probe), `mock.ts` (inventory/sale/cancel state machine + failure injection),
  `store.ts` (append-oriented ledger), `service.ts` (idempotency + sale-before-cancel ordering),
  `trial.ts` (mock suite and live probe/one-unit trial).
- `/api/rsd`: `GET /status`, `POST /sales`, `POST /sales/cancel`, `GET /records|/reports`,
  `GET /units/:gtin/:serialNo`, plus mock-only `POST /mock/accept` and `/mock/reset`.
- `src/api/rsdApi.ts` is the browser contract; it never sees credentials and reports failures as
  `RsdReportError { retryable }` so the Phase 3 outbox can queue them.
- Tests: `server/tests/rsd/{wire,normalize,service}.test.ts` (38 tests). Mock trial:
  `cd server && npm run rsd:trial` (10 steps, writes masked evidence JSON to `data/`).
- Live is fail-closed: without credentials/URLs every report is `503 rsd_not_configured`.
- Wire format verified against the production WSDL **and the XSDs they import** (2026-11-21):
  - Sale: `TOGLN, DOCTORID?, PATIENTNATIONALID?, PRESCRIPTIONID, PRESCRIPTIONDATE, PRODUCTLIST`,
    `PRODUCT = GTIN, SN, BN?, XD?`.
  - Cancel: `TOGLN, PRESCRIPTIONID, PRODUCTLIST?` — **no** `PRESCRIPTIONDATE`.
  - `SN` is required and there is **no quantity element**, so a sale is one `PRODUCT` per serial;
    batch-level aggregation is not part of `Pharmacy Sale` (no "by batch" variant exists).
  - Evidence saved under `server/data/` (gitignored): `rsd-wsdl-*.xml`, `rsd-xsd-*.xsd`.

---

## 5. Testing

- Unit: GS1 parse (incl. GS separator, missing SN), GTIN normalisation, duplicate SN,
  payload builders, ledger idempotency, error mapping.
- Server: mock-mode integration tests for sale/cancel/retry; WSDL-against-mock contract test.
- E2E (Playwright): scan serials → sale → pending → mock success → sent; server down;
  cancel sale; duplicate scan guard.
- SFDA: scripted test cases on the test server before production, then a small live pilot.

## 6. Open questions (blocking)

1. **Credentials**: test/production pharmacy GLN and RSD username/password, so the WSDL and
   service are reachable. Without them the schema cannot be finalised (mock only).
2. ~~**ISD file** `DTTS-ISD.PHARMACYSALE-nnn`~~ — **resolved for the request shape**: the production
   WSDL exposes `notifyPharmacySale` / `notifyPharmacySaleCancel` and the XSDs pin the element names
   and order. Remaining: the full error-code catalogue and the cancel-specific codes.
3. **Who accepts incoming dispatches** in RSD today? If nobody, sales will be rejected
   ("unit not in inventory") and Accept must be added to the scope or handled in the portal.
4. ~~Cancel semantics~~ — **decided**: a full return is the cancellation; partial returns send
   nothing.
5. **Item scope**: report only units that carry a serial (recommended first), or block
   non-serialised sales when RSD is enabled? Note: `Pharmacy Sale` cannot accept a missing `SN`,
   so a batch with no serials in RSD inventory is unreportable through it (no by-batch variant).
6. **Reimbursement**: always `Direct Sale`, or is there a payer GLN for Wasfaty/insurance sales
   that should be used with the prescription ID?
7. **Branches**: one GLN per branch? The app is multi-branch via cost centers.

## 7. Security / compliance notes

- Credentials live only on the server (secure store), never in the browser bundle or
  localStorage.
- Store SFDA request/response evidence per unit for audit; never delete a reporting record.
- Send only what RSD requires: GTIN/SN/BN/XD, pharmacy GLN, direct-sale/prescription identity.
  Patient national ID is *not* part of the pharmacy sale payload unless the ISD says otherwise.
- Keep the local-first rule: RSD is a reporting side-channel, never a checkout dependency.
