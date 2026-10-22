# XPH (PharmaAxis ERP) read integration

Reads real item master, batch/stock, and customer data from the **XPH** SQL Server database - the
same database the legacy PowerBuilder system and the existing `OpenMind-Backend-Net-main` .NET
API both use - by calling that existing .NET API, not by connecting to SQL Server directly. This
was a deliberate choice over a direct DB connection: it reuses the .NET backend's auth and
whatever validation it does, instead of a second system independently reading the same tables.

**Read-only.** Sales in Pharmacy-App are still recorded only in its own local store (see
`src/store/salesStore.ts` on the frontend) - nothing is written back to XPH. The legacy
PowerBuilder system may still be concurrently selling against the same stock, so writing real
sales/stock decrements from here without coordinating with that system would risk double-booking
stock or colliding invoice-number sequences. Making this read/write is a real, separate decision
for later, not an oversight here.

**The POS itself is wired to this now, not just a test panel.** `cartStore.ts`'s `scan()` tries
`erpApi.getErpItemByBarcode()` first; on a hit, `catalogStore.ts`'s `upsertErpItem()` merges the
real item + its live batches into the local catalog (namespaced id `erp-<itemNo>`, so it can never
collide with the local seed catalog) and the rest of the cart flow (FEFO batch picking, VAT,
offers, checkout, receipt) runs unchanged. If the ERP call fails or finds nothing, it falls
through to the local seed catalog - same "keep selling" principle as the ZATCA submission
fallback. Verified live end-to-end: scanning a real barcode (CEFAXON 1000MG IV INJ VIAL,
`06285101000874`) added the real item at its real batch price (48.05, correctly zero-rated),
through a full checkout to a printed receipt.

One real architecture gap this surfaced and fixed: real pharmacy pricing is set **per batch**
(`FqtyItem.sale_price`), not per item - the local seed catalog's `Item.basePrice` (one price for
the whole item) was structurally wrong for ERP-sourced items. Added `Batch.salePriceOverride` (see
`types/catalog.ts`), which `utils/pricing.ts` now prefers over `Item.basePrice` whenever it's set.

## How auth works

One shared login (`erpAuth.ts`), not per-cashier: this server logs into the .NET backend once
with a service account (`ERP_SERVICE_USER_ID`/`ERP_SERVICE_PASSWORD` in `.env`) and caches the
JWT, re-logging in once automatically on a 401. `userid=1`/`password=1` is a known-working demo
login on this dev machine (see `SESSION_STATUS.md` in `OpenMind-FrontEnd-React`) - replace with a
real service account before this touches anything but local development.

## What's confirmed live vs. guessed

All of this was found by a research pass over the .NET backend's controllers/models (see
`Controllers/Api/UserController/items/` and `Controllers/Api/UserController/MainFinancialData/
cust_vend/` in `OpenMind-Backend-Net-main`), then verified by actually calling it - not assumed.

| Entity | Route | FUNCTION_ID | Status |
|---|---|---|---|
| Item master (`FcodStock`) | `POST /api/user/FcodStock/SearchData`, `GetRecordByID` | `10210100` | **Confirmed live** - from the backend's own README_API.md changelog ("Stock Data - بيانات المخزون"), and returns real data with no 403. |
| Batch/stock (`FqtyItem`) | `POST /api/user/FqtyItem/SearchData` | `10210100` (reused) | **Confirmed live** - `FqtyItemController`'s own changelog entries list `000000000` (looks like a not-yet-assigned placeholder), so `FcodStock`'s id was tried as a guess. Works - returns real batch rows with no 403. |
| Barcode (`FcodStockBarcode`) | `POST /api/user/FcodStockBarcode/SearchData` | `10210100` (reused) | **Not yet exercised live** - no barcode value from this dev machine's XPH data was available to test with (Pharmacy-App's own seed barcodes are fictional). A 403 here specifically would mean this guess doesn't extend to it - try it before relying on it. |
| Customer/vendor (`Fcodcsvn`) | `POST /api/user/Fcodcsvn/SearchData` | `10110400` | **Confirmed working** - this exact id is already used live by the React ERP frontend's own Customers screen. |

