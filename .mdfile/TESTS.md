# اختبارات المشروع الحالية

> مرجع محدّث في 2026-11-24 من تنفيذ فعلي: `npx vitest run --reporter=verbose` (39 ملف / 507 اختبار) وفحص ملفات Playwright (14 spec / 43 اختبار).
> هذا الملف توثيقي فقط؛ لا يغني عن تشغيل الاختبارات عند أي تغيير.

## كيفية التشغيل

- `npm test` — كل اختبارات Vitest: `src/**/*.test.ts|tsx` + `server/tests/**/*.test.ts` (بما أن `vitest.config.ts` يضمّنها صراحة).
- `npx vitest run --reporter=verbose` — نفس المجموعة مع أسماء الاختبارات الفردية (مصدر القائمة أدناه).
- `npm run test:e2e` — اختبارات Playwright في `e2e/`، وتحتاج التطبيق والخوادم المحلية تعمل.
- `npx tsc -b` و `npx oxlint` — فحص الأنواع والتحليل الثابت (ليست اختبارات، لكنها جزء من التحقق).

## الملخص

| المجموعة | الملفات | الاختبارات |
|---|---:|---:|
| اختبارات الوحدة (src) | 36 | 467 |
| اختبارات السيرفر (server/tests) | 3 | 40 |
| اختبارات Playwright (e2e) | 14 | 43 |
| **الإجمالي** | **53** | **550** |

## اختبارات Vitest بالتفصيل

### `server/tests/rsd/normalize.test.ts` — 15 اختبار

#### normalizeGtin

- pads a GTIN-13 to the 14 digits printed under AI (01)
- keeps an already 14-digit GTIN
- rejects too-short and too-long codes

#### normalizeSerialNo / normalizeBatchNo

- accepts the 2-20 character serial range
- rejects serials outside the SFDA range
- rejects a batch longer than 20 characters

#### expiry dates

- resolves GS1 day 00 to the last day of the month
- keeps a real date unchanged
- rejects impossible dates and wrong formats

#### sale and cancel normalisation

- defaults a direct sale to the configured to-GLN and prescription placeholder
- treats "direct" and a missing to-GLN the same way
- accepts a 13-digit payer GLN and rejects anything else
- keeps a real prescription id and date, and local references
- requires a unit on both payloads
- normalises the prescription date the same way as an expiry

### `server/tests/rsd/service.test.ts` — 14 اختبار

#### Pharmacy Sale

- sends an accepted unit and stores the success + notification id
- returns the same record on a duplicate and never sends again
- refuses a serial that is not in the pharmacy inventory (11043, terminal)
- does not resend an identical rejected payload
- retries the same record once a rejected payload is corrected
- reopens a rejection caused by the account and resends the same payload
- never reopens a sale SFDA already accepted
- treats HTTP 500 and connection loss as retryable without creating new records
- serialises concurrent reports of the same unit into one send

#### Pharmacy Sale Cancel

- cancels a sold unit using the sale context
- returns already_cancelled on a duplicate cancel and never sends again
- refuses to cancel before any sale exists
- refuses to cancel a sale RSD never accepted

#### status

- counts accepted sales and cancels without exposing credentials

### `server/tests/rsd/wire.test.ts` — 11 اختبار

#### buildSaleEnvelope

- uses the verified SOAP 1.1 sale namespace and element order
- omits optional elements that were not supplied
- places optional doctor and patient before the prescription block
- escapes values so a batch number cannot break the XML

#### buildCancelEnvelope

- uses the cancel namespace and the sale context, never a local invoice id
- matches the cancel XSD exactly: no PRESCRIPTIONDATE, order TOGLN/PRESCRIPTIONID/PRODUCTLIST

#### parseSoapResponse

- reads the notification id and a namespaced per-product success code
- keeps mixed batch outcomes per product instead of collapsing them
- reads a top-level RC when the service answers without PRODUCT nodes
- reads a SOAP fault and its SFDA fault code

#### isSuccessRc

- accepts only RC 00000, ignoring whitespace

### `src/store/cartDosage.test.ts` — 2 اختبار

#### cart dosage snapshot

- survives quantity changes, discounts and customer repricing
- can be cleared again, because directions are always optional

### `src/store/cartPack.test.ts` — 8 اختبار

#### cart pack levels

- adds a box at the box price and records the 12-tablet deduction
- keeps a box line and a loose-tablet line of the same batch separate
- refuses to open a second level past the tablets the first line already claimed
- converts quantity when the cashier switches unit
- caps a quantity change at what the shelf can still cover

