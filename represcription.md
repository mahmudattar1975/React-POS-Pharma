

## 1. Purpose

The POS currently captures a small prescription record at checkout. This document:

1. summarises what public Saudi and international sources say a pharmacy system must support;
2. lists the gaps in the current app;
3. proposes a feature set, data model, file layout and phased rollout.

The goal is to turn the one-shot "Prescription Required" dialog into a real
**prescription registry** with refills, partial dispensing, bilingual labels and a
controlled-drug register — without needing a backend (the app stays local-first).

---

## 2. Current state (verified in this repo)

| Area | Current behaviour | File |
|---|---|---|
| Trigger | Checkout opens the capture dialog only when the cart has an item whose `controlledStatus` is set | `src/components/POS/POSPage.tsx` |
| Fields | source (`private` / `wasfaty`), Wasfaty ref no, prescriber name, prescriber ID, Rx no, Rx date, patient national ID | `src/components/POS/PrescriptionCaptureDialog.tsx` |
| Validation | prescriber name + Rx no + Rx date + 10-digit national ID (+ Wasfaty ref when source is Wasfaty) | same |
| Storage | one `PrescriptionInfo` object attached to the invoice; each sale line snapshots `controlledStatus` | `src/types/sales.ts` |
| Controlled classes | `prescription`, `schedule_a` … `schedule_e` | `src/types/catalog.ts`, `src/utils/controlledSubstances.ts` |
| Receipt | shows the invoice; no dose/refill/label output | `src/components/POS/ReceiptView.tsx` |

So the app records **who prescribed what, for whom, when** — but it does not manage the
prescription itself after checkout.

---

## 3. What the sources require / recommend

### 3.1 Wasfaty (Saudi MOH / NUPCO)

From the official user guides:

- Dispensing requires **patient National ID / Iqama + e-prescription number**.
- A prescription is **valid for 30 days** for regular medicines.
- If treatment exceeds 30 days, a **refill** is needed: **up to 2 refills, maximum 90 days** total.
- Prescriptions support **partial dispensing** and have explicit states:
  *approved, partially dispensed, fully dispensed, expired, cancelled, blocked*.
- The pharmacist may add **his own instructions to the printed label**.
- Joining Wasfaty requires NUPCO registration, a valid pharmacy licence and SCFHS-licensed pharmacists.

### 3.2 SFDA — narcotics and psychotropic substances

- After dispensing, the prescription must be **kept in the pharmacy**, with the
  **dispensing date** and the **register number**, and **stamped** by the pharmacy.
- The pharmacist/custodian must record all controlled stock and dispensing in a
  **dedicated register**.
- Dispensing of restricted drugs is reported through the **CDS (Controlled Drug System)**.
- Controlled products must be stored/secured and handled only by an authorised pharmacist.

### 3.3 SFDA — labelling

- Labels must include drug name (**Arabic + English**), dose, frequency, route, total
  quantity, **remaining refills**, dispensing date, warnings and storage conditions.
- Arabic is mandatory for public-facing labelling; other languages are additional.

### 3.4 Commercial pharmacy systems (feature benchmark)

PrimeRx, BestRx, Liberty and FSI all provide a common core:

- refill management and refill-due dashboards;
- **DUR** — drug–drug interaction, drug–allergy, duplicate therapy, dose checks;
- patient medication profile and medication history;
- prescriber directory;
- partial fills and prescription transfer;
- label printing with directions and refill counts;
- adherence/refill reminders and exception queues.

---

## 4. Gap analysis

| Capability | Current | Needed |
|---|---|---|
| Prescription as a standalone record | ❌ (only on invoice) | ✅ registry with status + history |
| Validity (30 days) | ❌ | ✅ warn / block + override reason |
| Refills (up to 2, max 90 days) | ❌ | ✅ counters + next-refill date |
| Partial dispensing | ❌ | ✅ remaining quantity per line |
| Dose/sig instructions | ❌ | ✅ dose, frequency, route, duration |
| Bilingual label | ❌ | ✅ Arabic + English print |
| Prescriber directory | ❌ (free text) | ✅ licence, clinic, autofill |
| Patient allergy / active meds | ❌ | ✅ profile + checks |
| Drug interaction (DUR) | ❌ | ✅ local rule table + overrides |
| Controlled register | ❌ | ✅ register + CSV export |
| Returns tied to dispense | ❌ (invoice only) | ✅ reverse dispense event |
| Reports | partial | ✅ Rx log, refill due, controlled reconciliation |
| Wasfaty/Nphies live API | ❌ | ⏳ import first, integration later |