## The actual read flow for a barcode scan

**Primary path - one call.** `FcodStock.GTIN_NO` is the real scannable barcode (user-corrected;
see the quirks section below for why the earlier "it's not the barcode" claim was wrong).
`FcodStock/SearchData`'s free-text `search` param doesn't match it, but its generic
`fieldname`/`fieldvalue` exact-match filter does:

```
POST /api/user/FcodStock/SearchData
{ "key": {...}, "filter": { "fieldname": "gtin_no", "fieldvalue": "<scanned code>", "page": 1, "limit": 1 } }
```

This returns the full item record directly - `findItemByGtin()` in `items.ts`. Confirmed live with
real barcodes (e.g. `05712249104153` → item 100004, "*ACTRAPID HM 10ML VIAL").

**Fallback path**, only tried if the above misses: the separate `FcodStockBarcode` table (one item
can have several codes there, distinct from `GTIN_NO`) -
1. `FcodStockBarcode/SearchData` with `key.item_barcode` set to the scanned code (exact match,
   not LIKE) → `item_no`.
2. `FcodStock/GetRecordByID` with that `item_no` → item master.

This fallback path's own FUNCTION_ID guess is still unverified (see the table above) since every
real barcode tried so far matched via `GTIN_NO` first.

Batches: `FqtyItem/SearchData` with the resolved `item_no` → all batch rows; filtered here to
`cur_total_qty > 0` and sorted by `expiray_date` (FEFO) - the backend has no built-in filter for
either, so that's done client-side in `getSellableBatches()`.

## Known data quirks (found via live testing, not assumed)