#### receiving a packed delivery

- turns a carton into tablets and divides the price accordingly
- defaults to boxes when no level is named
- leaves an unpacked item untouched by the conversion

### `src/store/cartSerial.test.ts` — 10 اختبار

#### scanning a serialised pack

- keeps the GTIN, serial, batch and expiry on the cart line
- adds each new serial as another sellable unit on the same line
- refuses a serial that is already in the basket
- matches the batch by batch number, not by a shared expiry date
- refuses a pack whose batch is not on hand
- normalises the printed GTIN to find an item stored as GTIN-13

#### serialised quantities

- drops the last serials when the cashier lowers the quantity
- cannot raise the quantity past the packs that were actually scanned
- freezes the selling level of a serialised packed line
- keeps a plain barcode line separate from serialised packs on the same batch

### `src/store/controlledRegisterStore.test.ts` — 5 اختبار

#### controlledRegisterStore

- keeps the register balance equal to stock across a dispense and its return
- seeds the opening row only once per item and branch
- gives each branch its own opening balance from the same shelf count
- records write-offs as outward movements with a required reason
- ignores a movement with no quantity

### `src/store/costCenterStore.test.ts` — 10 اختبار

#### setCategoryMapping

- stores a rule under the normalised key and reports the display label
- upserts instead of duplicating when the same category is saved twice
- refuses an overhead pool as the target (a pool is a source, never an owner)
- refuses an unknown or retired center
- refuses a blank category
- removes only the requested rule

#### setDrivers

- stores floor area and headcount on an operating center
- clears a driver when it is omitted
- rejects negative or non-numeric values without writing anything
- rejects overhead pools and unknown centers

### `src/store/dosageStore.test.ts` — 4 اختبار

#### dosage library store

- assigns the next system code and stores the structured fields
- keeps the code and creation time when the wording is edited
- removes dangling item links and clears the suggested default
- drops the dosageIds field entirely when the last link goes

### `src/store/inventoryMovement.test.ts` — 23 اختبار

#### inventory movement

- INCREASES quantity when a purchase invoice is received (paid + bonus units)
- creates a new batch for a lot number the shelf does not have yet
- gives two brand-new lots of the same item distinct batch ids
- DECREASES quantity when units are sold (the POS checkout path)
- puts returned units back on the same batch (the Returns path)
- never lets a sale drive stock below zero
- keeps a full cycle balanced: +7 purchase, -3 sale, +1 return = +5
- reverses the batch and the receiving log when a posted invoice is deleted
- removes a batch the invoice itself created when it is deleted
- refuses to delete when the delivery is no longer fully on hand
- reverses the old lines and posts the new ones when a posted invoice is modified
- does not touch stock when only the header is corrected
- DECREASES stock by paid + bonus units when a purchase return is posted
- refuses a return larger than the batch still holds and moves nothing
- refuses a return for a batch that is not in stock
- does not consume a PUR number when a return is posted
- numbers consecutive returns RET-000001, RET-000002
- allows a partial return and caps later returns at what was purchased
- edits a return down to a smaller quantity and puts the difference back on the shelf
- edits a partial return upward, excluding its own old quantity from the cap
- refuses an edited return beyond what the purchase allows and moves nothing
- does not touch stock when only a return header is corrected
- deletes a return, puts the units back and leaves the RET sequence intact

### `src/store/itemMasterStore.test.ts` — 12 اختبار

#### catalogStore item master CRUD

- adds an item with a generated id and the next local item number
- rejects a duplicate barcode at the store, not only in the dialog
- rejects a duplicate extra code, not only in the dialog
- updates every field except the identity/number
- allows an edit to keep its own barcode but not take another itemظآs
- toggles the discontinued flag
- refuses to delete an item that still has stock on hand
- deletes a zero-stock item together with its batches and offers

#### catalogStore convertStockToBase

- recounts every batch in tablets and divides the per-unit prices
- leaves other items alone
- scales a batch sale-price override from the old unit to the box price
- is a no-op for a factor of 1 or less

### `src/store/prescriptionStore.test.ts` — 4 اختبار

#### prescriptionStore

- captures a prescription with its expiry window and an active status
- applies a fill to the right line and derives the status
- finds a prescription by number (case-insensitive), national ID, Wasfaty reference or name
- lets the pharmacy cancel a prescription

### `src/store/rsdOutboxStore.test.ts` — 8 اختبار

#### RSD outbox store