---

## 5. Feature catalogue

Priority: **P0** = core, **P1** = high value, **P2** = later.

### P0 — Prescription registry
- One record per prescription, linked to many invoices.
- Statuses: `active`, `partially_dispensed`, `dispensed`, `expired`, `cancelled`, `blocked`.
- Search by Rx no, patient ID, phone, Wasfaty reference.
- Each checkout consumes or creates a prescription.

### P0 — Validity & refills
- Configurable validity (default 30 days).
- `refillsAuthorized`, `refillsUsed`, `daysSupply`, `quantityPrescribed`, `quantityDispensed`.
- Max 90-day total (Wasfaty) as a soft check.
- Early-refill warning (e.g. before 75 % of the supply is used).
- Expired/blocked prescription → block checkout, allow override with reason + audit.

### P0 — Partial dispensing
- Dispense less than prescribed; remaining quantity stays open.
- Auto-close when quantity is complete or refills are exhausted.

### P1 — Dose instructions and label
- Structured sig: dose, frequency, route, duration, food relation.
- Bilingual label: patient, drug AR/EN, strength, directions AR+EN, quantity,
  **refills left**, dispense date, batch/expiry, pharmacy contact.

### P1 — Controlled-drug register
- Per-branch register: date/time, Rx no, prescriber, patient ID, item, qty in/out,
  running balance, pharmacist, witness.
- Entries for dispense, return, damage and expiry write-off.
- Monthly reconciliation + CSV export (CDS-ready format).

### P1 — Prescriber directory
- Name, licence number, clinic, phone; autofill and duplicate detection.
- Flag missing/expired licence; per-prescriber history.

### P1 — Patient medication profile and allergies
- Active prescriptions, last dispense date, allergies per customer.
- Shown when the cashier selects the customer.

### P2 — Clinical checks (DUR)
- Drug–drug interaction, drug–allergy, duplicate therapy, dose range.
- Severity: hard stop (severe) vs soft warning (moderate).
- Override requires a reason; overrides are logged.
- Offline: local rule table for common pairs; optional import later.

### P2 — Returns tied to prescriptions
- Returning a dispensed item reverses the dispense event (quantity back,
  refill count restored).
- Controlled returns require reason + register entry.

### P2 — Reports and reminders
- Daily prescription log (private vs Wasfaty).
- Refill due / overdue list, prescriptions expiring soon.
- DUR override log, top prescribers, partial-fill backlog.
- Refill reminders (local list; SMS later).

### P2 — e-prescription import
- Paste/import FHIR `MedicationRequest` JSON, or enter a Wasfaty number.
- Shape the local model like FHIR so a future Nphies/Wasfaty integration is cheap.
- No live Wasfaty/Nphies API now (requires NUPCO accreditation and credentials).

---

## 6. Proposed data model

```ts
// src/types/prescriptions.ts

export type PrescriptionSource = 'private' | 'wasfaty';

export type PrescriptionStatus =
  | 'active'
  | 'partially_dispensed'
  | 'dispensed'
  | 'expired'
  | 'cancelled'
  | 'blocked';

export interface PrescriptionLine {
  id: string;
  itemId: string;
  itemNameEn: string;
  itemNameAr: string;
  dose: string;                 // "500 mg"
  frequency: string;            // "TID" / "3 times daily"
  route: string;                // "oral"
  durationDays: number;
  quantityPrescribed: number;
  quantityDispensed: number;
  refillsAuthorized: number;
  refillsUsed: number;
  substitutionAllowed: boolean; // false = dispense as written
  instructionsAr?: string;
  instructionsEn?: string;
}

export interface DispenseEvent {
  id: string;
  invoiceId: string;
  invoiceNo: string;
  dispensedAt: string;          // ISO datetime
  dispensedBy: string;          // cashier username
  lines: {
    prescriptionLineId: string;
    qty: number;
  }[];
}

export interface Prescription {
  id: string;
  prescriptionNo: string;
  source: PrescriptionSource;
  wasfatyReferenceNo?: string;
  patientNationalId: string;
  patientName?: string;
  prescriberId?: string;
  prescriberName: string;
  issuedDate: string;           // ISO date
  expiryDate: string;           // issuedDate + 30 days (configurable)
  status: PrescriptionStatus;
  lines: PrescriptionLine[];
  dispenseEvents: DispenseEvent[];
  notes?: string;
  createdAt: string;
  createdBy: string;
}
```

