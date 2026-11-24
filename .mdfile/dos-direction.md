# DOS / Patient Directions — Implementation Record

**Project:** `F:\SOURCE\React\Pharmacy-App`
**Recorded:** 2026-11-05
**Scope:** Bilingual dosage-instruction (DOS / SIG) library, Item Master links, POS selection, post-payment directions step, and the small directions label printed after the sales invoice.

> This file is documentation only. It lives outside `src/` and `server/src/`, so it does not affect the byte-identical demo mirror.

---

## 1. What was built

A reusable, bilingual patient-direction system:

1. A **global DOS library** (`DOS-000001`, `DOS-000002`, …) of structured instructions.
2. **Item Master** links any number of library rows to an item and marks one as **Suggested**.
3. **POS** lets the pharmacist choose directions per sale line (always optional).
4. After payment and before the receipt, a **“Directions for this sale”** page lets the pharmacist review/pick directions item by item.
5. Printing the receipt can automatically print a **small 50 mm patient label** afterwards.
6. Every issued sale stores a **frozen snapshot**, so later library edits never rewrite history.

### Final flow

```
Scan items
  → (optional) choose directions per cart line
  → Checkout / Complete Sale
  → payment recorded (ZATCA, loyalty, stock all settled)
  → “Directions for this sale” page
       · per-item selector (linked rows only, Suggested first)
       · “Use suggested (N)” (explicit, optional)
       · “Skip” or “Continue to receipt”
  → Receipt dialog
       · switch: “Print directions after the invoice” (on by default)
       · “Print receipt”
  → invoice prints
  → receipt closes
  → directions label opens and auto-prints once
```

Reprints from **Sales / ZATCA** can print the same label later from the frozen sale snapshot.

---

## 2. The printed label

The output is intentionally **a label, not a document**.

### Exact content for the seeded Paracetamol example

```
Paracetamol 500mg (20 tabs)
حبة مرتين يومياً بعد الأكل
twice daily after meals
```

### Rules

| Rule | Implementation |
|---|---|
| Item name only, English now | `group.itemNameEn || group.itemNameAr` |
| Arabic schedule | `buildDosageLabel(...).labelAr` |
| English schedule | `buildDosageLabel(...).labelEn` |
| Very small text | item name 9 px bold; directions 8 px |
| Excluded | store name, invoice no., date, patient, qty, code, price, VAT, QR, footer |
| Physical width | `LABEL_WIDTH_MM = 50` |
| Height | measured from the rendered label, `@page` written just before printing |
| Preview | rendered at true 50 mm width, so measured height matches print |

### Compact label grammar

`buildDosageLabel` produces the shortest unambiguous schedule:

- **Arabic** always names the unit:
  - 1 → `حبة` (not `حبة واحدة`)
  - 2 → `حبتين`
  - 3–10 → `3 حبات`
  - 11+ → `11 حبة`
  - fractional/measured → `0.5 مل`
- **English** omits the dose only when it is 1:
  - 1 → `twice daily after meals`
  - 2 → `2 tablets twice daily after meals`
  - 5 ml → `5 ml three times daily`
- **Timing** mapping:
  - `after_food` → `بعد الأكل` / `after meals`
  - `before_food` → `قبل الأكل` / `before meals`
  - `with_food` → `مع الأكل` / `with meals`
  - `empty_stomach` → `على معدة فارغة` / `on an empty stomach`
  - `morning` → `في الصباح` / `in the morning`
  - `evening` → `في المساء` / `in the evening`
  - `bedtime` → `عند النوم` / `at bedtime`
- **Omitted from the label:** verb, route, duration (`لمدة 5 أيام` / `for 5 days`) and extra warnings. Those remain in the library, POS preview and post-payment page.

### Changing the label size

Edit one constant in `src/components/POS/DosagePrintView.tsx`:

```ts
const LABEL_WIDTH_MM = 50;
```

The preview width, `@page` width and height measurement all follow it.

---

## 3. Data model

### New file: `src/types/dosage.ts`