- reports each serialised drug pack and marks it sent
- never resends a terminal rejection on its own
- keeps a network failure queued and sends it once the server is back
- blocks a cancellation whose sale RSD rejected
- reopens a rejection on the server before resending it
- sends a blocked cancellation as soon as its sale is retried successfully
- lets the server decide a cancellation when the local sale row is gone
- queues a pack once, even if the same invoice is recorded again

### `src/store/salesStore.test.ts` — 3 اختبار

#### sales dosage update after payment

- sets directions on one line without touching the other line or the document
- clears a direction again, because the step is optional and reversible
- leaves the sale untouched when the invoice or line id does not exist

### `src/store/wasfatyMappingStore.test.ts` — 13 اختبار

#### catalogStore.applyWasfatyMappings

- applies a batch in one write and marks every mapped item eligible
- normalises spaces and dashes in the code
- rejects a malformed code without writing anything
- rejects the same code twice in one batch
- rejects a code already owned by another item
- allows an item to restate its own code
- rejects a negative price
- rejects an unknown item id

#### catalogStore Wasfaty mapping audit trail

- records a manual change with the actor and the before/after values
- falls back to the username, then to an explicit unknown actor
- does not log a save that changes nothing
- records each changed item in a bulk import, and none on a repeat
- keeps only the newest 500 entries

### `src/utils/alertSound.test.ts` — 2 اختبار

#### alert sounds

- maps the three MUI alert variants to their severity tone
- ignores elements that are not MUI alerts

### `src/utils/analytics.test.ts` — 10 اختبار

#### dashboard analytics

- summarises sales and keeps returns as their own figure
- separates purchase invoices from purchase returns
- values stock at cost and retail and finds low and expiring batches
- flags an item at or below its reorder level
- finds stock that has not sold within the window, oldest money first
- treats never-sold stock as stagnant
- rolls the six-month trend without a minus row
- builds month keys across a year boundary
- filters by period using date-only comparison
- ranks vendors and customers separately

### `src/utils/controlledRegister.test.ts` — 6 اختبار

#### reconcileControlledRegister

- carries the previous closing balance forward and nets the month movement
- compares closing balance with stock on hand for a single branch
- starts a month at zero when the item had no earlier movements
- ignores entries outside the month and other branches

#### controlledRegisterCsv

- writes one row per movement with in/out split, masked patient ID and the reversal link
- labels an unassigned branch and blanks missing optional fields

### `src/utils/costCenters.test.ts` — 31 اختبار

#### isPostingOpen

- opens a normal active center inside its effective window
- rejects inactive centers, non-posting centers, and out-of-window dates
- rejects a missing center outright - every expense needs a resolvable center

#### assertParentValid

- accepts valid parenting and an undefined (root) parent
- rejects self-parenting (CK-equivalent of COSTCNO <> COSTMAIN)
- rejects a parent that does not exist
- rejects a write cycle: re-parenting the root under its own grandchild

#### collectDescendantIds / orderedCenters / centerPath

- collects the full subtree (never the root) by BFS child levels
- orders centers depth-first: roots first, then each subtree as one block
- renders readable bilingual-English paths for dialogs/history
- centerById resolves only exact ids

#### expenseTotals

- sums direct, allocatable, and subtree rollups exactly
- rounds money to 2dp (display-money convention) without losing fractional parts
- attributes amounts to unknown center ids rather than dropping the money silently

#### normalizeCategoryKey

- folds case and collapses inner whitespace so one rule covers every spelling
- leaves Arabic untouched (there is no case to fold)

#### resolveCenterForCategory

- stamps the mapped center on the line
- falls back to the store center when the category has no rule
- falls back and says so when the rule target is retired (never posts into dead history)
- honours the effective-date window on the rule target
- leaves the line unassigned when neither the rule nor the fallback is usable
- treats a missing category as unmapped, with its own note
- accepts a full ISO datetime, comparing only the date part

#### observedCategories

- groups spellings under one normalised key and counts the items
- keeps at most three sample names and skips uncategorised items

#### categoryMapExceptions

- reports unmapped categories and rules that match no item
- reports a rule pointing at a missing center as a stale target
- reports a rule pointing at an inactive center as a stale target
- is silent when every observed category has a usable rule

#### unmappedCategoryRevenue

- sums only the lines whose category has no rule, including unknown items
- returns zero when every line is covered

### `src/utils/dosages.test.ts` — 18 اختبار

#### buildDosageText

- writes plain bilingual directions, not sig abbreviations
- uses the dual and plural Arabic forms for more than one unit
- appends extra directions as their own sentences
- uses the custom schedule in both languages
- keeps a non-integer measured dose readable

#### compact label text

