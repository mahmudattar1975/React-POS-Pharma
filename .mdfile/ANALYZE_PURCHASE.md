# Legacy Purchase Invoice Screen — `w_scrn_pur_invoice_1`

Analysis of the vendor purchase-invoice entry window from the legacy SCR 10.58 PowerBuilder
system (`F:\SOURCE\SCR 10.58 B\phpurchg.pbl`), extracted because the new React **Purchase
Invoices** feature (`/purchases`) was built as a modern successor to this screen.

> **Documentation discipline** (same as the other docs in this project): everything below is
> marked **[verified]** when read directly from the extracted source, or **[assumed]** when it
> is the best reading of incomplete/binary-garbled regions. Extraction notes are in
> `_legacy_dump/` (see *Extracted source* at the end).

---

## 1. Where the source came from

[verified]

- The PBL stores object sources as **UTF-16LE** text; the whole 64.6 MB file was converted in
  memory with `[System.Text.Encoding]::Unicode.GetString` and searched for the window name.
- The window's source block starts at UTF-16 offset **3,896,901** (`global type
  w_scrn_pur_invoice_1 from window`) and its readable text ends around offset **~4,131,900**
  (binary tail after `OpenSheet (w_print_pur_INVOICE, ...)`).
- Dumped to `_legacy_dump/w_scrn_pur_invoice_1_source.txt` (13,583 lines; readable through
  ~line 12,108, binary garbage after that). The embedded **datawindow** definitions for this
  window family start in the region ~UTF-16 offset 1,119,000–2,366,000, partially dumped to
  `_legacy_dump/w_scrn_pur_invoice_1.bin.txt` (the line-display DW retrieve SQL quoted in
  section 2 comes from that file at its `arguments=(...)` offset 10,783 = file offset 1,133,923).
- `w_scrn_pur_invoice_1_scripts.txt` in the same folder is a **wrong extraction** (contains
  `w_rept_pur_inv_by_cust_date`, the next window in the PBL) — kept only as a layout reference.

## 2. Data model [verified from DW SQL + scripts]

The line-display datawindow joins **six tables** (exact SQL captured):

```
FCODCSVN   vendor master         (CUST_NAME_A, CUST_TYPE, CUST_NO ...)
FTOTBUYR   purchase invoice HEADER
Hcsvn_type vendor type lookup    (fcsvn_type = FTOTBUYR.CUST_TYPE)
FTRNBUYR   purchase invoice LINES
FCODSTOCK  item master           (ITEM_NAME_E, VAT percent, ...)
FQTYITEM   batch stock rows      (TRANS_TYPE = 1 filters purchase movements)
```

Join logic (all captured from the retrieve SQL):

- Header → lines: `INVOICE_NO`, `CUST_TYPE`, `CUST_NO`, `FAPPL_TYPE`, `FAPPL_SUB` match.
- Lines → batch: `FTRNBUYR.PUR_INVOICE_NO = FQTYITEM.INVOICE_NO` and
  `FTRNBUYR.PUR_INVOICE_SEQ = FQTYITEM.INVOICE_SEQ` — **each purchase line points at the
  specific FQTYITEM batch row it created**, one batch per line, per item per store.
- Everything is scoped by `FAPPL_TYPE` + `FAPPL_SUB` (application/company number) and lines
  additionally by `FSTORE_NO` (multi-store).

### Header table `FTOTBUYR` / `FTOTBUYF`

Columns seen across the extraction:

`INVOICE_NO`, `INVOICE_DATE`, `INVOICE_SEQ_NO`, `CUST_NO`, `CUST_TYPE`, `SALESMAN_NO`,
`NOTE`, `PUR_INVOICE_NO`, `INVOICE_TYPE`, `TOTAL_TRANS`, plus invoice totals
(`Winv_amount`, `Winv_bonus`, `Winv_discount`, `Winv_net_amount`,
`Winv_TOTAL_PUR_VAT_AMOUNT`, `Winv_NET_PUR_NVAT_AMOUNT`, `TOTAL_QTY`).

[assumed] Both **FTOTBUYR** and **FTOTBUYF** exist in this PBL (5,584 vs 3,340 string hits).
The *display* DW reads `FTOTBUYR`; the save/exit scripts in this window SELECT `FTOTBUYF`.
The most plausible reading is two mirrored copies of the header (per-store vs. consolidated,
or live vs. archive) — the exact distinction between the F and R copies is **not verified**
from this window alone and would need the global function sources
(`UPDATE_HEADER_PUR_TABLE` etc.) or a DB schema dump to settle. React feature note: our
single `PurchaseInvoice` header makes no split.

### Lines table `FTRNBUYR`

Columns seen in the retrieve SQL:

| Column | Meaning |
|---|---|
| `INVOICE_SEQ` | line number within the invoice |
| `ITEM_NO`, `EXPIARY_DATE` | item + batch expiry (batch/lot number carried on FQTYITEM side) |
| `RPUR_PRICE` | unit purchase price (the `sle_4` entry field) |
| `PUR_QTY` | purchased qty (`em_5`) |
| `DISCOUNT_1 / DISCOUNT_2 / DISCOUNT_3` | the three discount **tier percentages** |
| `TOTAL_DISCOUNT_1 / _2 / _3` | the discount **amounts** in SAR after each tier |
| `NET_RPUR_AMOUNT` | net after discounts, before VAT |
| `TOTAL_RPUR_AMOUNT` | total for the line |
| `TOTAL_QTY`, `TOTAL_DISCOUNT_AMOUNT`, `BONUS_QTY`, `TOTAL_BONUS_AMOUNT` | aggregated qty/discount/bonus |
| `NET_RPUR_NVAT_AMOUNT` | net excluding VAT |
| `VAT_PERCENT` | the per-line VAT rate snapshot (from item master) |
| `TOTAL_RPUR_VAT_AMOUNT` | VAT amount snapshot |
| `PUR_INVOICE_NO`, `PUR_INVOICE_SEQ` | pointer back to the FQTYITEM batch row |
| `CUST_TYPE`, `CUST_NO`, `FAPPL_TYPE`, `FAPPL_SUB`, `FSTORE_NO` | scoping keys |

### Batch table `FQTYITEM`

Keyed by `TRANS_TYPE` (=1 for purchase), `INVOICE_NO`, `INVOICE_SEQ`, `FSTORE_NO`,
`CUST_TYPE`, `CUST_NO`, `ITEM_NO`; carries `EXPIRAY_DATE`, `SALE_PRICE`, `NET_PUR_PRICE`,
`FACTORY_ORDER_NO`, `CUR_QTY` / `CUR_BONUS_QTY` / `CUR_TOTAL_QTY`.

The `NET_PUR_PRICE` namesake is what the earlier XPH-schema finding (`net_pur_price 2.402`)
came from — that's why the React side keeps **round3** unit costs.

## 3. Business rules

### 3.1 Three-tier discount cascade — `call_discount()` [verified, lines 939–977]

```
gross   = (PUR_QTY em_5 + BONUS_QTY em_6)          // shown in st_15-1 / st_16-1 = qty × price
tier1   = gross        × d1%     (em_11-1)
tier2   = (gross − t1) × d2%     (em_11-2)
tier3   = (gross − t2) × d3%     (em_11-3)
net     = gross − t1 − t2 − t3                       // st_12-3
VAT     = get_calculated_vat_amount(wtrans_type, qty, bonus, unitPrice, d1, d2, d3)  // st_11-4
total   = net + VAT                                  // st_12-4
```

- **VAT is computed on the fully-discounted net, not the gross**, even though it is rendered
  as a 4th "tier" (st_11-4) in the line grid. Stacks with the React feature's model: the React
  feature has exactly **one** discount field per line; the legacy supports up to three
  cascading vendor discount tiers (the classic distributor chain: trade discount → volume
  discount → payment-term discount).

### 3.2 Bonus quantity [verified]

- `em_6` = bonus (free) qty on each line; `st_15-1` = qty + bonus, priced into the lines.
- A dedicated **bonus calculator** window is launched by `pb_13` (`w_scrn_calc_pur_bonus`,
  lines 3125–3181): it returns `em_5` (paid qty), `em_6` (free qty) and the combined total via
  `Message.StringParm` positions 1–7, 8–7, 15–7 — e.g. `mparm = "01" + string(WBONUS_ORIG,"0.00000")`.
- Bonus kinds come from system parameter positions (`wBONUS_detail_kind = 1` percentage vs.
  amount): bonus qty can be auto-filled from `sle_7` as `ROUND(sle_7 × em_5)` (percentage) or
  as a fixed amount (lines 8457–8473).
- Invoice totals track `Winv_bonus`, `TOTAL_BONUS_AMOUNT`, and bonus separately flows into
  GL/accounting totals.

[React gap] Our feature has **no bonus/free-goods column** and no bonus calculator.

### 3.3 VAT treatment [verified]

- Per-line `VAT_PERCENT` snapshot with `TOTAL_RPUR_VAT_AMOUNT` and header-level
  `WTOTAL_PUR_VAT_AMOUNT` / `WNET_PUR_NVAT_AMOUNT` split — i.e. **the invoice always stores the
  VAT-excl. net and the VAT amount as separate ledger figures**, exactly the convention the
  React feature adopted (VAT-exclusive prices, per-line rate from the item master, per-rate
  buckets).
- VAT amount comes from the shared global `get_calculated_vat_amount(transaction_type, qty,
  bonus, unitPrice, d1, d2, d3)` — one function used by both purchasing and sales; the React
  side similarly reuses `groupVatByRate`/`computeCostPrice` from the sales-side utils.

### 3.4 Invoice type: credit vs. debit [verified]

`wINVOICE_type` = 1 credit / 2 debit (rb_1/rb_2 "agel" pair). On save (lines 8759–8786):
- credit purchase invoice → **vendor (CUST master) balance credited** by net amount;
- debit → debited. This mirrors accounts-payable behavior; `UPDATE_CUST_TRANS_TABLE` writes a
  debit/credit row, `UPDATE_CUST_TRANS_VAT_TABLE` writes the VAT row.

[React gap] Our purchase invoices are implicitly "credit" (stock in, no vendor ledger) — the
React app has no vendor AR/AP ledger yet.

### 3.5 Save/exit flow (the giant `em_4` modified event, lines ~8645–10699) [verified]

`em_4` is the invoice-number field; the main exit/commit path lives in its `modified` event:

1. **witem_count > 0** (items exist in the invoice):
   - `UPDATE_HEADER_PUR_TABLE(...)` — header totals;
   - vendor ledger (`UPDATE_CUST_PUR_REC`, `UPDATE_CUST_TRANS_TABLE`, VAT trans, daily tables,
     `UPDATE_CUST_DAILY_BALANC`) with the credit/debit direction above;
   - optional **GL posting** behind `MGLINK`: offline (`POST_gl_transactions`) or online
     (`post_online_gl_transactions_store` with a WGL_COUNT of 5–6 GL lines and a
     `CONVERT_AMOUNT(...)` JVs including the NVAT/VAT figure). Purchase-cost-mode variants
     (`get_pur_invoice_by_sales_price` when `istr_outdata,10,2 = 1`) choose the GL basis.
   - **year-end vendor deals**: if `wcust_type = 1` and parameter pos 54/36 set, runs
     `callculate_pur_deal_amount` over the invoice (the `sle_7/sle_8` deal fields on the entry
     row, outdata pos 36).
   - commits via `commit using sqlca` with rollback on SQL error; shows
     `w_scrn_total_pur_inv` totals popup and optionally prints the invoice.
2. **witem_count = 0**: the whole invoice is **deleted** (header, cust trans, photos) — an
   empty invoice is not saved, it's removed.
3. **Modify mode** (`gm_option = 2`): re-reads `FTOTBUYF.TOTAL_TRANS`, checks
   `CHECK_PURCHAGE_INVOICE_TOTALS`, and if totals came back ≤ 0 (all lines deleted) deletes
   the header. Also edits are blocked outside a reconciliation period window
   (`check_cust_reconciliation_date`, parameter pos 128).

[React gap/philosophy] The legacy edits invoices in place (modify mode); the React feature is
**create-only with posted invoices read-only** as history — corrections are supposed to happen
as vendor credit notes. The legacy double-entry ledger behind save doesn't exist in React yet.

### 3.6 Per-line save `save_item()` [verified, lines 1737–1815]

Appends the entered line (qty/bonus/price/tiers), then **clears the line-entry editmasks**
(em_4 text, discount masks) so the operator starts a fresh line — same UX convention the
React "Add line to invoice" button follows (clears qty/batch/price fields, keeps header).

### 3.7 Settlement (prompt-payment) discount [verified, em_9 / em_15 series]

- `em_9` (istr_outdata pos 54) is an **advanced settlement-discount** percent available for
  vendors only (`wcust_type = 1`), gated by `woSETTEL_DISCOUNT / wSETTEL_DISCOUNT` vars.
- em_15-1..em_15-4 implement up to **four** sale-discount entry fields:
  pos 27 of system parameter turns sale-discount entry on/off, and the entered value must be
  ≤ parameter pos 28's cap (message 370 otherwise, lines 6721–6741), then focus hops to the
  next tier.

[React gap] No settlement/cash-discount field.

### 3.8 Item search modes [verified, event open 2545–2979]

Three `mid(gsystem_parameter, 23, 1)`-driven modes:
- `2` = **barcode search**: `sle_10` + `dw_check_stock_qty` child DW;
- `1` = USDN lookup via `dwD_name_stock` child DW (`pb_srch5`);
- else = default name search.

Same three-way idea lives in the React autocomplete (name/barcode), but the React version has
no configurable mode flag.

### 3.9 Other header fields [verified]

- `wcust_type` (position 1 of `Message.StringParm`) decides whether the party catalog is the
  vendor master (`wgfun_id "10310101"`) or customer master ("10310201") — this window is reused
  for both purchase invoices (vendor) and customer purchase/receiving variants; the
  `w_scrn_pur_invoice_cust_1` descendant inherits it for the customer case.
- `wINVOICE_type` (credit/debit), `WINVOICE_SEQ_NO` (sg shown when param pos 4 = 1 via
  `read_pur_invoice_seq_no`), `SALESMAN_NO`, invoice notes (`mle_1/mle_2`), **invoice photo
  album** (`cl_photo_album` + `pb_14` opens `w_list_photo_album_data` — scanned source
  documents! multi-line digitization), store number from `GTOTAL_USER_STORE`, and
  expected-date field `em_3-1` (`wexpected_date` = expected delivery date beside invoice date).
- Bonus of detail: cost-mode variants `istr_outdata pos 10,2`: 00 Accurate, 01 Al-Metric
  (invoice GL uses sales price basis), 02 No cost, 03 "Qaser Al Marwa" (lines 8419 note) —
  chain-specific modes.

### 3.10 Keyboard / function keys [verified]

F1–F8 map to `pb_1..pb_8` (event `key`, `pbm_keydown` handlers all me-guarded via
`me1/me2/me3/me4` flags), Enter triggers the focused button, and the whole form toggles
`disablefield()/enablefield()` (lines 1469–1737) depending on state. Buttons per key:
- F5 (`pb_5`) opens purchase-invoice print/lookup sheets (`w_print_pur_INVOICE` +
  `w_scrn_pur_invoice_barcode_1` as MDI parent) gated by `check_auth` + `check_store_auth`.
- `pb_2` prints shelf **stick labels** (`w_scrn_print_stick_selected_items`, vendor vs. retail
  function ids `103181`/`103151`).
- `pb_13` opens the bonus calculator (above).
- `pb_14` opens the invoice photo album.

## 4. UI structure [verified]

- Controls: `em_*` editmasks (header + line entry, incl. 3 tier masks em_11-1..3 + VAT),
  `st_*` static labels (colored red on focus via getfocus/losefocus), `sle_4` unit price,
  `dw_check_stock_qty` (stock check child DW), `dwD_*` lookup datawindowchildren declared in
  `type variables` (`DWL_name_stock`, `DWL_name_csvn`, `DWL_pur_trans`, `DWL_qty_stock_trans`,
  ...), `p_4` picture, `mle_*` notes, `rb_1/rb_2` credit/debit, `tab_*` pages, `groupl_1`.
- Major statics (invoice footer): `st_18` invoice no, `st_19` net, `st_19-3` VAT
  (`WTOTAL_PUR_VAT_AMOUNT`), `st_19-1` net-nonVAT, `st_10` seq no, `st_100`/`st_8` totals.
- Full window title `gfunction_description`; opening flow sets
  `wmain.key_dec5 = 10310100` (function id) + `wmain.key_dec2 = wtrans_type` and reads
  `system_parameter` rows 108/105/110/198 and `profile_parameter` wfunction_id+"00".

## 5. How the React feature compares

Feature parity by design / deliberate gaps:

| Legacy capability | React `/purchases` today | Verdict |
|---|---|---|
| Header + N lines, seq number, invoice date | Same (`PUR-xxxxxx` + seq, date) | ✅ aligned |
| Vendor master `FCODCSVN` | `vendors` array (seed + inline add) | ✅ aligned |
| Per-line batch + expiry → one FQTYITEM row per line | `catalogStore.receiveStock` per line | ✅ aligned (1 batch/line) |
| Per-line single discount `RPUR_PRICE × (1−d)` | `purchaseDiscountPercent` + round3 cost | ✅ aligned |
| **3 tier discounts** (v1, v2, v3 cascading) | only 1 discount tier | 🔴 gap |
| **Bonus qty** w/ calculator (`pb_13`) | not modeled | 🔴 gap |
| Per-line `VAT_PERCENT` + NVAT/VAT totals split | per-line vatRate + `vatByRate` buckets | ✅ aligned |
| Credit/debit purchase invoice + vendor ledger | credit only, no ledger | 🔴 gap (needs vendor AR/AP) |
| GL posting behind `MGLINK` | out of scope (no GL module) | 🔴 gap (deliberate) |
| Settlement / sale-tier discounts (em_15) | not modeled | 🔴 gap |
| Modify existing invoice | create-only; posted = history | 🔸 deliberate (credit-note workflow instead) |
| Empty invoice → deletion | no-post guard (needs ≥1 line) | ✅ equivalent outcome |
| Year-end vendor deals (`callculate_pur_deal_amount`) | not modeled | 🔴 gap |
| Reconciliation-period edit lock | posted invoices immutable | ✅ stronger than legacy |
| Double-post guard | `isVendorInvoiceNoUsed` | 🟩 React-only improvement |
| Invoice photo album (scanned docs) | not modeled | 🔴 gap (could attach file) |
| Bonus/multi-store (FSTORE_NO) | single store model | same as the whole app |

## 6. Extracted source inventory

- `_legacy_dump/w_scrn_pur_invoice_1_source.txt` — the window's own source: type/channel
  declaration (control declarations, `type variables` block 767–851 with the datawindow
  children + globals), prototypes (855–873), body functions `call_discount`, `clear_data`,
  `enablekey`, `disable*`/`enable*`, `save_item`, `on w_scrn_pur_invoice_1.create`,
  `event open` (2545–2979), `event timer`, all control key/getfocus/losefocus/modified/clicked
  events through ~line 12,108 (binary tail afterwards).
- `_legacy_dump/w_scrn_pur_invoice_1.bin.txt` — first 800k chars of the embedded datawindow
  region (contains the line-display DW SQL quoted in section 2 at index 6,878 & the batch DW
  args at index 10,783).
- The header DW SQL for the invoice browse window (arg
  `("WFAPPL_TYPE",number),("WFAPPL_SUB",number),("wfr_trans_no",number),("wcust_type",number),("wcust_no",number)`)
  and batch DW (`WFSTORE_NO`, `witem_no`, sort `fqtyitem_expiray_date A`) were read directly
  from the PBL in-session; cross-checked in the main source against the save flow.

### Verified vs. assumed, condensed

**Verified:** 3-tier discount cascade, VAT as 4th tier on net, bonus handling + calculator,
credit/debit ledger writes, empty-invoice deletion, GL hooks, reconciliation period, item
search modes, all table/column names in section 2, function-button mapping.
**Assumed:** FTOTBUYF vs FTOTBUYR split meaning; exact SQL body of the shared global functions
(they live outside this window — extracted windows in other PBLs would be needed); the meaning
of cost-modes 03 "Qaser Al Marwa" and parameter positions only partially decoded
(23 = search mode, 27/28 = sale discount gate, 36/41 = year-end deals, 54 = settlement
discount, 63/64 = maintenance log flags, 128 = reconciliation lock, 162 = partial-qty masks).

---

## 7. Modification roadmap — React feature vs. legacy (Section 5 expanded)

Ordered by priority. Items marked **[core]** close a real domain-fidelity gap; **[optional]**
items are legacy features deliberately kept out until needed.

### Phase 1 — Match the legacy line-entry math **[core] — ✅ DONE 2026-10-26**

Implementation verified against the **live XPH database** (server `Mahmoud-pc`, DB `xph`, read
via `sqlcmd -E`): real `FTRNBUYF`/`FTRNBUYR`/`FQTYITEM` schema + actual rows confirmed every
rule before coding. Schema finding: the lines tables physically carry **5** discount slots
(`DISCOUNT_1..5` decimal(5,4), amounts decimal(16,5)), but the SCR 10.58 screen exposes three,
so 3 is the React ceiling too (`MAX_PURCHASE_DISCOUNT_TIERS`).
Bonus rows live-verified: paid gross only (`TOTAL_PUR_AMOUNT = PUR_QTY × PUR_PRICE`), bonus
value separate (`TOTAL_BONUS_AMOUNT = BONUS_QTY × PUR_PRICE`), bonus never taxed (pure-gift
rows price fully at 0), batch cost diluted to `NET_PUR_PRICE = net / TOTAL_QTY`
(e.g. 8100.081 / 500 = 16.200162). VAT rows live-verified: VAT = NVAT × VAT_PERCENT
(149.592 × .15 = 22.438), per-line percent stored as a fraction (0.1500).

- **M1 · Multi-tier discount cascade** — shipped:
  - `types/purchasing.ts`: `discount1..3Percent` + `discount1..3Amount` + `discountTotal`;
    `purchaseDiscountPercent` redefined as the derived single-equivalent `1−Π(1−dₙ)`.
  - `utils/purchasing.ts`: `pricePurchaseLine` runs the legacy `call_discount()` cascade with
    round3 per tier (its own `###.###` masks). `effectiveTierDiscount` helper.
  - Tests reproduce live XPH rows (invoice 72916 d1 .31 → 67.208/149.592/22.44/172.03;
    77655 → 90.188/48.562) as regression anchors.