```ts
DosageRoute
  oral | topical | ophthalmic | otic | nasal | inhalation | rectal | vaginal |
  sublingual | injection | other

DosageFrequency
  once_daily | twice_daily | three_times_daily | four_times_daily |
  every_4_hours | every_6_hours | every_8_hours | every_12_hours |
  every_other_day | once_weekly | as_needed | custom

DosageTiming
  none | before_food | with_food | after_food | empty_stomach | morning | evening | bedtime

DosageDoseUnit
  tablet | capsule | ml | drop | puff | spray | application | sachet |
  suppository | patch | vial | unit

DosageInstructionInput
  doseAmount (string), doseUnit, route, frequency,
  customFrequencyAr/En, timing, durationDays?,
  additionalInstructionsAr/En?

DosageInstruction extends DosageInstructionInput
  id, code (DOS-000001), isActive?, createdAt?, updatedAt?

DosageSnapshot = Omit<DosageInstruction,
  'id' | 'isActive' | 'createdAt' | 'updatedAt'>
  & { dosageId?, textAr, textEn }
```

Why a string `doseAmount`: it keeps `0.5` and tapered doses without forcing an integer.

Why a snapshot: the generated `textAr` / `textEn` are stored on the sale line at dispensing time, so a later master edit cannot change what the patient was told.

### Modified types

| File | Change |
|---|---|
| `src/types/catalog.ts` | `Item.dosageIds?: string[]`, `Item.defaultDosageId?: string` |
| `src/types/cart.ts` | `CartLine.dosage?: DosageSnapshot` |
| `src/types/sales.ts` | `SaleLine.dosage?: DosageSnapshot` |

---

## 4. Utility layer — `src/utils/dosages.ts`

New file containing the whole pure logic (no React, no store imports):

- Option tables: `DOSAGE_ROUTE_OPTIONS`, `DOSAGE_FREQUENCY_OPTIONS`, `DOSAGE_TIMING_OPTIONS`, `DOSAGE_DOSE_UNIT_OPTIONS`.
- `buildDosageText(input)` — full plain-language sentence in both languages.
  - English example: `Take 1 tablet by mouth twice daily after food for 5 days.`
  - Arabic example: `تناول حبة واحدة عن طريق الفم مرتين يومياً بعد الطعام لمدة 5 أيام.`
  - Appends additional instructions as separate sentences.
  - No sig abbreviations (`BID`, `TID`, `q.d.`) — deliberate patient-safety choice.
- `buildDosageLabel(input)` — the compact label form described above.
- Numbering:
  - `DOSAGE_CODE_PREFIX = 'DOS-'`
  - `formatDosageCode`, `maxDosageNumber`, `nextDosageCode`
- Form model:
  - `DosageFormValues`, `EMPTY_DOSAGE_FORM`
  - `dosageToForm`, `formToDosageInput`
  - `validateDosageForm` (dose required, enum checks, custom schedule needs both languages, duration 1–365, max 500 chars per extra note)
  - `buildDosagePreview`
- Duplicate detection:
  - `duplicateDosageText` compares the generated English sentence (case-insensitive), ignoring the row being edited. It warns, it does not block.
- Snapshot:
  - `snapshotDosage(dosage)` freezes structured fields + `dosageId` + `code` + generated text.
- Persistence:
  - `mergeDosageMaster` keeps local edits, assigns codes to legacy rows, appends new seeds.
- Printing helpers:
  - `DosageSaleLine`, `DosagePrintGroup`
  - `groupDosageLines` merges batch-split lines of the same item + same directions, but keeps deliberately different directions separate.
  - `hasDosages`
  - `dosageRouteLabel`, `dosageFrequencyLabel`, `dosageTimingLabel`, `dosageDoseUnitLabel`

Matching test file: `src/utils/dosages.test.ts`.

---

## 5. Store layer

### New: `src/store/dosageStore.ts`

Zustand store persisted under `pharmacy-dosages`.