- prints the short schedule the owner asked for, with no duration or extra warnings
- names a two-unit dose in both languages
- keeps a measured liquid dose and a before-meal timing
- supports a fractional dose and a custom schedule

#### numbering

- formats, finds the maximum and continues the sequence

#### validation

- requires a dose and a description for a custom schedule
- rejects an out-of-range course length but accepts a blank one
- drops custom text when the frequency is not custom

#### duplicate detection

- finds a row that generates the same English directions, ignoring the row being edited

#### sale snapshot

- freezes code and generated text and drops master-only fields

#### print grouping

- merges batch-split lines but keeps contradictory directions apart
- ignores lines without directions and reports whether any exist

#### persist merge

- keeps edits, assigns missing codes and appends new seed rows

### `src/utils/fefo.test.ts` — 3 اختبار

#### FEFO with non-dated items

- sorts dated batches first, soonest expiry first, and null/no-expiry batches last
- still ignores batches with no stock
- treats a null expiry as never expiring rather than as 1900-01-01

### `src/utils/format.test.ts` — 4 اختبار

#### number display format

- groups thousands and keeps two decimals for money
- shows quantities without forced decimals but groups thousands
- keeps three decimals on unit prices and groups thousands
- never prints NaN or undefined

### `src/utils/gs1.test.ts` — 11 اختبار

#### parseGs1

- reads GTIN, expiry, batch and serial from a full pharmaceutical DataMatrix
- reads a serial that runs to the end of the payload (no trailing separator)
- stops at the separator between two variable-length AIs
- recognises a GS1 payload by its 14-digit GTIN prefix
- resolves a day-00 expiry to the last day of the month

#### normalizeGtin

- pads a GTIN-13 to the 14 digits printed under AI (01)
- leaves an already 14-digit GTIN alone
- rejects empty and over-long codes

#### gtinCandidates

- offers the unpadded form the item master stores for a GTIN-13
- does not invent a shorter code when there is nothing to strip

#### serialKey

- keeps the same serial string distinct across different products

### `src/utils/itemMaster.test.ts` — 33 اختبار

#### item numbering

- derives legacy numbers from seed and ERP ids when itemNo is missing
- prefers a stored itemNo
- numbers local items above existing local numbers but ignores ERP numbers

#### item dosage links

- keeps linked directions and a default that points at one of them
- never saves a default that is not linked
- clears both when the owner removes every link

#### item form conversion

- folds a legacy GTIN into the barcode list on edit
- turns blank optional text into undefined instead of empty strings
- defaults an item to having an expiry date and stores only the opt-out

#### item Wasfaty mapping

- round-trips a NUPCO code, approved price and eligibility
- normalises spaces and rejects a non-13-digit code
- refuses a code already mapped to another item
- requires eligibility when a code is entered and validates the approved price
- saves blanks as undefined rather than empty strings

#### item validation

- accepts a complete valid form
- requires an English name and barcode
- rejects a barcode already used by another item but allows the item being edited
- validates and de-duplicates extra barcodes
- rejects a negative price, a fractional reorder level and max below reorder
- rejects a carton quantity below one
- duplicateIdentityErrors is case-insensitive on the barcode

#### one item, many barcodes / GTINs

- lists the main code, a legacy GTIN and the extra codes once each
- finds an item by any of its codes, not just the main one
- flags a clashing code as it is typed, naming the item that already owns it
- rejects malformed codes before saving

#### item movement totals

- derives balance, lifetime movements and stock values
- prefers a batch sale-price override over the item price
- values packed stock by tablets-per-box, not tablet count x box price

#### pack ladder on the item form

- round-trips a ladder through the form
- treats three blank rows as "no ladder", keeping old items unchanged
- rejects a half-filled or non-positive ladder
- allows a ladder that stops at the box (no carton level)
- suggests the old unit as the conversion source when an unpacked item gets a ladder

### `src/utils/manufacturers.test.ts` — 9 اختبار

#### company numbering

- shows the number as a plain integer, like the legacy company screen
- takes the highest existing number, not the row count
- ignores malformed or legacy values instead of NaN-ing the sequence
- returns zero for an empty master and continues from 1
- previews the next free number
- detects a number already owned by a different company

#### manufacturer display helpers

- labels a picker row with the number and English name
- resolves a stored number to the current name
- falls back to the stored number when it is not in the master

### `src/utils/packUnits.test.ts` — 9 اختبار

#### pack ladder

- counts tablets at every level
- derives strip and tablet prices by exact division from the box price
- splits an on-hand tablet count into whole packs
- never reports a partial lower unit as sellable
- converts selling units to tablets (what checkout deducts)
- degrades a malformed ladder to 1 instead of NaN or zero