- **M2 · Bonus / free-goods qty** — shipped:
  - `PurchaseLine.bonusQty` / `totalQty` / `bonusValue`; totals expose `totalBonusValue`.
  - `catalogStore.receiveStock` gained optional `bonusQty` → ReceivingEvent + server backup
    keep the paid/free split; batch gets `qty` = paid+bonus.
  - `purchasingStore` posts batches with `batchReceiveDiscount(net, totalQty, price)` so
    `Batch.costPrice` lands on the diluted legacy `NET_PUR_PRICE` convention exactly.
  - UI: "Bonus (free)" field, `+n bonus` badge on line rows, separate "Bonus goods (free)"
    totals row (not charged, not taxed).
- **M2b · Bonus helper** — kept manual-only for now (the legacy `sle_7` auto-fill %); trivial to
  add later as a small helper chip.
- Store merge backfills pre-Phase-1 persisted invoices (tier amounts 0, no bonus) so history
  rows can't hit `undefined.toFixed`.
- Verified: build ✅, **67/67 tests** ✅, lint clean (same single pre-existing date-purity
  warning).

### Phase 2 — Corrections flow **[core]** (pending)

- **M5 · Vendor credit note / purchase return** (analogue: `w_scrn_ret_pur_invoice_1`).
  Legacy returns stock and adjusts the vendor ledger against the source invoice.
  Files touched: new `PurchaseReturn`-shaped types (reuse `PurchaseLine` with signed qty), store
  actions issuing negative receiving events (`purchaseInvoiceNo` + `returnOf` reference), a
  small "New Credit Note" action on the posted-history row, double-post guard on the source
  invoice. Posted invoices stay immutable; corrections are documents — stronger than the
  legacy's edit-in-place, and matches Section 3.5's reconciliation-lock philosophy.