| Action | Behaviour |
|---|---|
| `addDosage(input, isActive)` | assigns `dos-<uuid>` + next `DOS-xxxxxx`, timestamps |
| `updateDosage(id, input, isActive)` | keeps `id`, `code`, `createdAt`; updates wording + `updatedAt` |
| `removeDosage(id)` | removes row, then calls `catalogStore.unlinkDosage(id)` |
| `dosageById(id)` | lookup |

`merge` runs `mergeDosageMaster` on rehydrate, so an existing browser keeps its edits and still receives new seed rows.

### Modified: `src/store/catalogStore.ts`

- `unlinkDosage(dosageId)`
  - removes the id from every `item.dosageIds`
  - clears `defaultDosageId` if it pointed at the removed row
  - drops `dosageIds` entirely when the last link goes
- Item updates preserve existing dosage links (`dosageIds`, `defaultDosageId`).
- Rehydration backfills links added to the starter items in `seedData.ts`.

### Modified: `src/store/cartStore.ts`

- `setLineDosage(lineId, dosage | undefined)`
- Repricing explicitly carries `dosage` across (`return { ...priced, dosage: l.dosage }`), so qty/discount/customer changes never drop directions.

### Modified: `src/store/salesStore.ts`

New action:

```ts
updateInvoiceDosages(
  invoiceId: string,
  patches: { lineId: string; dosage?: DosageSnapshot }[]
): void
```

- Applies only the `dosage` field on matching lines.
- `undefined` is a real edit (clearing directions), handled with a `Map.has` check.
- Never touches prices, VAT, payments, customer, status or ZATCA evidence.
- Deliberately **not pushed to the SQL mirror** — DOS is patient guidance, not an invoiced fact.

Matching tests: `src/store/dosageStore.test.ts`, `src/store/cartDosage.test.ts`, `src/store/salesStore.test.ts`.

---

## 6. Master data and Item Master

### Modified: `src/utils/seedData.ts`

- Added `seedDosages` with **11 starter instructions** (`dos-1` … `dos-11`, `DOS-000001` … `DOS-000011`), covering tablets, capsules, syrup ml, insulin units, topical application and injection.
- Linked seeded items:
  - Paracetamol → `dos-1`, `dos-2`; suggested `dos-1`
  - Amoxicillin syrup → `dos-3`
  - Insulin Lantus → `dos-4`
  - Vitamin D3 → `dos-5`
  - Omeprazole → `dos-6`
  - Hand Sanitizer → `dos-10`
  - Tramadol → `dos-7`
  - Diazepam → `dos-8`
  - Augmentin → `dos-9`
  - CEFAXON ERP item → `dos-11`

### Modified: `src/utils/itemMaster.ts`

- Form values gain `dosageIds: string[]` and `defaultDosageId: string`.
- `itemToForm` and `formToItemInput` round-trip both.
- `formToItemInput`:
  - de-duplicates ids
  - stores `dosageIds` as `undefined` when empty
  - only keeps `defaultDosageId` if it points at a linked row.

### New UI: `src/components/Inventory/DosageLinkEditor.tsx`

Embedded section inside the Item Master form:

- lists linked rows with `DOS-xxxxxx`, full English + Arabic text
- **Suggested** star toggle (click again to clear)
- remove-from-item button
- “Add a saved instruction” select (active, unlinked rows only)
- inline **New instruction** button opening `DosageFormDialog` and linking the created row
- warns when links point at deleted library rows

### New UI: `src/components/Inventory/DosagesPage.tsx`

Inventory → **Dosage Instructions** tab:

- code, full English + Arabic text, schedule summary, linked-item count, status, updated date
- search across code/text/route/frequency/extra notes
- Active / Inactive / All filter
- header chips: total, active, last code, next code
- row click = edit
- delete dialog lists affected items and explains that issued sales keep their snapshots

### New UI: `src/components/Inventory/DosageFormDialog.tsx`

- dose amount + unit, route, frequency (custom schedule in AR + EN), timing, duration days
- additional instructions AR + EN
- active toggle
- live bilingual preview
- **immediate duplicate warning** while typing, naming the existing code (warning only)
- validation on save