Supporting types:

```ts
// src/types/prescriptions.ts (continued)

export interface Prescriber {
  id: string;
  name: string;
  licenseNo?: string;
  clinic?: string;
  phone?: string;
  active: boolean;
}

export interface PatientAllergy {
  customerId: string;
  substance: string;    // "penicillin"
  severity: 'mild' | 'moderate' | 'severe';
  notedAt: string;
}

export interface DrugInteractionRule {
  id: string;
  drugA: string;        // item id or active ingredient
  drugB: string;
  severity: 'major' | 'moderate' | 'minor';
  descriptionEn: string;
  descriptionAr?: string;
}
```

---

## 7. File plan

| New / changed file | Purpose |
|---|---|
| `src/types/prescriptions.ts` | types above |
| `src/store/prescriptionStore.ts` | persisted registry (zustand + persist, same pattern as `salesStore`) |
| `src/store/customerStore.ts` | add allergies + active-med selector (small extension) |
| `src/utils/prescriptionRules.ts` | validity, refill, 90-day, early-refill, partial-fill maths |
| `src/utils/drugInteractions.ts` | local DUR rule table + matcher |
| `src/components/Prescriptions/PrescriptionsPage.tsx` | search, list, detail |
| `src/components/Prescriptions/PrescriptionDispenseDialog.tsx` | partial fill + refill + label |
| `src/components/Prescriptions/PrescriptionLabel.tsx` | bilingual printable label |
| `src/components/Prescriptions/ControlledRegisterPage.tsx` | register + reconciliation + CSV |
| `src/components/POS/PrescriptionCaptureDialog.tsx` | create or select an existing Rx |
| `src/components/POS/POSPage.tsx` | link invoice → Rx, consume quantity, DUR gate |
| `src/types/sales.ts` | add `prescriptionId` / `dispenseEventId` to `SaleHeader` |
| `src/App.tsx` | routes `/prescriptions`, `/controlled-register` |

---

## 8. Proposed POS flow

```
Scan item
  └─ controlled / prescription item?
       └─ Yes → Prescription dialog
                 ├─ Search existing Rx (no. / patient ID / Wasfaty ref)
                 │    └─ found & valid → select which lines are being dispensed
                 └─ New Rx → capture header + per-item dose/qty/refills
                             ↓
                       validity + refill + DUR checks
                             ↓
                       quantity ≤ remaining?  (partial allowed)
                             ↓
                       Payment → invoice
                             ↓
                       write DispenseEvent, update Rx status/refills
                             ↓
                       Offer label print
```

Rules enforced at the gate:

1. Rx exists and is `active` / `partially_dispensed`.
2. Not expired (30 days) and not blocked/cancelled.
3. Quantity ≤ remaining prescribed quantity.
4. Refills available when the quantity exceeds one fill.
5. DUR warnings acknowledged (reason stored for overrides).

---

## 9. Compliance notes (KSA)

- Keep the **captured prescription data with the invoice** — already done — and add the
  **dispense date + register number** for controlled items.
- Controlled register entries should be immutable in practice: corrections as a new
  reversing entry, not an edit.
- Report controlled dispensing through **CDS** when the pharmacy has credentials; until
  then the register + CSV export is the audit trail.
- Do not claim live Wasfaty verification in the UI — the current dialog already states
  the reference is for the pharmacy's own records. Keep that wording until a real API
  exists.
- Patient identifiers (national ID) are personal data: keep them local, do not log them
  to the console, and mask them in list views.

---

## 10. Phased roadmap