- **M6 · Void posted invoice** — alternative to M4's full ledger: allow a posted invoice to be
  voided (reverses all line batches with negative receiving events, sets a `voidedAt`/`voidedBy`
  stamp, keeps the document in history). The legacy equivalent deletes an empty invoice and
  blocks totals-mismatch modifications; a void keeps the audit trail instead.

### Phase 3 — Vendor ledger (A/P) **[core]**

- **M4 · Credit/debit purchase invoice + vendor balance** (legacy `wINVOICE_type`,
  `UPDATE_CUST_TRANS_TABLE` / `UPDATE_CUST_PUR_REC`, Section 3.4/3.5).
  Files touched:
  - `Vendor.balance` (legacy FCODCSVN running balance) + `PurchaseInvoice.invoiceType`
    ('credit' | 'debit').
  - Store posts a vendor transaction on receive; seeds initialize `balance: 0`.
  - UI: invoice-type toggle (credit/debit) like `rb_1/rb_2`; vendor balance chip in the vendor
    picker so the operator sees the running A/P. Payment entry page is explicitly out of scope
    until ledgers exist.

### Phase 4 — Persistence / backup **[core pattern, small]**

- **M7 · Server backup of the purchase document** — same best-effort pattern as
  `salesApi.backupSale`/`receivingApi.backupReceiving` (never block the receive): new
  `src/api/purchasingApi.ts` + queue retries through `pendingSyncStore`, one POST per posted
  invoice with its lines; server then owns the FTRNBUYR-shaped rows.