### Modified: `src/components/Inventory/ItemMasterFormDialog.tsx`

New collapsible section **“Dosage instructions (optional)”** with a linked count chip and the `DosageLinkEditor`.

### Modified: `src/components/Inventory/ItemMasterPage.tsx`

- `N directions` chip on item rows
- dosage text included in the item search index.

### Modified: `src/components/Inventory/InventoryHubPage.tsx`, `src/App.tsx`, `src/components/Layout/AppLayout.tsx`

- Route `/dosages` → `InventoryHubPage`
- tab **Dosage Instructions**
- `/dosages` highlights the Inventory nav group.

---

## 7. POS cart integration

### Modified: `src/components/POS/POSPage.tsx`

- Cart table gains a **Directions** column.
- Empty line state:
  - `Directions` button, disabled with a tooltip when the item has no links.
  - tooltip: optional choice, or “No dosage instructions are linked to this item.”
- Chosen state:
  - shows full English + Arabic text and a **Change** button.
- New `DosagePickerDialog` state (`dosageLineId`) and wiring with `setLineDosage`.

### New UI: `src/components/POS/DosagePickerDialog.tsx`

- title “Directions for use” + item name
- first option: **No written directions** (always available)
- then only the item's linked active rows, suggested first, with code + Suggested chip
- picking stores `snapshotDosage(...)`, not just the id.

---

## 8. Post-payment directions page

### New UI: `src/components/POS/DirectionsCheckoutDialog.tsx`

Opens automatically after the sale is recorded and paid, but only when at least one sold item has linked directions or one was already chosen.

- title: **Directions for this sale**
- subtitle: invoice no. + customer + “payment complete”
- success banner: sale completed, directions optional
- one card per sold line:
  - item name EN, Arabic name, batch, qty
  - selector of that item's linked active rows, **Suggested** marked
  - selected value shown as code (+ Suggested chip) so long text is not clipped
  - full English + Arabic preview underneath
  - rows whose library entry was deleted keep the existing snapshot selectable
  - items with no links show guidance to link rows in Inventory; the sale needs none
- actions:
  - **Use suggested (N)** — fills only blank lines, explicit, never auto-applied
  - **Skip**
  - **Continue to receipt** / **Continue without directions**

### POS flow change

```
payment success
  → if wantsDirections: setDirectionsSale(invoice)
    else: setReceipt(invoice)

continue
  → updateInvoiceDosages(id, patches)
  → applyDosagePatches(...) rebuilds the in-memory sale
  → setReceipt(updated)
```

`applyDosagePatches` keeps this session's receipt/label in sync with the store without a second read.

---

## 9. Receipt → label print chain

### Modified: `src/components/POS/ReceiptView.tsx`

- New prop `onOpenDosages?: (autoPrint: boolean) => void`.
- New switch (on by default when the sale has directions):
  **“Print directions after the invoice”**.
- `handlePrint()`:
  1. measures the receipt and writes `@page { size: 80mm <height>mm; margin: 0; }`
  2. `window.print()`
  3. if the switch is on and the sale has directions → `onOpenDosages(true)`
- Receipt footer note when directions exist:
  `إرشادات الاستخدام في ملصق منفصل · Directions are on a separate label.`
- Button **Directions label** opens the same label as a preview (`autoPrint = false`).

The receipt dialog is closed **before** the label mounts, so the two print areas are never visible in the same print job.

### POS wiring

```tsx
onOpenDosages={(autoPrint) => {
  const current = receipt;
  if (!current) return;
  setReceipt(null);              // close receipt first
  setDosageInvoice(current);
  setDosageAutoPrint(autoPrint);
}}
```

### New UI: `src/components/POS/DosagePrintView.tsx`

- 50 mm label, true-size preview.
- Prints only `#dosage-print-area` (everything else hidden).
- Measures real `scrollHeight` and writes `@page { size: 50mm <height>mm; margin: 0; }`.
- `autoPrint` runs once per sale id (guard against re-render/StrictMode double print), after a 250 ms paint delay so it does not race the receipt's print call.
- Manual **Print label** and **Done** for preview/reprint.