#### box-only ladder (no carton)

- prices box, strip and tablet exactly from the box price
- hides the carton level in stock breakdowns and purchasing
- prints sub-halala unit prices without rounding them to 2 decimals

### `src/utils/party.test.ts` — 5 اختبار

#### party table

- puts vendors and business customers in one table with their type_flag
- carries the vendor-file fields on a customer row too
- treats a row with no explicit isActive flag as active
- filters cleanly by type_flag for the vendor/customer switch
- labels the two sides

### `src/utils/prescriptionLabel.test.ts` — 8 اختبار

#### prescription label

- prints every field SFDA expects on a dispensing label
- states the remaining refills after this fill, in both languages
- prints compact bilingual directions plus the course length
- still labels a prescription with no directions recorded
- labels the fill it is given, not the newest one
- previews the remaining quantity when nothing has been dispensed yet
- produces one label per prescription line
- names the source and its Wasfaty reference when the prescription came from Wasfaty

### `src/utils/prescriptionRules.test.ts` — 12 اختبار

#### validity

- adds the validity window in whole days
- treats the prescription as valid through its expiry date, expired the next day
- recomputes a stale active status when the record is read

#### partial dispensing

- dispenses 10 then 20 and refuses a third fill
- refuses a quantity larger than what remains

#### refills

- authorises 1 fill + 2 refills = 90 units and stops there
- knows when a dispense opens a refill rather than continuing a fill
- warns early when a refill is requested too soon after the previous fill
- reads the course length from the sig, falling back to the legacy field
- flags more than 2 refills and more than 90 days of supply

#### gate overrides

- blocks an expired prescription unless a reason is recorded, then keeps the reason
- never allows a cancelled prescription through, with or without an override

### `src/utils/pricing.test.ts` — 39 اختبار

#### resolveSalePrice

- falls through to the item-level price when the batch has no override (local seed data)
- prefers the batch-level price when set (real XPH pricing is per batch)
- respects a zero-price override rather than treating it as "unset"

#### computeCostPrice

- applies the vendor discount
- keeps sub-halala precision (round3, not round2)

#### priceCartLine - base pricing

- charges gross = qty * unitPrice, no discounts, zero-rated
- adds per-line VAT on the net amount for a standard-rated item
- carries bilingual names, unit, batch metadata and expiry onto the line
- reuses the passed-in id so re-pricing keeps the line stable
- generates an id that includes the batch id when none is given

#### priceCartLine - percent offers

- cuts the gross by the offer percent before tier discount
- skips inactive offers entirely (no label, no discount)
- honours the offer window inclusively on both ends

#### priceCartLine - value offers

- applies the flat SAR amount per unit (not for the whole line)
- clamps to the gross so it can never make the line negative

#### priceCartLine - buy-X-get-Y offers

- charges floor(qty / bundle) * freeQty units for the bundle remainder
- does not round up partial bundles

#### allocateBogoFreeUnits - one item split over several batch lines

- counts bundles over the item total, not per line
- returns nothing while the combined quantity is below one bundle
- caps allocation at each line quantity and spills the remainder onto the next line

#### priceCartLine - bogo allocation params

- uses the allocated count instead of re-counting the line on its own
- labels a sibling line that holds no free units, and drops its manual discount

#### priceCartLine - manual (cashier-entered) discounts

