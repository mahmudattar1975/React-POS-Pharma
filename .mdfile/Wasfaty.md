# Wasfaty (وصفتي) / NUPCO — Complete Integration Documentation

**Project:** `F:\SOURCE\React\Pharmacy-App`
**Document:** `Wasfaty.md`
**Prepared:** 2026-11-06
**Status:** Research + design proposal. **No code has been changed.**
**Supersedes:** `wasfaty-integration-proposal.md` (earlier draft)

> “nipco” in the original request = **NUPCO** — the National Unified Procurement Company.
> “وصفتي” = **Wasfaty** — the national e-prescription service NUPCO operates under MOH supervision.

---

## Contents

1. [Executive summary](#1-executive-summary)
2. [Glossary](#2-glossary)
3. [Research: the Wasfaty service](#3-research-the-wasfaty-service)
4. [Current state of this app](#4-current-state-of-this-app)
5. [Integration options and recommendation](#5-integration-options-and-recommendation)
6. [Target design and phases](#6-target-design-and-phases)
7. [Phase 0 — Wasfaty-ready POS](#7-phase-0--wasfaty-ready-pos)
8. [Phase 1 — NUPCO onboarding](#8-phase-1--nupco-onboarding)
9. [Phase 2 — live connector architecture](#9-phase-2--live-connector-architecture)
10. [Phase 3 — claims and reconciliation](#10-phase-3--claims-and-reconciliation)
11. [Phase 4 — optional extensions](#11-phase-4--optional-extensions)
12. [Data model](#12-data-model)
13. [Money, VAT and ZATCA](#13-money-vat-and-zatca)
14. [Directions (DOS) and labeling](#14-directions-dos-and-labeling)
15. [Security, privacy and PDPL](#15-security-privacy-and-pdpl)
16. [UX specification and copy](#16-ux-specification-and-copy)
17. [Testing and acceptance](#17-testing-and-acceptance)
18. [Rollout and operations](#18-rollout-and-operations)
19. [Effort and timeline](#19-effort-and-timeline)
20. [Risks and mitigations](#20-risks-and-mitigations)
21. [Open decisions](#21-open-decisions)
22. [Onboarding checklist](#22-onboarding-checklist)
23. [What not to do](#23-what-not-to-do)
24. [Sources](#24-sources)
25. [Appendix A — provider-neutral payload sketches](#appendix-a--provider-neutral-payload-sketches)
26. [Appendix B — claim export columns](#appendix-b--claim-export-columns)
27. [Appendix C — receipt and label samples](#appendix-c--receipt-and-label-samples)
28. [Appendix D — Arabic/English glossary](#appendix-d--arabicenglish-glossary)
29. [Appendix E — file map](#appendix-e--file-map)

---

## 1. Executive summary

**Recommendation: do not start with the live API. Build a “Wasfaty-ready” workflow now and apply for API access in parallel.**

### Why

1. Wasfaty is API-based in practice — commercial pharmacy systems integrate with it — but **there is no public API documentation, sandbox, or self-service credentials**. Access is granted through NUPCO pharmacy onboarding and a technical agreement. The endpoint contract is only known after approval.
2. The pharmacy still needs a correct Wasfaty workflow **today**: patient ID, prescription number, authorization reference, NUPCO item code, zero patient share, claim amount, and a monthly claim report. Most of this does not depend on the API.
3. A **provider-agnostic adapter** lets the same POS work with direct NUPCO, an approved hub/vendor, or manual capture — without rewriting the till.
4. The app is already closer than it looks: it records a Wasfaty source/reference, prescriber, prescription number/date and patient national ID; prints them on the receipt; and already prints the small directions label that Wasfaty’s pharmacy requirements call for.

### Recommended sequence

```
Phase 0  Wasfaty-ready POS + item mapping + claim export      build now, ~6–9 dev days
Phase 1  NUPCO onboarding / API access / DPA                  parallel, elapsed weeks
Phase 2  Live connector behind an adapter                     ~10–15 dev days after docs
Phase 3  Claims, reconciliation, returns                      ~8–10 dev days
Phase 4  Optional: Wasfaty Library → DOS, delivery            ~5–8 dev days
```

### Hard constraints

- Do **not** automate the Wasfaty web portal with a headless browser.
- Do **not** store NUPCO credentials in the browser or in `localStorage`.
- Do **not** dispense a covered item without a confirmed authorization unless a documented emergency override is approved.
- Do **not** change the agreed 50 mm directions label without the owner’s approval.

---

## 2. Glossary

| Term | Meaning |
|---|---|
| **NUPCO** | National Unified Procurement Company — government-owned, operates Wasfaty |
| **Wasfaty (وصفتي)** | National e-prescription service linking MOH hospitals/PHC centres with community pharmacies |
| **Beneficiary (المستفيد)** | Patient eligible for treatment in a government health facility |
| **Dispensing channel (قناة الصرف)** | A pharmacy or other approved outlet that dispenses Wasfaty items |
| **Participating pharmacy (الصيدلية المشاركة)** | Community pharmacy contracted with NUPCO for Wasfaty |
| **Approved supplier (المورد المعتمد)** | Supplier/agent of an item awarded in NUPCO’s Wasfaty tender |
| **Approved distributor (الموزع المعتمد)** | Distributor authorised by NUPCO to distribute and settle compensation |
| **Wasfaty Library (مكتبة وصفتي)** | NUPCO platform holding the patient information leaflet, item images, usage guide and educational material |
| **Authorization (التفويض)** | NUPCO’s approval to dispense a prescription/line |
| **Dispensing (الصرف)** | Handing the medicine to the beneficiary and recording it |
| **Claim (المطالبة)** | The pharmacy’s request for reimbursement for dispensed items |
| **Credit note (إشعار دائن)** | Supplier’s settlement of the price difference to the pharmacy |
| **Wasfaty price** | The NUPCO-approved price for an item |
| **Pharmacy margin** | The margin NUPCO pays the pharmacy on top of the approved price |
| **DOS / SIG** | Dosage instructions — the patient-facing directions printed on the label |
| **PDPL** | Saudi Personal Data Protection Law |
| **SCFHS** | Saudi Commission for Health Specialties |
| **SFDA / RASD** | Saudi Food & Drug Authority / its pharmacy-sale reporting system — separate from Wasfaty |

---

## 3. Research: the Wasfaty service

### 3.1 What it is

Wasfaty is NUPCO’s electronic prescription service, operating under MOH supervision. Physicians in government hospitals and primary healthcare centres issue prescriptions electronically; the patient receives an SMS and collects the medicine **free of charge** from a participating community pharmacy.

The service performs clinical checks (allergies, drug interactions, duplication) before dispensing and gives the pharmacist access to previous prescriptions and prescriber instructions.

**Verified:** NUPCO, Saudipedia, MOH.

### 3.2 Scale and governance

| Item | Figure |
|---|---|
| Prescriptions processed | 100M+ |
| Primary healthcare centres | 2,200+ |
| Hospitals | 230+ |
| Participating pharmacies | 5,000+ |
| Cities/provinces | 172 |
| Operator | NUPCO |
| Supervisor | Ministry of Health |

Source: NUPCO. Figures are as published and change over time.

### 3.3 Pharmacy eligibility

A pharmacy must meet **all** of the following:

- registered on the NUPCO platform as an **accredited pharmacy**;
- valid pharmacy licence and all official documents valid;
- deal only with **approved Wasfaty suppliers**;
- have a pharmacist with a valid **SCFHS** licence;
- have an internet-connected computer to access the system;
- have a **label printer for medication instructions** and a **barcode scanner**.

**Verified:** NUPCO.

> This is directly relevant: the app already has a 50 mm directions label, which is the kind of output this requirement describes.

### 3.4 Registration and onboarding

1. Register the pharmacy: `https://wasfaty.sa/rp/suppliers_add.php?page=add#1`
2. NUPCO reviews the data and documents.
3. On approval, NUPCO provides the requirements to start the service.
4. NUPCO trains the pharmacy team.
5. The service is activated.

**Support:** 920000932.

### 3.5 Documents typically requested

Based on NUPCO’s process and an approved supplier’s published checklist:

- commercial registration copy;
- Zakat and income certificate;
- VAT registration certificate;
- stamped bank IBAN certificate;
- establishment registration table;
- signed supplier/pharmacy agreement;
- chamber-of-commerce-certified authorisation;
- pharmacy licence;
- pharmacist SCFHS licences;
- ZATCA/Fatoora status (already available in this app).

**Reported:** VitaCare’s Wasfaty registration page. Confirm the exact list with NUPCO for this pharmacy.

### 3.6 The patient journey

```
Government hospital / PHC
  → physician issues e-prescription in Wasfaty
  → system checks interactions/allergies
  → patient receives SMS with prescription details
  → patient chooses a participating pharmacy
  → pharmacist verifies identity and prescription
  → authorization + dispensing
  → patient receives medicine free of charge
  → NUPCO/supplier reimburses the pharmacy
```

### 3.7 The pharmacy dispensing workflow

This is the flow described by integrated pharmacy systems and consistent with the NUPCO process:

```
1. Patient arrives with national ID / Iqama and prescription number (or SMS)
2. Pharmacist searches the prescription
3. System displays lines, dose, duration and prescriber instructions
4. Pharmacist checks local stock and batch/expiry
5. Pharmacist selects the lines to dispense (substitution only if allowed)
6. System submits an authorization request
7. System pulls the authorization response (polling)
8. Approved lines are dispensed
9. Receipt and directions label are printed
10. Stock is deducted
11. Dispensing is recorded for the claim report
12. NUPCO/supplier report is reconciled monthly
```

**Reported:** Juleb’s technical guide explicitly lists authorization requests, “Pulling Authorization Response”, stock checks, dispensing, receipt generation, inventory movements and reporting. Phenix describes a hosted module that links the Wasfaty account and monitoring fields to its system.

### 3.8 Commercial model

| Element | Detail | Confidence |
|---|---|---|
| Patient price | 0.00 — free to eligible beneficiaries | Verified |
| Pharmacy reimbursement | NUPCO pays the agreed Wasfaty price + pharmacy margin | Verified (contract/requirements) |
| Payment timing | **30 days** in the 2025 requirements; **45 days** in the 2023 contract template | To confirm current terms |
| Price difference | Supplier compensates the pharmacy by **credit note** within 30 days of the approved dispensing report | Verified (requirements) |
| Reports | NUPCO provides dispensing reports per pharmacy; supplier shares current stock monthly | Verified (requirements) |
| Supplier↔pharmacy settlement | Monthly, per pharmacy, based on NUPCO’s approved dispensing report | Verified |

### 3.9 Compliance obligations that touch software

| Obligation | What it means for the POS | Confidence |
|---|---|---|
| Produce prescription number and patient ID from the POS when NUPCO requests | The sale must store both and be able to report them | Reported (pharmacy agreement Form15 excerpt) |
| Print medication instructions label | A directions label printer must be available; the app already has one | Verified |
| Record dispensing accurately | One record per dispensed prescription/line, with batch and pharmacist | Verified (workflow) |
| Deal only with approved suppliers | Supplier master should flag Wasfaty-approved suppliers | Verified |
| Keep patient guidance available | NUPCO may request patient guidance/usage information; the Wasfaty Library holds it | Verified (supplier requirements) |
| Pharmacy licence and pharmacist licence valid | User/role data should record licence validity | Verified |
| Monthly reconciliation | Claim report must match NUPCO’s report | Verified (workflow) |
| Record retention | Confirm the applicable MOH/NUPCO period (commonly 10 years for health records) | To confirm |

### 3.10 Integration access reality

**What exists:**

- Public patient lookup portal: `https://wasfaty.sa` (ID + prescription number).
- Pharmacy community portal: `http://cp.wasfaty.sa` — login required.
- NUPCO supplier/pharmacy onboarding.
- Commercial integration modules from Juleb, Phenix, Aumet and others.

**What does not exist publicly:**

- API documentation.
- A sandbox with test patients/prescriptions.
- Self-service credentials.
- Published endpoint/auth/payload contracts.

**Conclusion:** treat API access as **partner-only** until NUPCO confirms otherwise in writing. The integration route is itself a decision NUPCO must make for this pharmacy.

### 3.11 Vendor landscape (what others claim)

| Vendor | Claim |
|---|---|
| Juleb | API integration for authorization, status polling, stock checks, dispensing, receipt, inventory, reporting |
| Phenix | Hosted integration module linking the Wasfaty account and monitoring fields to the Phenix system |
| Aumet | Integration between its pharmacy management system and Wasfaty |

These are marketing descriptions, not specifications. They confirm feasibility and the general workflow, not the contract.

---

## 4. Current state of this app

### 4.1 What already exists

| Capability | File | Relevance |
|---|---|---|
| Wasfaty vs private prescription source | `src/types/sales.ts` → `PrescriptionInfo` | Already models the channel |
| Wasfaty reference, prescriber, Rx number/date, patient national ID | `src/components/POS/PrescriptionCaptureDialog.tsx` | The fields NUPCO may ask the POS to produce |
| Prescription captured before checkout for controlled/prescription items | `src/components/POS/POSPage.tsx` | Existing gate; Wasfaty needs a first-class channel, not only this gate |
| Prescription stored on the sale | `src/store/salesStore.ts` | Persisted locally |
| Prescription mirrored to SQL Server | `server/src/routes/sales.ts`, `server/prisma/schema.prisma` | Inline fields on `Sale` |
| Receipt prints Wasfaty block | `src/components/POS/ReceiptView.tsx` | Patient copy already identifies a Wasfaty dispense |
| Directions label (50 mm) | `src/components/POS/DosagePrintView.tsx` | Satisfies the label-printer requirement |
| DOS library and item links | `src/store/dosageStore.ts`, Item Master | Foundation for NUPCO guidance later |
| Third-party payer pattern | `Payment.insuranceCompany`, `insuranceApprovalCode` | Wasfaty is economically similar |
| Batch/stock deduction | `src/store/catalogStore.ts` | Dispensing already moves stock |
| ZATCA invoices and VAT per line | POS, `server/src/ubl`, `src/utils/zatcaInvoice.ts` | Must decide the zero-patient-share document model |
| SQL Server + Prisma | `server/prisma/schema.prisma` | Where Wasfaty claim facts belong |
| ZATCA secure state | `server/src/store/secureStore.ts` | **Dev-grade plaintext — do not reuse for NUPCO credentials without replacing it** |

### 4.2 The current manual Wasfaty flow

Today, when a cart contains a prescription/controlled item:

```
Cashier clicks Complete Sale
  → PrescriptionCaptureDialog opens
  → choose “Wasfaty (وصفتي)”
  → enter Wasfaty reference number (free text)
  → enter prescriber name / ID
  → enter prescription number and date
  → enter patient national ID (10 digits)
  → continue to payment
  → receipt prints “وصفتي / Wasfaty Prescription”, ref, Rx, prescriber, patient ID
```

**What this is:** local record-keeping. It is explicitly documented in the code as *not* a live Wasfaty integration.

**What is missing:**

- the Wasfaty flow is tied to controlled/prescription items, not a general channel;
- the reference is free text and unvalidated;
- no authorization number, dispense ID, or status;
- no NUPCO item code;
- no patient-share/claim split;
- no Wasfaty tender;
- no claim report;
- no link between the dispensing record and NUPCO’s report.

### 4.3 Readiness assessment

| Area | Readiness | Note |
|---|---|---|
| Patient/prescription capture | 70% | Fields exist; need structure and validation |
| Item identification | 40% | Barcode/GTIN/registrationNo exist; NUPCO code missing |
| Money/claim | 20% | VAT per line exists; patient share/claim split missing |
| Reporting | 20% | Sales reports exist; claim export missing |
| Print | 90% | Receipt + directions label already work |
| Security | 40% | Local-first storage; PDPL hardening needed |
| API connector | 0% | No connector yet |

---

## 5. Integration options and recommendation

### 5.1 The three routes

| Route | How it works | Pros | Cons | Best for |
|---|---|---|---|---|
| **A. Direct NUPCO API** | NUPCO approves the pharmacy/software, issues credentials + docs | Full control; no middleman; best long-term cost; data stays between pharmacy and NUPCO | Approval/security review; unknown timeline; contract may change; maintenance ours | End state |
| **B. Approved hub / POS vendor** | Integrate with a vendor that already has NUPCO approval | Fastest to live; proven workflow | Fees; patient data passes through a third party; dependent on their uptime/API | If direct is refused or too slow |
| **C. Manual / portal-assisted** | Pharmacist dispenses in the portal; POS captures the structured result | Works immediately; zero NUPCO dependency; clean claim data | Double entry; human error; no real-time status | Phase 0 and permanent fallback |

### 5.2 Decision matrix

| Criterion | Direct | Hub | Manual |
|---|---|---|---|
| Time to first live dispense | Slow | Fast | Immediate |
| NUPCO dependency | High | Medium | None |
| Cost | Internal build | Vendor fees | Staff time |
| Data control | Best | Third party | Best |
| Real-time authorization | Yes | Yes | No |
| Claim automation | Best | Good | Partial |
| Risk of change | Medium | Low | None |

### 5.3 Recommendation

1. **Build Phase 0 now** (manual capture, but structured and claim-ready).
2. **Apply for direct API access immediately** and ask NUPCO in writing whether direct integration is allowed for this pharmacy’s own POS.
3. **Keep the hub option open** commercially, but do not sign until NUPCO answers.
4. Implement everything behind a `WasfatyProvider` adapter so the route can change without touching the UI.

---

## 6. Target design and phases

### 6.1 Design principles

1. **The server owns Wasfaty state.** Authorization and dispense are financial/regulatory facts; the browser must not be the source of truth for them.
2. **Never fake success.** If NUPCO is unreachable, show “unavailable” and fall back to a documented manual path.
3. **Idempotent mutations.** A retry must never double-dispense or double-claim.
4. **Patient data is minimized and masked.** National ID is visible only to authorised users.
5. **The tax document is separate from the claim record.** The claim amount and patient share are stored independently.
6. **The pharmacist decides.** Directions and substitutions are never auto-applied.
7. **One adapter, three providers.** Manual, direct, hub.
8. **Audit everything.** Who, what, when, which prescription, which batch, which label.

### 6.2 Phase map

```
Phase 0  Wasfaty-ready POS, item mapping, tender, claim record/export, receipt block
Phase 1  NUPCO onboarding, documents, API request, DPA, sandbox
Phase 2  Server connector, adapter, status machine, audit, POS wiring
Phase 3  Claim import, 3-way reconciliation, returns/cancellations
Phase 4  Wasfaty Library → DOS suggestions; delivery integration
```

---

## 7. Phase 0 — Wasfaty-ready POS

**Goal:** make the pharmacy operationally correct and claim-ready without waiting for NUPCO’s API.

**Estimate:** 6–9 dev days.

### 7.1 POS entry point

Add a **Wasfaty** action next to the scan field:

```
[ Wasfaty ] → Patient ID (10 digits) → Prescription No (optional) → [Load]
```

If the API is not connected, “Load” opens the manual form pre-filled with what was entered.

### 7.2 Manual dispense form

Replace the Wasfaty branch of `PrescriptionCaptureDialog` with a dedicated dialog:

| Field | Required | Notes |
|---|---|---|
| Patient national ID / Iqama | Yes | 10 digits; masked after entry |
| Prescription number | Yes | From the patient’s SMS/printout |
| Wasfaty reference | Optional | Portal/vendor reference |
| Authorization number | Optional in Phase 0 | Required before dispensing in Phase 2 |
| Prescriber name | Yes | |
| Prescriber ID / licence | Optional | |
| Prescription date | Yes | |
| Dispensing pharmacist | Yes | From the logged-in user |
| Notes / reason | When overriding | |

### 7.3 Cart behaviour

- Lines added under a Wasfaty session are tagged `channel: 'wasfaty'`.
- Each line shows a small `Wasfaty` chip and the NUPCO code (or `Unmapped` warning).
- Non-Wasfaty items can be added to the same basket and are paid normally.
- The basket cannot be completed as Wasfaty if a covered line has no NUPCO code — allow “save as draft” instead.
- Removal/replacement of a covered line requires a reason.

### 7.4 Item mapping

Add to `Item`:

```ts
nupcoCode?: string;        // NUPCO item code from the approved item list/certificate
wasfatyPrice?: number;     // NUPCO-approved unit price, if different from basePrice
wasfatyEligible?: boolean; // on the approved Wasfaty list
```

Add **Inventory → Wasfaty mapping**:

- search local items;
- paste/scan the NUPCO code;
- show mapped/unmapped counts;
- warn on duplicates (one NUPCO code → one local item);
- fallback matching by `registrationNo` or barcode, with explicit confirmation;
- mapping history (who/when/old/new);
- export a coverage report.

#### Bulk import (implemented)

The mapping screen has **Import NUPCO list**. It accepts a pasted list or a CSV/TSV/Excel file and
builds a preview before writing anything:

| Column | Required | Meaning |
|---|---|---|
| `nupco_code` | yes | NUPCO's 13-digit code (spaces/dashes are stripped) |
| `barcode` | no | Local barcode / GTIN / alias barcode / item number. Defaults to the code itself |
| `price` | no | NUPCO-approved unit price; blank keeps the normal sale price |
| `eligible` | no | Defaults to yes; an explicit "no" is rejected because a mapped code is covered |

Common header aliases (`NUPCO Item Code`, `GTIN`, `Item No`, `Approved Price`, `On Wasfaty List`, …)
are recognised, and a headerless paste is read as `code, barcode, price, eligible`.

Each row is classified as **ready**, **already mapped**, **not in catalogue** (skipped — the NUPCO
list is national, the pharmacy's catalogue is not) or **error**. Errors (bad code, duplicate code,
duplicate item, ambiguous match, bad price) block the whole batch; nothing is applied until
**Apply** is pressed. The store action `catalogStore.applyWasfatyMappings` re-validates the batch
and writes it in one `set`, so a rejected import cannot leave a half-applied mapping.

#### Audit trail (implemented)

The item row only keeps the current mapping, so every real change is also appended to
`catalogStore.wasfatyMappingLog` and shown under **Mapping history** on the same screen:

| Field | Meaning |
|---|---|
| `at` | ISO timestamp of the change |
| `by` | Signed-in cashier's full name, falling back to the username, then "Unknown user" |
| `itemId`, `itemNameEn`, `itemNo` | The local item that changed |
| `before`, `after` | `nupcoCode`, `wasfatyPrice`, `wasfatyEligible` on either side |
| `source` | `manual` (row Save) or `import` (bulk NUPCO list) |

A save that re-states the same code, price and eligibility is not logged, so a repeated "Saved"
click or a re-sent unchanged list does not bury the meaningful edit. The log is bounded to the
newest 500 entries and persists with the catalogue. It is a local audit aid, not a substitute for
server-side change tracking once the backend owns the mapping.

### 7.5 Structured dispense record

Add a first-class record instead of overloading `wasfatyReferenceNo`:

```ts
export type WasfatyProvider = 'manual' | 'direct' | 'hub';

export type WasfatyDispenseStatus =
  | 'manual_recorded'
  | 'authorization_pending'
  | 'authorized'
  | 'partially_authorized'
  | 'rejected'
  | 'dispensed'
  | 'cancelled'
  | 'claim_pending'
  | 'claimed'
  | 'reconciled';

export interface WasfatyDispenseInfo {
  provider: WasfatyProvider;
  prescriptionNo: string;
  authorizationNo?: string;
  nupcoPrescriptionId?: string;
  dispenseId?: string;
  status: WasfatyDispenseStatus;
  patientNationalId: string; // masked in UI/reports
  pharmacistId?: string;
  submittedAt?: string;
  authorizedAt?: string;
  dispensedAt?: string;
  rejectionReason?: string;
  rawReference?: string;
}
```

Place it on `SaleHeader.wasfaty`. Keep `SaleHeader.prescription` for the SFDA/RASD-style record — they serve different purposes.

### 7.6 Money and tender

```ts
SaleLine {
  nupcoCode?: string;
  nupcoUnitPrice?: number;
  patientShare?: number; // normally 0 for covered lines
  claimAmount?: number;  // what NUPCO/supplier reimburses
}
```

Add `PaymentMethod: 'wasfaty'`.

- Auto-add a 100% coverage tender for covered lines.
- Patient due = non-covered items only.
- Receipt: `Wasfaty / NUPCO coverage — patient share 0.00`.
- ZATCA payment means: map to `other` until agreed otherwise.
- Keep Wasfaty separate from `insurance` in reporting.

> See §13 for the three document models and why this needs an accountant’s decision.

### 7.7 Claim export

Add **Reports → Wasfaty claims**:

- month and branch selectors;
- table with masked patient ID;
- totals by item and status;
- exception lists: unmapped item, missing authorization, price mismatch, zero quantity;
- CSV/XLSX export and print;
- stable internal column set (see Appendix B) until NUPCO’s report format is available.

Implemented as three outputs over the same saved-sale rows:

| Output | What it contains |
|---|---|
| **CSV** | The stable internal column set, UTF-8 BOM so Excel opens Arabic correctly |
| **Excel** | Three sheets: `Claim lines` (numeric money columns), `By item` (qty/claim totals per NUPCO code), `Exceptions` (reason counts) |
| **Print** | A4-landscape claim pack with invoice, Rx/auth, masked patient ID, NUPCO code, item, batch/expiry, qty, prices, claim, status and exception; the table header repeats on every page |

The on-screen summary chips and exception banner are unchanged; both exports and the print view are
built from `buildWasfatyClaimRows`, so they cannot disagree with each other or with the invoice.

The **Server claim ledger** below the report is the app-side counterpart of the eventual NUPCO
submission: each mirrored dispense creates a claim, **Submit** sends it through the configured
provider, and **Reconcile** records the reported and paid amounts. A paid amount that differs from
the expected amount is shown before saving and stored with its variance reason. In `manual` mode the
actions are disabled with an explanation, because there is no NUPCO connection yet; the ledger
itself is still recorded.

### 7.8 Receipt and label

**Receipt:** add a compact block:

```
وصفتي / Wasfaty
Rx: 1234567890     Auth: A-778899
Patient share: 0.00 SAR
Covered by NUPCO / Wasfaty
```

**Label:** keep the existing 50 mm directions label unchanged:

```
Paracetamol 500mg (20 tabs)
حبة مرتين يومياً بعد الأكل
twice daily after meals
```

If NUPCO requires a dispensing label with patient name / Rx / date, add a **separate optional** label variant. Do not change the agreed DOS label by default.

### 7.9 Permissions and masking

- Cashier: can record a manual dispense, cannot authorise or override.
- Pharmacist: can authorise/dispense, see the full national ID, and print.
- Manager: can correct/cancel with a reason and view the audit trail.
- Lists and exports show `••••••1234`.
- Full ID is revealed only on the dispense screen, with an audit entry.

### 7.10 Phase 0 acceptance criteria

- A Wasfaty sale can be recorded end-to-end without the API.
- Each covered line has a NUPCO code and a claim amount.
- Patient share is 0.00 for covered lines; non-covered lines are paid normally.
- The receipt shows Rx/auth/coverage.
- The label is unchanged.
- The claim export totals reconcile with the day’s Wasfaty sales.
- Unmapped items are blocked with a clear fix path.
- No NUPCO credential is present in the browser.
- All tests, lint, build and the demo mirror pass.

---

## 8. Phase 1 — NUPCO onboarding

**No code. This runs in parallel and is the critical path.**

### 8.1 Confirm eligibility

- NUPCO-accredited pharmacy, active Wasfaty account.
- Valid pharmacy licence and commercial registration.
- Only approved Wasfaty suppliers.
- SCFHS-licensed pharmacist.
- Internet-connected POS, label printer, barcode scanner.

### 8.2 Documents

See §3.5. Prepare digital copies and ensure every document is valid on the activation date.

### 8.3 Questions to put to NUPCO in writing

1. Is there a **partner/API integration programme** for this pharmacy’s own POS, or must integration go through an approved vendor?
2. Can we receive the **API integration guide**: environments, auth, endpoints, payloads, error codes, rate limits, timeouts, idempotency rules?
3. Is there a **sandbox** with test patients, prescriptions and items?
4. What are the **IP allowlist / mTLS / OAuth2** requirements?
5. What **data-processing agreement** and **hosting/residency** requirements apply (KSA region, on-prem, encryption)?
6. What is the exact **dispensing receipt and label** content required?
7. What is the **claim report** format and delivery channel (portal, SFTP, API)?
8. What are the **cancellation, partial dispense, substitution and return** rules?
9. Who is the technical escalation contact and what are the support hours?
10. Are there **certification/UAT** steps before production activation?

### 8.4 Deliverables from Phase 1

- written route decision (direct vs hub);
- signed agreement/DPA;
- sandbox credentials;
- API documentation;
- sample claim report;
- UAT contact and schedule;
- production activation date.

---

## 9. Phase 2 — live connector architecture

**Estimate:** 10–15 dev days after documentation is available.

### 9.1 Shape

```
┌──────────────────────────┐        HTTPS/JSON        ┌──────────────────────────┐
│  React POS (browser)     │ ───────────────────────► │  server/src (Express)     │
│  no NUPCO credentials    │                          │  Wasfaty adapter          │
└──────────────────────────┘                          └────────────┬─────────────┘
                                                                   │ mTLS / OAuth2
                                                                   ▼
                                                      ┌──────────────────────────┐
                                                      │  NUPCO Wasfaty API        │
                                                      │  (or approved hub)        │
                                                      └──────────────────────────┘
```

The browser only calls our server. The server holds credentials, performs retries, rate limiting, idempotency and audit.

### 9.2 Adapter interface

```ts
interface WasfatyProvider {
  lookupPrescription(input: {
    patientId: string;
    prescriptionNo?: string;
  }): Promise<WasfatyPrescription>;

  getPrescription(id: string): Promise<WasfatyPrescription>;

  checkAvailability(lines: WasfatyLine[]): Promise<WasfatyAvailability[]>;

  requestAuthorization(
    input: WasfatyAuthorizationRequest
  ): Promise<WasfatyAuthorization>;

  getAuthorization(id: string): Promise<WasfatyAuthorization>;

  dispense(input: WasfatyDispenseRequest): Promise<WasfatyDispenseResult>;

  cancelDispense(id: string, reason: string): Promise<void>;

  listClaims(month: string): Promise<WasfatyClaim[]>;
}
```

Implementations:

- `ManualProvider` — Phase 0; records what the pharmacist entered.
- `DirectProvider` — NUPCO API once documented.
- `HubProvider` — approved vendor API.

Feature flag per branch: `wasfaty.provider = manual | direct | hub`.

### 9.3 Internal endpoints (our server)

```
POST /wasfaty/lookup              { patientId, prescriptionNo? }
GET  /wasfaty/prescriptions/:id
POST /wasfaty/authorizations      { prescriptionId, lines[] }
GET  /wasfaty/authorizations/:id
POST /wasfaty/dispenses           { authorizationId, lines[], batches[], pharmacistId }
POST /wasfaty/dispenses/:id/cancel
GET  /wasfaty/claims?month=YYYY-MM
POST /wasfaty/claims/:id/reconcile
```

These are provider-neutral; the UI does not change when the provider changes.

### 9.4 State machine

```
draft → matched → authorization_pending → authorized
                                         ├→ partially_authorized
                                         └→ rejected

authorized → dispensed → claim_pending → claimed → paid → reconciled
     └→ cancelled

any → error (reason, retryable flag)
```

Rules:

- No `dispensed` without `authorized` (or an approved emergency override).
- `partially_authorized` must record which lines were approved.
- A rejected line cannot be silently replaced; substitution needs its own rule.
- Cancellation after dispensing must trigger a claim reversal.

### 9.5 Reliability and idempotency

- **Idempotency key** per dispense: `hash(pharmacyId | prescriptionNo | dispenseRef)`.
- Store the provider’s response ID against the local dispense.
- **Retry reads** automatically with backoff; **retry mutations** only with the same key.
- **Circuit breaker** after repeated failures; show “Wasfaty unavailable”.
- **Polling** for authorization status if no webhook exists.
- **Audit log**: operation, request ID, status, latency, HTTP code, error code. Never log full patient payloads.
- **Offline:** read-only browsing and manual recording; no covered dispense without authorization unless the owner-approved override is used.

### 9.6 Error taxonomy

| Class | Example | Handling |
|---|---|---|
| Validation | bad ID, unknown Rx | Show field error; do not retry |
| Not found | prescription expired/used | Show status; offer manual reference |
| Authorization rejected | clinical/eligibility | Show reason; no dispense |
| Conflict | already dispensed | Refresh status; no retry |
| Rate limited | 429 | Backoff + queue |
| Timeout | no response | Mark unknown; retry same idempotency key |
| Server error | 5xx | Circuit breaker; manual fallback |
| Auth error | expired token | Refresh; if persistent, alert admin |

### 9.7 Server configuration

Add to `server/src/config.ts`:

```ts
wasfaty: {
  provider: process.env.WASFATY_PROVIDER ?? 'manual',
  baseUrl: process.env.WASFATY_API_BASE_URL ?? '',
  pharmacyId: process.env.WASFATY_PHARMACY_ID ?? '',
  timeoutMs: Number(process.env.WASFATY_TIMEOUT_MS ?? 20000),
}
```

Credentials must **not** go in `.env` in plain text for production. See §15.3.

---

## 10. Phase 3 — claims and reconciliation

**Estimate:** 8–10 dev days after a sample report is available.

### 10.1 Goals

- Match every POS dispense to NUPCO’s report and the supplier’s credit note.
- Detect short payments, missing lines, price differences and duplicate claims.
- Support corrections and returns.

### 10.2 Three-way match

```
POS dispense record  ←→  NUPCO monthly dispensing report  ←→  supplier credit note
```

Match keys (in order): NUPCO dispense ID → prescription number + line → NUPCO code + date + qty.

### 10.3 Reports

- **Variance report:** expected vs reported vs paid, by item and by claim.
- **Missing claim:** dispensed but absent from NUPCO’s report.
- **Orphan claim:** in NUPCO’s report but not in POS.
- **Price variance:** claimed price vs NUPCO approved price.
- **Aging:** unpaid claims by days since dispensing.
- **Return/clawback:** reversed claims.

### 10.4 Returns and cancellations

- Cancel before dispensing: cancel the authorization/dispense if the API allows.
- Return after dispensing: create a return record, reverse stock, and flag the claim for adjustment.
- Never delete the original dispense record.
- Reconcile the credit note against the return.

---

## 11. Phase 4 — optional extensions

### 11.1 Wasfaty Library → DOS suggestions

NUPCO’s Wasfaty Library holds patient guidance and a usage guide per item. If NUPCO exposes it (API or file):

- map `nupcoCode → patient guidance`;
- import it as a **suggestion** with a source label (`Wasfaty Library`);
- let the pharmacist review and link it to a DOS row;
- never auto-apply;
- keep the sale snapshot frozen as today.

### 11.2 Home delivery (Yusr)

Wasfaty offers home delivery through NUPCO’s delivery platform. This is a separate integration (orders, courier, handover) and should be scoped separately.

### 11.3 Stock visibility

If NUPCO requests pharmacy stock visibility, expose an aggregated, opt-in stock report (item code, on-hand, batch/expiry). Do not expose patient data.

---

## 12. Data model

### 12.1 TypeScript changes

```ts
// src/types/catalog.ts
interface Item {
  // existing...
  nupcoCode?: string;
  wasfatyPrice?: number;
  wasfatyEligible?: boolean;
}

// src/types/sales.ts
type PaymentMethod = 'cash' | 'card' | 'insurance' | 'points' | 'wasfaty' | 'other';

interface SaleLine {
  // existing...
  nupcoCode?: string;
  nupcoUnitPrice?: number;
  patientShare?: number;
  claimAmount?: number;
  wasfatyLineId?: string;
}

interface SaleHeader {
  // existing...
  channel?: 'retail' | 'wasfaty';
  wasfaty?: WasfatyDispenseInfo;
}
```

### 12.2 SQL Server / Prisma sketch

The server uses **SQL Server** (`provider = "sqlserver"`), Prisma, and a `migrations` folder. Suggested models:

```prisma
model WasfatyDispense {
  id                String   @id @default(uuid())
  saleId            String?  @unique
  sale              Sale?    @relation(fields: [saleId], references: [id])
  provider          String   // manual | direct | hub
  prescriptionNo    String
  authorizationNo   String?
  nupcoPrescriptionId String?
  nupcoDispenseId   String?
  status            String
  patientNationalId String
  pharmacistId      String?
  submittedAt       DateTime?
  authorizedAt      DateTime?
  dispensedAt       DateTime?
  rejectionReason   String?
  rawReference      String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  lines             WasfatyDispenseLine[]
  @@index([prescriptionNo])
  @@index([status])
  @@map("wasfaty_dispenses")
}

model WasfatyDispenseLine {
  id             String   @id @default(uuid())
  dispenseId     String
  dispense       WasfatyDispense @relation(fields: [dispenseId], references: [id], onDelete: Cascade)
  saleLineId     String?
  nupcoCode      String
  itemId         String
  batchNo        String?
  qty            Int
  nupcoUnitPrice Decimal  @db.Decimal(12, 3)
  patientShare   Decimal  @db.Decimal(12, 3)
  claimAmount    Decimal  @db.Decimal(12, 3)
  status         String   // authorized | partially_authorized | rejected | dispensed | cancelled
  rejectionReason String?
  @@map("wasfaty_dispense_lines")
}

model WasfatyAuthorization {
  id             String   @id @default(uuid())
  dispenseId     String?
  requestRef     String   @unique
  responseRef    String?
  status         String
  requestedAt    DateTime
  respondedAt    DateTime?
  payloadHash    String?
  @@map("wasfaty_authorizations")
}

model WasfatyClaim {
  id             String   @id @default(uuid())
  dispenseId     String
  month          String   // YYYY-MM
  nupcoReportRef String?
  expectedAmount Decimal  @db.Decimal(12, 3)
  reportedAmount Decimal? @db.Decimal(12, 3)
  paidAmount     Decimal? @db.Decimal(12, 3)
  status         String   // pending | reported | paid | variance | reconciled
  varianceReason String?
  @@index([month, status])
  @@map("wasfaty_claims")
}

model WasfatyApiLog {
  id          String   @id @default(uuid())
  operation   String
  requestRef  String?
  status      String
  httpStatus  Int?
  errorCode   String?
  latencyMs   Int?
  createdAt   DateTime @default(now())
  @@index([createdAt])
  @@map("wasfaty_api_log")
}
```

Also add to `Sale`:

```prisma
channel       String? // 'retail' | 'wasfaty'
wasfatyStatus String?
```

### 12.3 Migration and backfill

- Add nullable fields first; no destructive migration.
- Backfill `channel` from existing `prescriptionSource` only where it is `wasfaty`.
- Do not invent NUPCO codes; leave unmapped and surface them in the mapping screen.
- Keep the local Zustand data and SQL mirror compatible; a missing `wasfaty` object must load as “none”.

### 12.4 Data ownership

| Data | Source of truth | Mirror |
|---|---|---|
| Sale/invoice | Browser local first, then SQL | `sales` |
| Wasfaty authorization/dispense | **Server** | Local cache for display |
| Claim/reconciliation | **Server** | Summary in UI |
| Item mapping | Browser local + SQL backup | `items` mapping |
| DOS | Browser local | Not mirrored |

> Phase 2 changes the model: Wasfaty state is server-authoritative, unlike the rest of the app. This is deliberate.

---

## 13. Money, VAT and ZATCA

### 13.1 The economics

- The beneficiary pays **0.00** for covered items.
- NUPCO pays the pharmacy the approved price + margin.
- The supplier settles the price difference by credit note.
- Non-covered items in the same basket are paid normally by the patient.

### 13.2 Three document models

| Option | Patient document | Tax invoice value | Pros | Cons |
|---|---|---|---|---|
| **A. Covered sale** | Simplified invoice showing line values, `Wasfaty` tender 100%, patient due 0.00 | NUPCO-approved value; medicines zero-rated | One document; clear trail; claim = invoices | Shows a value the patient did not pay; buyer/payment-means treatment must be confirmed |
| **B. Zero-value receipt** | Receipt at 0.00, not a tax invoice | None for the covered value | Simple for the patient | May be wrong if NUPCO’s payment is consideration; weaker audit trail |
| **C. Two documents** | Patient receipt at 0.00 | Monthly standard tax invoice to NUPCO | Clean B2B treatment | Heaviest; needs NUPCO VAT details and an agreed process |

### 13.3 Recommendation

1. **Evaluate Option A first** with the accountant.
2. Store `patientShare` and `claimAmount` on every line regardless — this keeps B and C possible.
3. Do not change ZATCA signing/submission for this feature until the model is confirmed.
4. Map the `wasfaty` tender to ZATCA `other` initially; update if the accountant/ZATCA advises differently.
5. Keep VAT **per line** — a Wasfaty basket can mix zero-rated medicines and standard-rated supplements.

### 13.4 Receipt wording (proposal)

```
وصفتي / Wasfaty
Rx: 1234567890   Auth: A-778899
Patient share: 0.00 SAR
Covered by NUPCO — Wasfaty
```

Arabic:

```
وصفتي — مغطى من نوبكو
حصة المريض: 0.00 ريال
```

---

## 14. Directions (DOS) and labeling

### 14.1 What exists

The app prints a 50 mm label after the invoice:

```
Paracetamol 500mg (20 tabs)
حبة مرتين يومياً بعد الأكل
twice daily after meals
```

Rules already implemented:

- item name (English) + compact Arabic/English schedule;
- no store header, invoice number, date, patient, qty, code, price, VAT, QR or footer;
- true-size 50 mm preview;
- Arabic unit forms (`حبة`, `حبتين`, `3 حبات`);
- English omits the dose only when it is 1;
- timing maps (`بعد الأكل` / `after meals`, etc.);
- receipt closes before the label mounts;
- historical reprint from the sale snapshot.

### 14.2 Phase 0

**Do not change the label.** It already satisfies the medication-instructions label requirement. Add only the Wasfaty block to the **receipt**, not the label.

### 14.3 Phase 4

If NUPCO’s patient guidance becomes available:

- import it as a DOS suggestion;
- label it `Wasfaty Library`;
- require pharmacist review;
- keep the sale snapshot frozen;
- never auto-apply.

### 14.4 If NUPCO requires a dispensing label

Create a **separate** label variant (patient name, Rx no, date, pharmacy) and keep the DOS label as-is. Do not merge the two without the owner’s approval.

---

## 15. Security, privacy and PDPL

### 15.1 Data classification

| Data | Class | Handling |
|---|---|---|
| Patient national ID / Iqama | Sensitive personal data | Encrypt at rest; mask in UI/reports; role-restricted |
| Prescription number/date | Health data | Encrypt at rest; audit access |
| Prescriber name/ID | Professional data | Standard protection |
| Dispense/claim amounts | Financial data | Standard protection; financial audit |
| NUPCO credentials/keys | Secret | KMS/secret store; never in code or browser |
| API logs | Mixed | Redact PHI; keep references/hashes |

### 15.2 Controls

| Area | Control |
|---|---|
| Credentials | Server-side only; encrypted secret store; rotation; no browser/localStorage |
| Transport | TLS 1.2+; mTLS if required; certificate expiry monitoring |
| Access | RBAC; pharmacist-only authorise/dispense; manager-only corrections |
| Minimisation | Send only required fields; mask ID; no PHI in analytics |
| Logging | Immutable audit; redact bodies; keep provider request IDs |
| Storage | Encrypt at rest; consider column-level encryption for national ID; encrypted backups |
| Retention | Confirm MOH/NUPCO period (commonly 10 years); archive/purge |
| Residency | Confirm NUPCO requirement; prefer KSA hosting/on-prem |
| Agreements | NUPCO DPA/confidentiality; vendor DPA if hub |
| Incidents | Breach detection and notification procedure; named owner |
| Testing | DPIA before go-live; connector penetration test; no production data in test |

### 15.3 Secrets management — important finding

`server/src/store/secureStore.ts` currently stores ZATCA material in **plaintext JSON on disk** and is explicitly marked **DEV-GRADE ONLY** in its own header. It must **not** be reused as-is for NUPCO credentials.

Before Phase 2:

- replace it with an encrypted store (KMS/HSM, OS keychain, or encrypted file with access control);
- separate ZATCA and Wasfaty secrets;
- add rotation and access logging;
- restrict file permissions to the service account.

### 15.4 Access and audit

- Log: login, lookup, authorization request, dispense, cancel, claim export, ID reveal.
- Include: user, role, timestamp, prescription reference, dispense reference, result.
- Never log the full national ID; log a hash or last four digits.
- Audit records are append-only; corrections are new records with a reason.

### 15.5 Retention

- Confirm the applicable MOH/NUPCO retention period in writing.
- Keep dispensing and claim records for the full period.
- Keep API logs shorter (e.g., 12–24 months) unless required.
- Provide a documented purge/archive process.

### 15.6 Residency

- Ask NUPCO whether data must remain in KSA.
- If yes: on-prem SQL Server in KSA or a KSA cloud region.
- Document any cross-border transfer and the safeguards.

### 15.7 DPIA checklist

- [ ] Purpose and lawful basis documented.
- [ ] Data elements minimized.
- [ ] Access roles defined.
- [ ] Retention defined.
- [ ] Encryption at rest/in transit verified.
- [ ] Processor agreements signed.
- [ ] Breach procedure tested.
- [ ] Patient rights process (access/correction) defined.
- [ ] Vendor/hub risk assessed.

---

## 16. UX specification and copy

### 16.1 Screens

| Screen | Purpose |
|---|---|
| POS — Wasfaty lookup | Enter patient ID / Rx number |
| POS — manual dispense | Record when the API is unavailable |
| POS — cart | Tag covered lines, show NUPCO code and coverage |
| Directions page | Existing post-payment step; unchanged |
| Receipt | Add Wasfaty block |
| Inventory — Wasfaty mapping | Map items to NUPCO codes |
| Reports — Wasfaty claims | Monthly claim export and exceptions |
| Settings — Wasfaty | Provider, environment, pharmacy ID, connection test |
| Audit — Wasfaty | Search dispenses and API calls |

### 16.2 Empty and error states

| State | Copy (EN) | Copy (AR) |
|---|---|---|
| No prescription found | “No prescription found for this ID/number. Check the details or record it manually.” | «لا توجد وصفة بهذا الرقم. تحقق من البيانات أو سجّلها يدوياً.» |
| API unavailable | “Wasfaty is unavailable right now. You can record the dispense manually and reconcile later.” | «خدمة وصفتي غير متاحة حالياً. يمكنك تسجيل الصرف يدوياً والمطابقة لاحقاً.» |
| Pending authorization | “Waiting for Wasfaty authorization…” | «بانتظار تفويض وصفتي…» |
| Rejected | “Wasfaty rejected this line: {reason}.” | «رفضت وصفتي هذا البند: {السبب}.» |
| Unmapped item | “This item has no NUPCO code. Map it in Inventory → Wasfaty mapping.” | «هذا الصنف بدون رمز نوبكو. اربطه من المخزون ← ربط وصفتي.» |
| Partial authorization | “Only some lines were approved. Review before dispensing.” | «تمت الموافقة على بعض البنود فقط. راجعها قبل الصرف.» |
| Already dispensed | “This prescription was already dispensed.” | «تم صرف هذه الوصفة مسبقاً.» |

### 16.3 Buttons

- `Wasfaty` / `وصفتي`
- `Load prescription` / `تحميل الوصفة`
- `Record manually` / `تسجيل يدوي`
- `Request authorization` / `طلب التفويض`
- `Dispense` / `صرف`
- `Cancel` / `إلغاء`
- `Print label` / `طباعة الملصق`
- `Export claims` / `تصدير المطالبات`

---

## 17. Testing and acceptance

### 17.1 Unit tests

- NUPCO code validation and mapping.
- Patient share / claim amount math.
- Tender allocation with mixed baskets.
- Status transitions.
- Idempotency key generation.
- Report column mapping.
- Masking of national ID.

### 17.2 Contract tests

- Record provider fixtures (request/response) once the API is documented.
- Run the adapter against fixtures in CI.
- Assert no PHI in logs.
- Assert retries reuse the same idempotency key.

### 17.3 End-to-end (Playwright)

1. Create a Wasfaty sale manually.
2. Verify cart tagging, coverage tender and patient due.
3. Verify receipt block.
4. Verify directions label unchanged.
5. Verify claim export totals.
6. Verify unmapped item block.
7. Verify masking and permissions.
8. Verify audit entries.

### 17.4 Failure injection

- Timeout during lookup.
- Timeout during authorization.
- Duplicate dispense response.
- Partial authorization.
- Rejected line.
- 429 rate limit.
- Expired token.
- Server 500.
- Network offline.

### 17.5 UAT with the pharmacist

- Real prescription printout and ID.
- Full dispense, cancel and return.
- Label and receipt review.
- Claim export review.
- Exception handling.

### 17.6 Reconciliation test

- Import a sample NUPCO report.
- Match 100% of dispenses.
- Introduce a price variance, a missing line and an orphan line.
- Verify each appears in the correct exception report.

### 17.7 Pilot / shadow mode

- Run the portal and the POS in parallel for 2–4 weeks.
- Compare every dispense daily.
- Fix mapping/price gaps.
- Switch to POS-first only after 100% match for a full week.

---

## 18. Rollout and operations

### 18.1 Pilot

- One branch, one pharmacist, one shift pattern.
- Daily reconciliation.
- Written issue log.
- Go/no-go criteria: 100% match for 5 consecutive days, no unresolved authorization errors, pharmacist sign-off.

### 18.2 Training

- Wasfaty lookup and identity verification.
- Manual fallback.
- Label and receipt.
- Exceptions and cancellations.
- Privacy rules (ID masking, no screenshots).

### 18.3 SOP (standard operating procedure)

1. Verify patient identity.
2. Load the prescription.
3. Check stock and expiry.
4. Request authorization.
5. Dispense only approved lines.
6. Print receipt and label.
7. Record the claim.
8. Reconcile monthly.

### 18.4 Monitoring

- API success rate and latency.
- Authorization pending count.
- Rejected/error count by code.
- Unmapped item count.
- Claim variance.
- Duplicate dispense attempts.
- Credential/certificate expiry.

### 18.5 Support

- Named NUPCO technical contact.
- Internal escalation.
- On-call for go-live week.
- Rollback plan: switch `wasfaty.provider` to `manual`.

### 18.6 Backup and incident response

- Daily database backup; test restore quarterly.
- Encrypted backups.
- Incident runbook: detect, contain, notify, remediate, document.

---

## 19. Effort and timeline

| Phase | Work | Estimate | Dependency |
|---|---|---|---|
| 0 | Wasfaty mode, mapping, tender, claim record/export, receipt | 6–9 dev days | none |
| 1 | Onboarding, documents, API request, DPA | 2–8 weeks elapsed | pharmacy + NUPCO |
| 2 | Connector, adapter, status machine, audit, POS wiring | 10–15 dev days | API docs + sandbox |
| 3 | Claim import, 3-way reconciliation, returns | 8–10 dev days | sample report |
| 4 | Library → DOS, delivery | 5–8 dev days | NUPCO data access |
| — | Hardening, DPIA, UAT, pilot | 5–7 dev days | phases 0–2 |

**Total after credentials:** ~25–35 dev days.
**With Phase 0:** ~35–45 dev days, spread over the onboarding wait.

Assumptions: one senior developer, part-time QA, existing app builds/tests stay green, no major redesign.

---

## 20. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| No public API / approval delayed | Cannot schedule Phase 2 | Phase 0 now; written NUPCO confirmation; hub fallback |
| API contract differs from vendor descriptions | Rework | Adapter + contract tests; no NUPCO shapes in UI |
| Authorization latency at the counter | Queue builds | Prefetch on ID entry; pending state; separate authorize action |
| Network outage | Cannot dispense | Read-only fallback; documented override; reconcile later |
| Item mapping errors | Wrong claim / wrong drug | Mapping screen, registrationNo/barcode fallback, unmapped block, audit |
| Partial dispense / substitution rules | Wrong claim | Per-line status; reason codes; NUPCO rules encoded, not guessed |
| Duplicate dispense | Double claim / audit finding | Idempotency key + status check before dispense |
| VAT/ZATCA treatment wrong | Compliance exposure | Accountant sign-off before the money model is final |
| PHI leakage | PDPL breach | Server-only credentials, RBAC, masking, redacted logs, DPIA |
| Returns / claim clawback | Revenue loss | Reversal flow tied to original authorization/dispense |
| Staff double entry in pilot | Errors | Shadow mode; daily comparison |
| Credentials in dev-grade store | Key compromise | Replace `secureStore` before Phase 2 |
| NUPCO report format changes | Broken reconciliation | Versioned importers; keep raw file |

---

## 21. Open decisions

1. **Route:** direct NUPCO API (recommended target), approved hub (faster), or manual only (Phase 0)?
2. **Accreditation:** is the pharmacy already NUPCO-accredited and active in Wasfaty? Which branch(es) first?
3. **Access:** do you already have a NUPCO integration contact, credentials, or a signed integration agreement?
4. **Sale creation:** should a Wasfaty dispense **automatically create the POS sale** (recommended), or only prefill the cart?
5. **Money model:** Option A (covered sale, 100% Wasfaty tender, patient 0.00), Option B (0.00 receipt), or Option C (monthly invoice to NUPCO)? Accountant must confirm.
6. **Pharmacist role:** should authorization/dispensing be restricted to a licensed-pharmacist login, separate from cashier?
7. **Data:** is the SQL Server on-prem in KSA? Any NUPCO residency requirement you already know?
8. **Claim report:** can you share a sample NUPCO/supplier monthly report so the export matches it exactly?
9. **DOS:** do you want Wasfaty’s patient guidance to feed suggested directions later (Phase 4)?
10. **Pilot:** one branch first, then rollout — or all branches at once?
11. **Returns:** should a Wasfaty return be allowed at the POS, or handled only in the portal initially?
12. **Loyalty:** should covered items earn loyalty points? (Recommend no, since the patient pays 0.00.)

---

## 22. Onboarding checklist

### 22.1 Pharmacy

- [ ] NUPCO accreditation confirmed.
- [ ] Wasfaty account active.
- [ ] Pharmacy licence valid.
- [ ] Commercial registration valid.
- [ ] Zakat certificate valid.
- [ ] VAT certificate valid.
- [ ] IBAN certificate stamped.
- [ ] Establishment registration table completed.
- [ ] Supplier/pharmacy agreement signed.
- [ ] Chamber-certified authorisation.
- [ ] Pharmacist SCFHS licences valid.
- [ ] Approved suppliers only.
- [ ] Internet-connected POS.
- [ ] Label printer available.
- [ ] Barcode scanner available.
- [ ] ZATCA/Fatoora status valid.

### 22.2 Technical

- [ ] Written confirmation of direct vs hub.
- [ ] API documentation received.
- [ ] Sandbox credentials received.
- [ ] Test patients/prescriptions/items available.
- [ ] Auth model confirmed (OAuth2/mTLS/API key).
- [ ] IP allowlist confirmed.
- [ ] Rate limits/timeouts confirmed.
- [ ] Error code list received.
- [ ] Claim report sample received.
- [ ] DPA signed.
- [ ] Residency requirement confirmed.
- [ ] Receipt/label requirements confirmed.
- [ ] UAT schedule agreed.
- [ ] Production activation date agreed.

### 22.3 Internal

- [ ] Branch and pharmacist users confirmed.
- [ ] NUPCO item list received.
- [ ] Item mapping owner assigned.
- [ ] Accountant decision on VAT/document model.
- [ ] Secrets store upgraded.
- [ ] DPIA completed.
- [ ] Backup/restore tested.
- [ ] Pilot plan approved.

---

## 23. What not to do

1. **Do not automate the Wasfaty portal** with a headless browser, RPA bot, or stored pharmacist session. It is fragile, likely against the terms of use, and a credential risk.
2. **Do not put NUPCO credentials in the frontend** or in `localStorage`.
3. **Do not dispense without authorization** unless a documented, owner-approved emergency override is used and reconciled.
4. **Do not silently retry a dispense**; always reuse the idempotency key.
5. **Do not merge Wasfaty authorization data with SFDA/RASD data.** They are different reporting regimes.
6. **Do not change the 50 mm directions label** without approval.
7. **Do not auto-apply a Wasfaty-sourced direction**; the pharmacist chooses.
8. **Do not delete** a dispense record to “fix” a mistake; cancel/void with a reason.
9. **Do not assume** the 30/45-day payment terms; confirm the current contract.
10. **Do not reuse** the current plaintext `secureStore` for NUPCO secrets.

---

## 24. Sources

### Official / government

- NUPCO — Wasfaty: An Open Opportunity for All Pharmacy Owners
  `https://www.nupco.com/en/wasfaty-an-open-opportunity-for-all-pharmacy-owners`
- NUPCO — home / Wasfaty overview
  `https://www.nupco.com/en`
- NUPCO — Wasfaty supplier requirements (Arabic PDF, 2025)
  `https://www.nupco.com/wp-content/uploads/2025/01/اشتراطات-وصفتي.pdf`
- NUPCO — Wasfaty service contract template (Arabic PDF, 2023)
  `https://www.nupco.com/wp-content/uploads/2023/03/عقد-خدمة-وصفتي.pdf`
- Saudipedia — Wasfaty Service
  `https://saudipedia.com/en/wasfaty-service`
- Wasfaty public portal
  `https://wasfaty.sa`
- Wasfaty community portal (login)
  `http://cp.wasfaty.sa`

### Vendor / industry

- Juleb — Wasfaty Integrated Pharmacy Software: Technical Guide
  `https://juleb.com/blog/Wasfaty-Integrated-Pharmacy-Software/en`
- Juleb — Wasfaty–Juleb integration
  `https://juleb.com/blog/wasfaty-juleb-integration-pharmacy-management/en`
- Phenix Systems — Wasfaty integration module
  `https://phenixsoft.com/en/integration/wasfaty`
- Aumet — Wasfaty integration
  `https://aumet.com`
- VitaCare — Wasfaty registration documents
  `https://vitacareonline.com/en/vc-wasfaty`

### Academic / context

- “Evaluating the Wasfaty E-Prescribing Platform…”
  `https://pmc.ncbi.nlm.nih.gov/articles/PMC12027183`
- “Exploring challenges and enablers for community pharmacists using electronic prescriptions (Wasfaty)…”
  `https://www.frontiersin.org/journals/medicine/articles/10.3389/fmed.2024.1487852/full`

> Links were valid at research time. NUPCO’s site structure changes; if a PDF link fails, search the NUPCO site for the current document.

---

## Appendix A — provider-neutral payload sketches

These are **our server’s** shapes, not NUPCO’s. They isolate the UI from the provider contract.

### Lookup

```json
POST /wasfaty/lookup
{
  "patientId": "1234567890",
  "prescriptionNo": "RX-2026-000123"
}
```

```json
{
  "prescriptionId": "nupco-rx-8891",
  "prescriptionNo": "RX-2026-000123",
  "patientIdLast4": "7890",
  "prescriber": { "name": "Dr. A. Alqahtani", "id": "SCFHS-12345" },
  "issuedAt": "2026-11-05",
  "status": "active",
  "lines": [
    {
      "lineId": "l1",
      "nupcoCode": "5120159900300",
      "nameEn": "Paracetamol 500mg Tablet",
      "nameAr": "باراسيتامول 500 ملغ",
      "qty": 20,
      "unit": "TAB",
      "dose": "1 tablet twice daily after food",
      "substitutionAllowed": true
    }
  ]
}
```

### Authorization

```json
POST /wasfaty/authorizations
{
  "prescriptionId": "nupco-rx-8891",
  "lines": [
    { "lineId": "l1", "nupcoCode": "5120159900300", "qty": 20 }
  ]
}
```

```json
{
  "authorizationId": "auth-5521",
  "status": "authorized",
  "lines": [
    { "lineId": "l1", "status": "authorized", "approvedQty": 20, "unitPrice": 4.5 }
  ]
}
```

### Dispense

```json
POST /wasfaty/dispenses
{
  "authorizationId": "auth-5521",
  "pharmacistId": "user-12",
  "lines": [
    {
      "lineId": "l1",
      "nupcoCode": "5120159900300",
      "batchNo": "PC23F02",
      "expiryDate": "2027-03-31",
      "qty": 20
    }
  ]
}
```

```json
{
  "dispenseId": "disp-7712",
  "status": "dispensed",
  "dispensedAt": "2026-11-06T10:15:00Z"
}
```

### Error

```json
{
  "error": {
    "code": "ALREADY_DISPENSED",
    "message": "Prescription was already dispensed.",
    "retryable": false
  }
}
```

---

## Appendix B — claim export columns

Stable internal format until NUPCO’s report is known:

| Column | Example |
|---|---|
| Invoice No | SIM-000123 |
| Invoice Date | 2026-11-06 10:15 |
| Branch | Riyadh – Olaya |
| Channel | Wasfaty |
| Prescription No | RX-2026-000123 |
| Authorization No | A-778899 |
| NUPCO Dispense ID | disp-7712 |
| Patient ID (masked) | ••••••7890 |
| NUPCO Code | 5120159900300 |
| Item Name EN | Paracetamol 500mg Tablet |
| Item Name AR | باراسيتامول 500 ملغ |
| Batch | PC23F02 |
| Expiry | 2027-03-31 |
| Qty | 20 |
| Unit | TAB |
| NUPCO Unit Price | 4.50 |
| Line Total | 90.00 |
| Patient Share | 0.00 |
| Claim Amount | 90.00 |
| Pharmacist | user-12 |
| Status | dispensed |
| Exception | (blank / unmapped / missing auth / price variance) |

---

## Appendix C — receipt and label samples

### Receipt (Wasfaty sale)

```
────────────────────────────────
        PHARMACY NAME
        Riyadh – Olaya
────────────────────────────────
Simplified Tax Invoice
SIM-000123        2026-11-06 10:15
────────────────────────────────
Paracetamol 500mg (20 tabs)
20 TAB × 4.50            90.00
VAT 0%                    0.00
────────────────────────────────
Total                    90.00
Wasfaty / NUPCO coverage -90.00
Patient due               0.00
────────────────────────────────
وصفتي / Wasfaty
Rx: RX-2026-000123
Auth: A-778899
Patient share: 0.00 SAR
Covered by NUPCO
────────────────────────────────
إرشادات الاستخدام في ملصق منفصل
Directions are on a separate label
────────────────────────────────
```

### Directions label (unchanged)

```
Paracetamol 500mg (20 tabs)
حبة مرتين يومياً بعد الأكل
twice daily after meals
```

### Optional NUPCO dispensing label (only if required)

```
Patient: ••••••7890
Rx: RX-2026-000123
Dispensed: 2026-11-06
Pharmacy: Riyadh – Olaya
```

---

## Appendix D — Arabic/English glossary

| English | Arabic |
|---|---|
| Wasfaty | وصفتي |
| NUPCO | نوبكو |
| Prescription | وصفة طبية |
| e-prescription | وصفة إلكترونية |
| Beneficiary | المستفيد |
| Dispensing | صرف |
| Dispensing channel | قناة الصرف |
| Participating pharmacy | صيدلية مشاركة |
| Authorization | تفويض |
| Claim | مطالبة |
| Reimbursement | تعويض |
| Credit note | إشعار دائن |
| Approved supplier | مورد معتمد |
| Patient share | حصة المريض |
| Covered by NUPCO | مغطى من نوبكو |
| National ID / Iqama | الهوية الوطنية / الإقامة |
| Directions | إرشادات الاستخدام |
| Label | ملصق |
| Batch | تشغيلة |
| Expiry | تاريخ الصلاحية |
| Pharmacist | صيدلي |
| Prescriber | الطبيب الواصف |

---

## Appendix E — file map

### Existing files likely to change in Phase 0

```
src/types/catalog.ts                 Item.nupcoCode / wasfatyPrice / wasfatyEligible
src/types/sales.ts                   PaymentMethod 'wasfaty', SaleHeader.wasfaty, SaleLine claim fields
src/types/wasfaty.ts                 NEW — WasfatyDispenseInfo, statuses, provider types
src/components/POS/POSPage.tsx       Wasfaty entry point and cart tagging
src/components/POS/PrescriptionCaptureDialog.tsx  Wasfaty branch or replacement
src/components/POS/PaymentDialog.tsx Wasfaty tender
src/components/POS/ReceiptView.tsx   Wasfaty receipt block
src/components/Inventory/ItemMasterFormDialog.tsx  NUPCO code fields
src/components/Inventory/ItemMasterPage.tsx         mapping chip / search
src/components/Reports/...           NEW — Wasfaty claims page
src/store/salesStore.ts              persist Wasfaty metadata
src/api/salesApi.ts                  mirror new fields
src/utils/zatcaInvoice.ts            map 'wasfaty' tender to 'other'
```

### Server files likely to change in Phase 2

```
server/src/config.ts                 wasfaty config block
server/src/routes/wasfaty.ts         NEW — internal endpoints
server/src/wasfaty/provider.ts       NEW — adapter interface + factory
server/src/wasfaty/manual.ts         NEW — Phase 0 provider
server/src/wasfaty/direct.ts         NEW — NUPCO provider
server/src/wasfaty/hub.ts            NEW — hub provider
server/src/wasfaty/client.ts         NEW — HTTP, auth, retries, idempotency
server/src/wasfaty/audit.ts          NEW — API audit
server/src/store/secrets.ts          NEW/UPGRADED — encrypted secret store
server/prisma/schema.prisma          Wasfaty tables + Sale fields
server/prisma/migrations/...         NEW migration
```

### Tests

```
src/utils/wasfaty.test.ts
src/store/wasfaty.test.ts
src/components/POS/wasfaty.e2e.test.ts
server/src/wasfaty/*.test.ts
```

### Documentation

```
Wasfaty.md                           this document
dos-direction.md                     existing DOS implementation record
server/README.md                     add the Wasfaty connector section when built
```

---

## 25. Build status — Phase 0 shipped

**Status date: 2026-11-06.** The complete app-side Wasfaty build is in place and verified. The only
remaining blocker is external: NUPCO's live contract and credentials.

### 25.1 What shipped

| Area | Implementation |
|---|---|
| Item mapping | `nupcoCode` (13 digits, unique), `wasfatyPrice`, `wasfatyEligible` on the item master; immediate duplicate check in the form and again in `catalogStore.setWasfatyMapping` |
| Mapping workspace | Inventory → **Wasfaty / NUPCO Mapping**: coverage counts, search, inline edit, “needs code” view, bulk NUPCO list import (paste/CSV/TSV/Excel, all-or-nothing) and a bounded who/when/before/after audit trail |
| POS session | Start from the header capture dialog (prescription, patient ID, prescriber, optional portal authorization); existing basket lines are re-flagged, not re-scanned |
| Coverage pricing | Covered lines repriced to the NUPCO-approved value with offers/tier/manual discounts suppressed; batch ERP overrides ignored |
| Checkout guard | An eligible item with no code blocks checkout and offers **Map items**; it is never silently charged to the patient |
| Payment | Patient pays only the non-covered remainder; a `wasfaty` tender for the covered total is added automatically; fully covered sales show **Dispense & complete** with no tender rows |
| Receipt | Wasfaty Rx/authorization line and a bilingual `Wasfaty / وصفتي` tender label |
| Claim report | Reports → **Wasfaty / NUPCO claims**: one stable row per covered sale line, month/branch filters, exceptions, CSV/Excel export, A4-landscape print pack, server claim ledger with submit/reconcile actions |
| Settings | Provider, capabilities, contract completeness, catalogue coverage, and the exact remaining NUPCO checklist |
| Server API | `/api/wasfaty`: health, OpenAPI, lookup, authorization, dispense (idempotent), cancel, claims, submit, reconcile |
| Providers | `manual`, `mock`, `direct`, `hub` behind one interface |
| Retry safety | A failed dispense mirror is queued as `wasfatyDispense` and retried; the same `saleId` returns the same server record |

### 25.2 Provider matrix

| Provider | Lookup | Authorization | Dispense | Claim submit | Needs NUPCO contract |
|---|---|---|---|---|---|
| `manual` | — | — | records | — | no |
| `mock` | yes | yes | yes | yes | no |
| `direct` | yes | yes | yes | yes | yes, all six operations |
| `hub` | yes | yes | yes | yes | yes, all six operations |

`direct`/`hub` fail closed: `GET /api/wasfaty/health` reports `configured: false` and the missing
operation names, and every operational call returns `503 provider_unavailable`. The POS keeps
working in manual mode. This is deliberate — a guessed NUPCO path is worse than an honest refusal.

### 25.3 Storage decision

Dispenses and claims live in `server/data/wasfaty.json` behind a serialised writer (temp file +
rename), not in Prisma. Reasons:

* the sale/tax document already has a mirror; this is the **claim** ledger and needs idempotency by
  `saleId` more than relational joins;
* it keeps the XP H/Prisma schema untouched until NUPCO's real claim fields are known — adding
  columns now would encode guesses into a migration;
* only patient-ID **last four** digits are stored.

Production upgrade path: replace `server/src/wasfaty/store.ts` with a SQL-backed repository using
the same functions (`mutateState`, `findDispenseBySale`, `nextClaimId`, …). Nothing above it changes.

### 25.4 Exact remaining NUPCO items

The checklist is maintained in **`Wasfaty-API.md` §6** and mirrored in Settings. Summary:

1. onboarding, participation approval and credentials;
2. environment base URLs + network allow-list;
3. auth scheme, token lifetime/rotation;
4. lookup operation and payload/errors;
5. authorization operations and partial/rejected semantics;
6. dispense submit/cancel, NUPCO ids and idempotency;
7. claim submission window/cut-off, month close, paid/variance/credit-note fields;
8. authoritative 13-digit item list + price updates;
9. rate limits, retries, sandbox and support contacts;
10. PDPL/data-processor confirmation and audit retention.

### 25.5 Verification performed

```
npx tsc -b --pretty false                 clean (client)
cd server && npx tsc -b --pretty false    clean (server)
npx vitest run                            295 tests passed (19 files)
npm run lint                              clean (pre-existing warnings only)
npm run build                             passed
npx playwright test                       19 tests passed (8 workers)
```

The Playwright suite includes three Wasfaty scenarios (covered sale at the approved price with a
0.00 patient share, the unmapped-item checkout guard, and mapping an item from the mapping screen)
plus a shared `dismissDirectionsIfShown` helper so the optional post-payment directions step does
not make unrelated receipt specs brittle.

Live API smoke with `WASFATY_PROVIDER=mock`:

| Check | Result |
|---|---|
| health | `provider: mock`, `configured: true` |
| two-line dispense | `WDSP-000001`, status `dispensed`, mock NUPCO id returned |
| claim opened | `WCLM-000001`, `expectedAmount 13.25`, patient ID stored as `7890` |
| replayed same `saleId` | same dispense, still **one** claim row |
| submit claim | `reported`, reported amount 13.25 |
| reconcile with 13.00 paid | `variance`, paid amount 13.00 |
| mismatched claim total | `400 invalid_request` with the arithmetic message |

### 25.6 Honest limitations

* No live NUPCO call has been made or can be made without onboarding. `mock` is a simulator, not a
  conformance test.
* `manual` claims cannot be submitted/reconciled through the API — those endpoints correctly return
  `503`. The claim report and CSV remain fully usable.
* `server/src/wasfaty` stores plaintext JSON and does not encrypt NUPCO credentials. Secrets belong
  in environment variables (`auth.tokenEnv`) until a real secret manager replaces
  `server/src/store/secureStore.ts`.
* Wasfaty prices and codes in the seed data are **demo values**. Replace them with NUPCO's
  authoritative list before any real dispense.
* The ZATCA accepted path is still unexercised for the unrelated reason that no real Fatoora OTP /
  Production CSID is available.

---

**End of document.**