### Phase 5 — Entry UX parity **[optional]**

- **M8 · Barcode line entry + stock preview** (legacy search mode `2`: `sle_10` barcode search +
  `dw_check_stock_qty` batch-check child DW, Section 3.8): add a "scan barcode" field on the
  line editor that resolves the item instantly and shows current on-hand qty/expiry/batches for
  the item before the operator types a new batch (reduces double-batch mistakes).
- **M9 · Header metadata parity** (cheap): `expectedDate` (`em_3-1` legacy expected-delivery
  date), `salesmanNo`, optional invoice-photo attach (`pb_14`'s photo album = scanned source
  documents). Keep them as optional fields on `PurchaseInvoice`; no behavior coupling.
- **M3 · Settlement / prompt-payment discount** (legacy `em_9` + em_15 chain, Section 3.7) and
  **year-end vendor deals** (`callculate_pur_deal_amount`) — deferred: these are vendor-contract
  finance features, not stock features; model only when payment tracking arrives.

### Explicitly out of scope (kept out, same as today)

- GL posting behind `MGLINK` / cost-mode variants (`get_pur_invoice_by_sales_price`, metric /
  "Qaser Al Marwa" modes) — no GL module in the React app.
- Multi-store `FSTORE_NO` — the whole app models a single store.
- Reconciliation-period edit locks — replaced by the immutable-posted-document rule.

### Success criteria

After Phases 1–2, every FTRNBUYR column has a home in `PurchaseLine` (with the pair
`DISCOUNT_n`/`TOTAL_DISCOUNT_n` and `BONUS_QTY`), and the totals card reproduces the legacy
st_11-n/st_12-n column exactly — the operator sees the same math that the SCR invoice form
printed, verified against a real vendor paper invoice.