- reads "amount" as a flat SAR discount for the whole line
- reads "percent" as a fraction of the gross (matching the app's 0.15 = 15% convention)
- drops the manual discount when an offer is already active on the line
- caps a manual discount at the remaining gross

#### priceCartLine - tier discount stacking

- applies the tier rate on whatever remains after the offer (legacy two-stage flow)
- applies the special-tier rate with no offer
- leaves the normal tier at zero discount

#### computeCartTotals

- sums every line and groups VAT by the rates actually present
- aggregates each line's own precomputed discount

#### pack-ladder pricing

- charges the box price at box level and derives strip/tablet prices
- keeps a loose-tablet sale total equal to the box price
- leaves an item without a pack ladder on its own unit

#### buy-X-get-Y offers are measured on the box for packed items

- does not pay out a free box for a few loose tablets
- pays one free box once three boxes worth of tablets are in the cart
- values the free gift at the box price whatever level the line is sold in
- does not treat 3 strips (1.5 boxes) as a box bundle
- allocates free tablets across mixed-level lines, box line first

### `src/utils/purchasing.test.ts` — 50 اختبار

#### pricePurchaseLine

- prices a plain zero-rated line: cost via round3, vat zero
- applies the line discount before VAT, mirroring a real vendor invoice
- rounds unit cost to 3 decimals - the XPH net_pur_price 2.402 case
- computes per-line input VAT from the ITEM master vatRate for a standard-rated item
- XPH row (FTRNBUYF 72916/106523): 21.68 x10 @ d1 .31 -> net 149.592, VAT 22.44, incl 172.03
- XPH row (FTOTBUYF 77655/108235) with the odd .1666 chain: 9.25 x15 @ .65 -> net 48.562
- cascades three tiers sequentially - 20% + 15% + 10% is NOT 45%
- effectiveTierDiscount is multiplicative, matching the cascade algebra
- caps at the legacy screenظآs three tiers
- tracks bonus goods at zero charge but dilutes the batch discount
- a pure-gift line prices fully at zero, like the XPH gift rows
- batchReceiveDiscount equals the plain tier discount when there is no bonus
- carries bilingual names, unit and vatRate snapshot onto the line
- re-uses the passed-in id so re-pricing keeps the line stable
- generates a fresh unique id when none is given
- is exactly computeCostPrice for the unit-cost arithmetic

#### dilutedUnitCost

- spreads the paid net over paid + bonus units - the user 100 + 10 @ 20 case
- equals the tier-discounted price per unit when there is no bonus
- recalculates through disc1/disc2/disc3 before diluting with bonus units
- agrees with the batch costing path (batchReceiveDiscount + computeCostPrice)
- prices a pure-gift line at zero and guards empty quantities

#### previewPurchaseLine

- shows each cascade tier as the money it takes off the gross
- matches the line that posting actually produces
- reads zero before a quantity or price is typed

#### computePurchaseTotals

- sums gross, discounts, net and input VAT across lines
- groups input VAT per rate - same mixed-bucket split as sales
- accumulates bonus goods separately and never taxes them
- returns clean zeros for an empty invoice

#### vendor dedup semantics

- documents the Vendor shape used by the store seed and page

#### system-assigned vendor numbers

- formats with the VEN- prefix and six zero-padded digits
- starts at VEN-000001 when the vendor master is empty
- continues after the highest number, not the count (no reuse after a gap)
- ignores malformed or missing numbers instead of crashing
- pads past 999999 rather than wrapping (numbers must stay unique)

#### formatDiscountPercent

- renders the stored fraction as a percentage - 0.1667 prints 16.67%
- keeps exact rates exact
- always renders two decimals with the ##.## mask

#### discount input mask

- accepts at most two digits before and after the decimal point
- inserts the decimal point automatically after two digits
- keeps an explicitly typed point and rejects a third decimal
- ignores characters outside the mask
- never produces more than two decimals
- seeds an edit field from the stored fraction with two decimals
- converts the typed whole percentage back to the stored fraction
- round-trips a typed percentage through storage and back into the field

#### lastPurchaseUnitPrice

- returns the price from the newest posted purchase, not the first or the highest
- ignores credit notes and the invoice currently being corrected
- converts a box price into the requested strip price through the pack ladder
- returns null when the item has never been purchased
- keeps a null expiry as null rather than inventing a date

### `src/utils/rsdOutbox.test.ts` — 7 اختبار

#### RSD outbox builders

- queues one sale per serialised drug pack and skips everything else
- cancels only lines this return took all the way back
- treats a sale and a cancel of the same pack as two different movements

#### RSD summaries

- says an invoice with no queued units is not reportable (no drug, or no serial)
- is only "sent" when every unit on the invoice was accepted
- treats a blocked cancel as needing attention, not as queued
- counts the whole queue by status

### `src/utils/rsdUnits.test.ts` — 5 اختبار

#### RSD reportable lines

- reports a batch-tracked drug with captured serials
- skips an item whose Batch / expiry tracking is off, even with a serial
- treats a missing snapshot as not reportable
- skips a tracked item with no captured serials
- drops a serial without an expiry date

### `src/utils/vat.test.ts` — 24 اختبار

#### round2

- rounds a sum of floats to 2 decimals instead of leaking binary noise
- rounds down to 2 decimals
- rounds up to 2 decimals
- leaves exact 2-decimal values alone
- never produces extra floating-point dust

#### round3

- keeps sub-halala precision that round2 would truncate
- rounds to at most 3 decimals
- rounds cleanly

#### lineVat

- is zero for zero-rated lines (SFDA-registered medicines)
- computes 15% standard-rate VAT at 2-decimal SAR precision
- rounds the result to 2 decimals

#### lineTotalInclVat

- adds VAT on top of the net amount (prices are stored VAT-exclusive)
- is unchanged for zero-rated lines
- equals net + lineVat for the same inputs

#### groupVatByRate

- returns no buckets for no lines
- puts same-rate lines into one bucket and sums both amounts
- keeps 0% and 15% as separate buckets - the normal pharmacy case
- orders buckets by descending VAT rate
- handles three distinct rates
- is consistent between sums accumulated either way

#### VAT number input rules

- accepts a complete 15-digit number and nothing shorter/longer
- keeps only digits while typing
- stops dead at 15 digits (the 16th keystroke never enters the field)
- allows the field to be null (blank) - only a typed value must be 15 digits

### `src/utils/vendors.test.ts` — 11 اختبار

#### vendor form validation

- requires both names
- accepts a blank VAT number but requires exactly 15 digits when present
- requires exactly 13 digits for a GLN when present
- rejects negative or fractional settings
- accepts zero credit and zero settlement days

#### vendor form mapping

- maps a stored vendor into strings without losing optional fields
- turns blank optionals into undefined, not zero
- trims names and notes before saving

#### vendor master persist merge

- backfills new vendor-file fields on a persisted seed row and keeps the owner edit
- assigns a unique number to a persisted vendor saved before numbering existed
- appends a brand-new seed vendor to an older persisted master

### `src/utils/wasfaty.test.ts` — 15 اختبار

#### NUPCO code mapping helpers

- normalises spaces and dashes and accepts only 13 digits
- refuses a code already mapped to another item, ignoring spacing
- treats an explicitly ineligible item as not covered even if it still has a code
- reports mapping coverage for active items only

#### patient ID handling

- masks all but the last four digits
- validates the manual session fields

#### Option A coverage arithmetic

- sums only covered lines and leaves non-covered lines to the patient
- uses the NUPCO-approved price for a covered line and ignores an ERP batch override
- lists covered lines that have no NUPCO code

#### claim export

- builds one stable row per covered line with a masked patient ID
- filters by month and branch
- flags missing mapping, authorization and zero claim instead of exporting a clean zero
- writes a header plus escaped CSV rows
- builds numeric Excel rows with the same columns as the CSV
- summarises claim rows by item and adds up repeated lines

### `src/utils/wasfatyImport.test.ts` — 21 اختبار

#### parseDelimitedRows

- parses comma, tab and semicolon files
- handles quoted fields, escaped quotes and embedded delimiters
- drops blank lines and a UTF-8 BOM

#### planWasfatyImport

- maps a header CSV by barcode and records the approved price
- reads a headerless paste as code, barcode, price
- accepts a single column where the code is also the barcode
- matches by item number when the file is an internal export
- matches alias barcodes and GTINs
- falls back to the code as a barcode when the barcode column does not match
- skips rows for items this pharmacy does not stock, without blocking the import
- rejects a code that is not 13 digits
- rejects a duplicate code inside the file
- rejects the same local item appearing twice
- rejects a code already mapped to another local item
- rejects a match that hits more than one local item
- marks an already-identical mapping as unchanged and does not apply it again
- applies a changed price even when the code is already mapped
- rejects a negative or non-numeric price
- rejects an explicit "not eligible" row
- accepts common header aliases
- returns an empty preview for blank input

### `src/utils/zatcaIdentity.test.ts` — 17 اختبار

#### deriveCommonName

- is <terminal>-<solution>-<release>, the format the PB CSID screen builds
- changes with the terminal number, so two registers cannot share a certificate

#### deriveEgsSerial

- is 1-<solution>|2-<release>|3-<uuid>
- does not include the terminal number (that lives in the Common Name)

#### vatNumberError

- allows blank - a store may not be VAT-registered while it is being set up
- accepts the ZATCA 15-digit 3...3 form
- rejects a number that is too short or too long
- rejects non-digits and wrong first/last digits

#### identityDraftErrors

- accepts a complete identity
- accepts blank optional seller fields (draft identity)
- rejects a terminal number below 1
- rejects blank solution name/release - they are half of the certificate identity
- rejects "|" in the solution parts because it delimits the EGS serial
- surfaces the VAT format problem

#### invoice type choices

- offers exactly the three ZATCA flags, with simplified first for a POS

#### CSID presentation

- labels every lifecycle state
- turns days-until-expiry into readable text

### `src/utils/zatcaInvoice.test.ts` — 15 اختبار

#### primaryPaymentMethod

- reports the largest non-points tender on a split sale
- treats a points-only sale as cash - ZATCA has no points tender
- never reports points even when they dominate the sale

#### buildSubmitRequest

- sends the stored line economics unchanged
- keeps the buyer VAT number on a standard invoice and drops it on a simplified one
- falls back through the customer name fields and finally to Walk-in Customer

#### statusFromSubmission

- maps cleared/reported onto the matching stored status
- maps accepted_with_warnings by the DOCUMENT type, not the answer wording
- treats failed as a rejection

#### zatcaPatchFromSubmission

- stores the full Phase 2 evidence on acceptance
- never overwrites the QR or claims a submission time on rejection

#### needsResubmission

- covers never-tried, attempted-and-not-accepted and rejected invoices
- leaves accepted invoices alone

#### zatcaSummary

- counts documents per state, not money

#### shortUuid

- keeps short values intact and abbreviates long ones without hiding the tail

## اختبارات Playwright (E2E) بالتفصيل

### `e2e/controlled-register.spec.ts` — 3 اختبار

#### controlled drug register

- records a dispense and its return, keeping the balance equal to stock
- finds an item by name from the search box, even before anything has moved
- writes off expired stock as an outward register row

### `e2e/customer.spec.ts` — 3 اختبار

#### customer lookup

- an existing seed customer is found by phone, with points balance shown
- a new customer requires a 10-digit national ID before it can be created
- walk-in has no points balance shown and never gates checkout

### `e2e/dashboard.spec.ts` — 1 اختبار

#### business dashboard

- opens from the sidebar and shows every analysis section

### `e2e/insufficient-qty.spec.ts` — 1 اختبار

#### insufficient quantity warning

- requesting more than what is in stock clamps the qty and warns the cashier

### `e2e/inventory.spec.ts` — 2 اختبار

#### Inventory & Expiry page

- renders normally
- does not crash when localStorage has a pre-purchase-price batch shape

### `e2e/loyalty.spec.ts` — 1 اختبار

#### loyalty points

- a new customer earns points on a qualifying sale, then can redeem them

### `e2e/offer-split-batch.spec.ts` — 3 اختبار

#### BOGO offer across batches

- buy 2 get 1 free still applies when the three units are split over two batches
- two units across two batches still do not qualify - the offer needs a full bundle
- completing a bundle drops a manual discount already given on the sibling batch

### `e2e/pos-sale.spec.ts` — 3 اختبار

#### core POS sale flow

- scan an item, pay cash, get a receipt
- scanning an unknown barcode shows a warning, not a crash
- a DataMatrix scan keeps the pack serial and refuses a duplicate

### `e2e/prescription.spec.ts` — 5 اختبار

#### prescription / controlled-substance gate

- checkout is blocked until prescriber + patient info is captured
- a non-controlled item never shows the prescription gate
- fills partially, reuses the prescription on the next sale and shows both fills in the registry
- an expired prescription needs a written override before it can be dispensed
- labels the dispensed box bilingually with the refills left, from the receipt and from the registry

### `e2e/purchase-returns.spec.ts` — 3 اختبار

#### purchase returns

- posts a partial return against a purchase and removes only the returned quantity
- returns a customer purchase with a manual line and refuses an over-return
- views, modifies and deletes a posted return from the history row actions

### `e2e/purchasing.spec.ts` — 5 اختبار

#### purchase invoices

- books a customer purchase from the party table and prints it as a customer document
- shows each line\
- modifies a posted invoice header and then deletes it
- receives an item with no expiry date and refuses a line without a purchase price
- refuses lines until the vendor and their invoice number are entered

### `e2e/returns.spec.ts` — 5 اختبار

#### sales returns

- a completed sale can be found and fully returned
- an unknown invoice number shows an error, not a crash
- a walk-in sale can be found by the Walk-in Customer label
- an invoice can be found by the customer phone number
- a phone that matches several invoices lists them for the cashier to choose

### `e2e/wasfaty.spec.ts` — 7 اختبار

#### Wasfaty / NUPCO dispensing

- a covered item is invoiced at the approved price and the patient pays 0.00
- an eligible item with no NUPCO code blocks checkout instead of charging the patient
- mapping an item on the Wasfaty screen makes it dispensable
- bulk NUPCO import previews errors and maps several items in one batch
- claim report exports Excel and opens the printable report
- server claim ledger submits a claim and records a reconciliation
- the connector panel reports capabilities and stays honest when the server is down

### `e2e/zatca-invoices.spec.ts` — 1 اختبار

#### ZATCA sales invoices

- reprints the A4 invoice and the customer receipt from the ledger