### Phase 1 — Registry, validity, refills, partial fills
**Estimate: 1–2 days**

- `prescriptionStore` + types + rules.
- POS capture dialog can create or reuse an Rx.
- Checkout writes a `DispenseEvent`, updates status/refills/remaining qty.
- Receipt shows Rx number.
- Unit tests for validity, refill and partial-fill maths.

**Acceptance:** a 30-tablet prescription can be dispensed 10 + 20, shows
`partially_dispensed → dispensed`, and refuses a third fill.

### Phase 2 — Dose fields + bilingual label
**Estimate: 1–2 days**

- Dose/frequency/route/duration per line.
- Printable label in Arabic + English with refills left.
- Label preview dialog from the POS and from the prescription detail.

**Acceptance:** label prints all SFDA-required fields and remaining refills.

### Phase 3 — Controlled register
**Estimate: 1–2 days**

- Register entries on dispense/return/write-off.
- Running balance per item/branch.
- Monthly reconciliation screen + CSV export.
- Return flow reverses the register entry.

**Acceptance:** register balance matches stock for schedule A items after a
dispense + return.

### Phase 4 — Patient profile + DUR
**Estimate: 2–4 days**

- Allergy list per customer; active medication list.
- Local interaction rules; soft/hard warnings with override reasons.
- Override audit log.

**Acceptance:** adding a second NSAID to a cart with an NSAID allergy warns, and
override requires a reason.

### Phase 5 — Reports, reminders, import
**Estimate: 2–3 days**

- Daily Rx log, refill-due, expiring prescriptions, top prescribers.
- FHIR `MedicationRequest` paste/import (future Wasfaty/Nphies path).

---

## 11. Testing plan

Unit (vitest):
- validity: 29/30/31 days, expired override;
- refill maths: 1 fill, 2 refills, 90-day cap;
- partial fill: remaining quantity, auto-close;
- controlled register running balance;
- DUR matcher: pair hit/miss, severity, override reason required.

E2E (Playwright):
- capture → partial dispense → label → second dispense → closed;
- expired Rx blocked, override path;
- schedule A item creates a register entry and CSV contains it;
- return reverses the register entry.

---

## 12. Sources

- Wasfaty Pharmacist User Guide v3.2 — 30-day validity, refills, statuses:
  https://wasfaty.sa/wp-content/uploads/2021/01/Pharmacist-User-Guide3.2.pdf
- Wasfaty Physician User Guide — refill up to 2×, max 90 days:
  https://wasfaty.sa/wp-content/uploads/2020/06/physician-user-guide-version-31-en.pdf
- SFDA — Procedures and controls of narcotics and psychotropic substances
  (retain prescription, register, stamp):
  https://www.sfda.gov.sa/sites/default/files/2021-09/Drug12112019e1.pdf
- SFDA — Guidance for Labelling, SPC and PIL (Arabic requirements):
  https://www.sfda.gov.sa/sites/default/files/2023-12/GuidanceLabelingSPCandPILv33.pdf
- CCHI — Pharmaceutical Services Qualification Standards:
  https://www.chi.gov.sa/aboutchi/CCHIprograms/DocLib/Pharmaceutical%20services%20Qualification%20standards-%D9%85%D8%B3%D8%AA%D9%86%D8%AF%20%D8%A7%D9%84%D8%AD%D8%A7%D9%82%D9%8A.pdf
- PrimeRx — refill dashboard, medication conflicts:
  https://www.primerx.io/primerx-pharmacy-management-software
- BestRx — allergy/interaction warnings, refill reminders:
  https://www.bestrx.com/product/bestrx
- FSI — e-prescribing, DUR, labels, transfer:
  https://help.fsi.us.com/features/2022/09/standard-and-advanced-features/

---

## 13. Recommended first step

Start with **Phase 1**. It unlocks everything else and is fully local:

1. `src/types/prescriptions.ts`
2. `src/utils/prescriptionRules.ts` + tests
3. `src/store/prescriptionStore.ts`
4. POS integration (create/select Rx, consume quantity)
5. Prescription list page (`/prescriptions`)

Nothing in Phase 1 requires a backend or changes the ZATCA flow.