- **`FcodStock/SearchData` returns duplicate rows** - the same `item_no` came back 3 times in a
  row with identical field values on every field checked (looks like a join fanning out
  server-side - unit/corp/store lookups, not investigated further since it's outside this app).
  `searchItems()` dedupes by `item_no` before returning.
- **VAT is genuinely mixed in the real data, exactly as expected**: real medicines pulled live
  (e.g. "ADRENALINE / EPINEPHRINE INJ", "CEFAXON 1000MG IV INJ") show `vat_percent: 0`, confirming
  the zero-VAT-on-medicines rule this app's local seed data was corrected to match (see
  `src/utils/seedData.ts`'s comments) independently, from production data rather than assumption.
- **No "VAT registration number" field on the customer entity** - it's `vat_file_no`. A
  non-empty value there is the signal this app treats as "this is a B2B customer, issue a
  Standard invoice" (see `customers.ts`).
- **`gtin_no` on `FcodStock` *is* the real scannable barcode** - an earlier version of this doc
  claimed otherwise ("blank on every item checked"), which was just an unlucky small sample: a
  300-item pull found 166 with a populated `GTIN_NO`. User-corrected, then confirmed live with
  real barcode values. The separate `FcodStockBarcode` table is a genuine fallback (for whatever
  fraction of items don't have `GTIN_NO` set), not the primary source.
- **`VAT_PERCENT` is stored as a fraction (`0.15`), not a whole-number percentage (`15`)** - caught
  live (user-reported): item 101295 has `VAT_PERCENT = 0.15` in the database, but this module's
  `mapItem()` originally divided the raw value by 100 (assuming a `15`-style input), silently
  turning every taxable item's VAT into ~0.15% - indistinguishable from zero-rated once rounded
  for display. The zero-rated items happened to test-pass anyway (0/100 is still 0), which is why
  this wasn't caught by the earlier live checks - only a genuinely taxable item exposed it. Fixed:
  `vatRate` now uses the column value as-is, no division.

## Item search: two distinct modes, not one blended list

A barcode is unique by definition, so scanning one should resolve to exactly one product - not get
mixed into a list the cashier has to pick through. `searchItems()` reflects that with two modes,
tried in order, the first one that matches wins:

1. **Barcode (exact, unique)** - `findItemByGtin()` first, `FcodStockBarcode` as a fallback if
   `GTIN_NO` doesn't match. On a hit, returns *only* that one item and skips the browse search
   entirely (both the extra API call and the "browse" framing). Confirmed live end-to-end with
   real barcode values (e.g. `05712249104153` → item 100004) and a non-matching one (clean empty
   result, no crash).
2. **Browse (name/item number, possibly many results)** - only runs if step 1 found nothing.
   `FcodStock/SearchData`'s own `search` param already covers item number, English name, and
   Arabic name in one call. This is for a cashier typing a product name and picking the right
   variant from several real matches (e.g. "PANADOL" → 14 distinct real products) - so the search
   fetches everything in one page (`SEARCH_LIMIT = 100`, well above realistic single-product-line
   counts) rather than silently truncating, and only sets `truncated: true` when that page was
   genuinely full (there could be more) - a raw word like "قرص" ("tablet", 3000+ matches) correctly
   sets it, a specific one like "PANADOL" correctly doesn't, even though XPH's own `totalSize` for
   PANADOL (30) is larger than the deduped result count (14) - see the duplicate-row quirk above;
   comparing against `totalSize` directly (an earlier version of this function did) produces a
   false "truncated" warning on essentially every search that has any duplication, which is most
   of them.

## Multi-branch / head-office visibility - confirmed scope, and what's still missing

Real-world question: for a company with multiple separate pharmacy branches plus a head office,
can one branch's login (or a head-office login) see live stock across *all* branches, not just its
own? Tested live, not assumed:

- Every request's `fappl_type`/`fappl_sub` comes from whoever is logged in (`erpAuth.ts`'s cached
  session) - the backend filters every `SearchData`/`GetRecordByID` call by these, not just by
  what's in the URL.
- `getOtherBranchStock()`'s cross-store lookup (see above) works *within* that one `fappl_sub` -
  confirmed live, `FqtyItem/SearchData` with `fstore_no=0` returns batch rows for every `fstore_no`
  under the same `fappl_sub` (e.g. "Main Store" cust_no=1, "EXP STORE" cust_no=2 here).
- **Overriding `fappl_sub` to 0 to try to reach "every branch" does NOT work** - confirmed live,
  this returns zero rows for both `Fcodcsvn` and `FqtyItem`, even for data confirmed to exist under
  `fappl_sub=1`. There is no "see all branches" wildcard value for this field.

**Conclusion, not yet independently re-confirmed against a second real branch (this dev deployment
only has one branch's login to test with):** `fappl_sub` is almost certainly the branch/company
scope itself, and `fstore_no` is a *sub-store within one branch* (backroom vs. counter, main
warehouse vs. expired-goods store) - two different dimensions. A company with 10 physical
pharmacies + 1 head office most likely has 10 (or 11) separate `fappl_sub` values, one per branch,
each with its own login. This integration, logged in as any one branch, structurally cannot see
another branch's stock - not a bug, a deliberate scope boundary the backend enforces server-side.

**What's needed before a real head-office "stock across all branches" view can be built** (asked
the business owner 2026-10-02; answer was "no such login known / not sure" - not yet resolved):
1. Confirmation from the ERP admin whether a head-office-level login exists that XPH already grants
   cross-`fappl_sub` rights to (if yes: this server would log in with *that* account for a
   head-office-only endpoint, separate from each branch's own POS session), **or**
2. Lacking that, credentials for each of the 10 branches, so a head-office aggregator could log
   into each one in turn and merge the results (10x the login/session overhead, and a new
   `ERP_SERVICE_USER_ID`/`PASSWORD` pair per branch to manage), **or**
3. Confirmation that cross-branch reporting is intentionally only done through XPH's own existing
   desktop ERP client (which may run under a higher-privilege context this read-only API login
   doesn't have), not through this app at all.

Do not build a "head office" feature against a guessed `fappl_sub` scheme (e.g. assuming 0 or a
specific number means "head office") without testing it live first - the `fappl_sub=0` guess above
already turned out wrong once.

## Where to look for the underlying research

The full controller/model exploration (file paths, field names, request/response shapes) that
this module was built from is preserved in this session's `SESSION_STATUS.md` (in
`OpenMind-FrontEnd-React`) if the summary above isn't enough detail for something new.