---

## 10. ZATCA / historical reprint

### Modified: `src/components/Zatca/ZatcaInvoicesPanel.tsx`

- Imports `hasDosages` and `DosagePrintView`.
- Adds a **Directions** button beside **Invoice** for any sale that carries directions.
- Opens the label from the stored `SaleLine.dosage` snapshot — exactly what was dispensed, even months later.

This does not alter the tax document. DOS is not part of the UBL/ZATCA payload.

---

## 11. Tests added

| File | Coverage |
|---|---|
| `src/utils/dosages.test.ts` | sentence generation AR/EN, Arabic dual/plural, custom schedule, fractional dose, compact label (4 cases), numbering, validation, duplicate detection, snapshot, print grouping, persist merge |
| `src/store/dosageStore.test.ts` | code assignment, edit keeps code/createdAt, delete unlinks items + clears suggested, drops `dosageIds` when last link removed |
| `src/store/cartDosage.test.ts` | snapshot survives qty/discount/customer repricing; can be cleared |
| `src/store/salesStore.test.ts` | post-payment update touches only `dosage`; clearing works; missing invoice/line is a no-op |
| `src/utils/itemMaster.test.ts` | link round-trip, default must be linked, clears both when links removed |

### Compact-label cases

- `حبة مرتين يومياً بعد الأكل` / `twice daily after meals`, with no duration and no extra warnings
- `2 tablets once daily` / `حبتين مرة واحدة يومياً`
- `5 ml three times daily before meals` / `5 مل 3 مرات يومياً قبل الأكل`
- `0.5 ml on Monday and Thursday` / `0.5 مل يوم الاثنين والخميس`

---

## 12. Verification status

At the time of this record:

| Check | Result |
|---|---|
| `npx tsc -b --pretty false` | clean (exit 0) |
| `npx vitest run` | **277 tests passed**, 18 files |
| `npm run lint` | exit 0; only pre-existing warnings (no new errors) |
| `npm run build` | passed |
| Live Playwright suite | **24 checks passed** |
| Demo mirror `src` | 117 / 117 files, 0 hash differences |
| Demo mirror `server/src` | 33 / 33 files, 0 hash differences |
| Demo `tsc` + tests | clean; **277 tests passed** |

### Live checks included

- DOS library lists seeded `DOS-000001` with AR + EN text
- new instruction gets the next code
- duplicate wording warning appears while typing
- Item Master shows multiple linked directions and the Suggested mark
- payment opens the directions page before the receipt
- suggested directions applied only via the explicit button
- receipt appears after the directions step, offers the after-invoice toggle
- receipt closes before the label opens
- label shows the item name and the compact Arabic + English schedule
- label drops duration and extra warnings
- label carries no invoice, price, quantity or code data
- invoice prints first, label second (2 print jobs)

E2E script and screenshots (outside the app):
`C:\Users\User\AppData\Local\Temp\opencode\dos-e2e.mjs`
`directions-after-payment.png`, `receipt-with-print-toggle.png`, `dosage-print-sheet.png`.

---

## 13. Data-integrity rules

These are deliberate and must be preserved by future changes:

1. **DOS is optional** on every cart line, sale and print run.
2. **Never auto-apply** a suggestion. The POS only marks it; the post-payment page fills blanks only when **Use suggested** is pressed.
3. **Snapshot, not reference**, on `CartLine.dosage` and `SaleLine.dosage`.
4. **Deleting a library row does not change issued sales.** It only removes item links.
5. **Post-payment edits touch only `dosage`.** Prices, VAT, payments, customer, status, ZATCA evidence and invoice number are untouched.
6. **DOS is not part of the tax document.** It is not sent to ZATCA and is not in the UBL XML.
7. **One print area at a time.** The receipt closes before the label mounts.
8. **Item Master can link many directions; at most one suggested.**
9. **A default must point at a linked row**; removing the link clears the default.
10. **Codes are system-assigned and stable**; editing wording never changes `DOS-xxxxxx`.

