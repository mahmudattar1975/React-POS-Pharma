# Discount format — one convention for the whole app

This is the single rule every discount field and readout in the Pharmacy app must follow.
It exists so purchasing, receiving, offers and the POS can never disagree about what
`16.67` or `0.1667` means.

---

## 1. The rule in one line

**The user types a percentage (`16.67`), the app stores a fraction (`0.1667`), and every
readout prints it back as a percentage (`16.67%`).**

| Layer | Value | Example |
|---|---|---|
| What the user types / sees in an input | whole percent, `##.##` mask | `16.67` |
| What the store / pricing layer keeps | fraction = percent ÷ 100 | `0.1667` |
| What the UI prints in a table, dialog or printout | fraction × 100, 2 decimals, `%` | `16.67%` |

- `5%` → typed `5` → stored `0.05` → shown `5.00%`
- `7.5%` → typed `750` (point is automatic) or `7.5` → stored `0.075` → shown `7.50%`
- `0%` / blank → stored `0` → shown `0.00%` or `—` where the column uses a dash for “no discount”

> **Never store the percentage itself.** A stored `16.67` would be read by the pricing code as
> a 1667% discount. The fraction is the only storage format.

---

## 2. The input mask

All discount entry uses the shared component:

```
src/components/common/DiscountInput.tsx
```

It renders an MUI `TextField` with:

- `type="text"` (not `number` — the mask controls every keystroke)
- `placeholder="00.00"`
- a `%` end adornment
- `maxLength={5}` (`00.00` is the longest legal value)
- `inputMode="numeric"`
- the standard helper text `e.g. 0.1667 = 16.67%`
- automatic decimal point insertion

### Automatic decimal point

The user does **not** type the dot. Digits are read as a fixed `##.##` value:

| Keystrokes | Field value | Meaning |
|---|---|---|
| `1` | `1` | 1% |
| `12` | `12` | 12% |
| `121` | `12.1` | 12.1% |
| `1214` | `12.14` | 12.14% |
| `1667` | `16.67` | 16.67% |
| `5` | `5` | 5% |
| `750` | `7.50` | 7.5% |

An explicitly typed point still works (`16.67`), and the same two-before / two-after limit
applies. A third decimal place, a letter, a minus sign or a comma is ignored, so the field
always holds a legal value.

The legal shape is:

```
^\d{0,2}(\.\d{0,2})?$
```

This means the mask tops out at **99.99%** — `100` is not enterable by design.

---

## 3. The helpers

All of them live in:

```
src/utils/purchasing.ts
```

| Export | Purpose | Example |
|---|---|---|
| `DISCOUNT_FRACTION_HINT` | the one helper text string | `e.g. 0.1667 = 16.67%` |
| `DISCOUNT_INPUT_PATTERN` | the `##.##` validation regex | `^\d{0,2}(\.\d{0,2})?$` |
| `applyDiscountMask(raw)` | sanitizes a keystroke/paste and inserts the point | `1214` → `12.14`; `16a` → `null` (ignore) |
| `formatDiscountInput(fraction)` | seeds an edit field from stored data | `0.1667` → `16.67`; `0.05` → `5.00` |
| `discountInputToFraction(value)` | converts typed percent to storage | `16.67` → `0.1667`; blank → `0` |
| `formatDiscountPercent(fraction)` | readout formatter | `0.1667` → `16.67%`; `1/6` → `16.67%` |

Rounding note: readouts round to two decimals (`1/6` prints `16.67%`, not `16.66%`).
Do not add local `Math.round(x * 100)` / `toFixed(2)` logic — use `formatDiscountPercent`.

---

## 4. How to add a discount field

```tsx
import { useState } from 'react';
import DiscountInput from '../common/DiscountInput';
import { discountInputToFraction, formatDiscountInput } from '../../utils/purchasing';

// 1. Hold the typed percentage as a string.
const [discount, setDiscount] = useState('');

// 2. Render the shared input. Do not hand-roll a TextField for a discount.
<DiscountInput
  label="Discount"
  value={discount}
  onChange={setDiscount}
  fullWidth
/>

// 3. Convert once, at the boundary where the value is saved.
const stored = discountInputToFraction(discount); // "16.67" -> 0.1667

// 4. When editing an existing row, re-seed through the formatter.
setDiscount(formatDiscountInput(row.discountPercent)); // 0.1667 -> "16.67"

// 5. When reading it back, format through the shared readout helper.
formatDiscountPercent(row.discountPercent); // 0.1667 -> "16.67%"
```

Rules for new code:

- Use `DiscountInput` for **every** discount entry field.
- Use `discountInputToFraction` when saving, `formatDiscountInput` when re-seeding an edit form.
- Use `formatDiscountPercent` for every table cell, dialog, receipt or printout.
- Keep the stored value a fraction end-to-end.

---

## 5. Where the convention is applied today

| Area | Entry | Stored field | Readout |
|---|---|---|---|
| Purchase invoice — 3 vendor tiers | `PurchaseInvoicePage` → `DiscountInput` ×3 | `discount1Percent` / `2` / `3` (fractions) | per-line tier columns, view dialog, A4 goods-received printout |
| Stock receiving | `ReceivingPage` → `DiscountInput` | `Batch.purchaseDiscountPercent` | Inventory batch table |
| Offers — % off | `OfferFormDialog` → `DiscountInput` | `Offer.percent` | Offers list (`formatDiscountPercent`) |
| POS line discount — % mode | `LineDiscountPopover` → `DiscountInput` (`Discount %`) | `CartLine.manualDiscountValue` (fraction when type is `percent`) | POS line discount button / pricing |
| Purchase totals | — | computed from tier fractions | one combined “Purchase discounts” total, no tier breakdown in totals |

The POS amount mode (`SAR`) is **not** a discount percentage: it stays a plain SAR number
with a `SAR` adornment and is stored as-is.

---

## 6. Purchase tier cascade (why three fields)

Purchase invoices support up to three cascading vendor discounts, exactly like the legacy
`em_11-1..3` fields:

- Discount 1 comes off the paid gross.
- Discount 2 comes off what is left after Discount 1.
- Discount 3 comes off what is left after Discount 2.

Algebraically:

```
net = gross × (1 − d1) × (1 − d2) × (1 − d3)
```

- Each `d` is a fraction (`0.1667`), entered as a percent (`16.67`).
- Leaving a tier blank means that tier is `0`, so the cascade stops there.
- Bonus (free) goods are never discounted and never taxed; they only dilute the batch’s
  per-unit cost (`net ÷ (paid + bonus)`).

Example: paid gross 1000, tiers `16.67%` and `5%`:

```
tier 1 = 1000 × 0.1667 = 166.70        → running 833.30
tier 2 = 833.30 × 0.05 =  41.665       → running 791.635
net    = 791.64 (rounded per the pricing helpers)
```

---

## 7. Do / Don't

| Do | Don't |
|---|---|
| Type/store/display through the helpers | Do arithmetic inline in a component |
| Keep `discount1Percent` etc. as fractions | Store `16.67` in a `…Percent` field |
| Use `DiscountInput` | Add `type="number"` discount fields |
| Use `formatDiscountPercent` for readouts | Use `` `${x * 100}%` `` or `Math.round` locally |
| Show `e.g. 0.1667 = 16.67%` | Invent per-screen hint text |
| Re-seed edit forms with `formatDiscountInput` | Re-seed with `String(fraction)` |

The only place the fraction itself appears in the UI is the shared helper text — it is
there to explain the storage format, not to ask the user to type it.

---

## 8. Tests that lock the convention

Unit tests (`src/utils/purchasing.test.ts`):

- `formatDiscountPercent` — `0.1667` → `16.67%`, `1/6` → `16.67%`, `0.05` → `5.00%`
- `applyDiscountMask` — `1214` → `12.14`, `1667` → `16.67`, explicit point, rejected characters, two-decimal cap
- `formatDiscountInput` / `discountInputToFraction` — round-trip `16.67` → `0.1667` → `16.67`
- `DISCOUNT_INPUT_PATTERN` — accepted/rejected shapes

E2E:

- `e2e/purchasing.spec.ts` — types `1667` into Discount 1 and asserts the field becomes
  `16.67`; line shows `16.67%` / `5.00%`; edit re-seeds `16.67` / `5.00`
- `e2e/offer-split-batch.spec.ts` — POS `Discount %` accepts `15` and applies 15%

Run:

```bash
npx tsc -b
npx vitest run
npx playwright test
npm run build
```

---

## 9. Compatibility

- Values already persisted in `localStorage` (`pharmacy-catalog`, `pharmacy-purchasing`,
  `pharmacy-sales`, …) are **already fractions**, so no migration is needed. The change is
  only in how the input is typed and how the value is displayed.
- Existing purchase lines keep `discount1Percent` / `2` / `3` as fractions; reopening one
  for edit shows the percentage and saves the fraction back.
- The demo mirror (`F:\SOURCE\React\ERP-Demo-Build`) must stay byte-identical for `src`,
  `server/src` and `e2e` after any change to this convention.