---

## 14. Complete file list

### Added

```
src/types/dosage.ts
src/utils/dosages.ts
src/utils/dosages.test.ts
src/store/dosageStore.ts
src/store/dosageStore.test.ts
src/store/cartDosage.test.ts
src/store/salesStore.test.ts
src/components/Inventory/DosagesPage.tsx
src/components/Inventory/DosageFormDialog.tsx
src/components/Inventory/DosageLinkEditor.tsx
src/components/POS/DosagePickerDialog.tsx
src/components/POS/DirectionsCheckoutDialog.tsx
src/components/POS/DosagePrintView.tsx
```

### Modified

```
src/types/catalog.ts              Item.dosageIds / defaultDosageId
src/types/cart.ts                 CartLine.dosage snapshot
src/types/sales.ts                SaleLine.dosage snapshot
src/store/cartStore.ts            setLineDosage + preserve on reprice
src/store/catalogStore.ts         unlinkDosage, preserve links, seed backfill
src/store/salesStore.ts           updateInvoiceDosages
src/utils/itemMaster.ts           form fields, link round-trip, default validation
src/utils/itemMaster.test.ts      link tests
src/utils/seedData.ts             11 seed DOS rows + item links
src/components/Inventory/ItemMasterFormDialog.tsx   dosage section
src/components/Inventory/ItemMasterPage.tsx         directions chip + search
src/components/Inventory/InventoryHubPage.tsx       Dosage Instructions tab
src/components/Layout/AppLayout.tsx                 /dosages nav group
src/App.tsx                                         /dosages route
src/components/POS/POSPage.tsx                      column, picker, post-payment step, print chain
src/components/POS/ReceiptView.tsx                  toggle, label handoff, notice
src/components/Zatca/ZatcaInvoicesPanel.tsx         historical Directions reprint
```

### Server

No server changes. `server/src` is untouched (33 files, byte-identical).

---

## 15. How to change common things

### Change the label width

`src/components/POS/DosagePrintView.tsx`:

```ts
const LABEL_WIDTH_MM = 50;
```

### Change the label's compact wording

- Schedule words: `LABEL_TIMING` in `src/utils/dosages.ts`
- Dose forms: `arabicLabelDose` / `englishLabelDose`
- Full sentences (used everywhere else): `buildDosageText`

### Change which fields print on the label

`DosagePrintView.tsx`, inside `groups.map(...)`. Keep it minimal: the requirement is item name + directions only.

### Change item suggestions

Inventory → Item Master → item → **Dosage instructions (optional)** → star the wanted row.

### Add library rows

Inventory → **Dosage Instructions** → **Add Instruction**
or from Item Master → **New instruction**.

---

## 16. Known limitations / notes

- The label currently prints the item name in **English** (current UI language requirement). The Arabic name is still stored and used as a fallback.
- The label deliberately omits duration and extra warnings; those remain in the DOS master and the post-payment page.
- ZATCA's accepted/cleared path cannot be exercised without a real Fatoora OTP and Production CSID; this feature does not depend on it.
- DOS is browser-local (Zustand persisted), like the rest of the local masters. It is **not** mirrored to the SQL sales backup by design.
- Changing a library row does not rewrite historical sale snapshots; that is intentional.

---

## 17. Commands used for verification

```powershell
# in F:\SOURCE\React\Pharmacy-App
npx tsc -b --pretty false
npx vitest run
npm run lint
npm run build

# demo mirror
robocopy "F:\SOURCE\React\Pharmacy-App\src" "F:\SOURCE\React\ERP-Demo-Build\src" /MIR
robocopy "F:\SOURCE\React\Pharmacy-App\server\src" "F:\SOURCE\React\ERP-Demo-Build\server\src" /MIR

# in F:\SOURCE\React\ERP-Demo-Build
npx tsc -b --pretty false
npx vitest run
```
