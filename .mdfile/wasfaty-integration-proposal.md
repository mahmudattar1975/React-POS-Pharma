# Wasfaty (وصفتي) / NUPCO Integration — Research & Proposal

**Project:** `F:\SOURCE\React\Pharmacy-App`
**Prepared:** 2026-11-06
**Status:** Proposal only — no code has been changed.
**Scope:** How to connect the pharmacy POS to NUPCO's Wasfaty e-prescription service, what to build first, what NUPCO must provide, and the decisions needed before implementation.

> “nipco” in the request = **NUPCO** (National Unified Procurement Company).
> “وصفتي” = **Wasfaty**, the national e-prescription service NUPCO operates under MOH supervision.

---

## 1. Executive summary

**Recommendation: do not start with the live API. Start with a “Wasfaty-ready” workflow now, and apply for API access in parallel.**

Why:

1. There is **no public Wasfaty API documentation, sandbox, or self-service credentials**. Access is partner/onboarding-based, and the actual contract (endpoints, auth, payloads) is only released after NUPCO approval. A direct build cannot be scheduled reliably until that arrives.
2. The pharmacy still needs a correct Wasfaty workflow **today**: patient ID, prescription number, authorization reference, NUPCO item code, zero patient share, claim amount, and a monthly claim report. Most of that is independent of the API.
3. A **provider-agnostic adapter** lets us plug in direct NUPCO, an approved hub/vendor, or manual capture later without rewriting the POS.
4. The app is already closer than it looks: it captures a Wasfaty reference, patient national ID, prescriber, prescription number/date, prints them on the receipt, and already has the small directions label that Wasfaty's pharmacy requirements ask for.

**Suggested sequence**

```
Phase 0  Wasfaty-ready POS + item mapping + claim export      (build now, ~6–9 dev days)
Phase 1  NUPCO onboarding / API access / DPA                   (parallel, elapsed weeks)
Phase 2  Live connector behind an adapter                      (~10–15 dev days after docs)
Phase 3  Claims, reconciliation, returns                       (~8–10 dev days)
Phase 4  Optional: Wasfaty Library → DOS suggestions, delivery
```

Do **not** scrape or automate the Wasfaty portal. It is fragile, likely outside the terms of use, and puts pharmacist credentials at risk.

---

## 2. What Wasfaty is — verified facts

| Item | Finding | Source |
|---|---|---|
| Operator | NUPCO, under MOH supervision | NUPCO |
| Purpose | Links government hospitals/PHC centres with community pharmacies | NUPCO |
| Patient cost | Free to eligible beneficiaries at participating pharmacies | NUPCO / Saudipedia |
| Scale | 100M+ prescriptions, 2,200+ PHC centres, 230+ hospitals, 5,000+ pharmacies, 172 cities | NUPCO |
| Pharmacy eligibility | NUPCO-accredited pharmacy; valid pharmacy licence and documents; only approved Wasfaty suppliers; pharmacist with valid SCFHS licence; internet-connected computer; **label printer for medication instructions and barcode scanner** | NUPCO |
| Registration | `https://wasfaty.sa/rp/suppliers_add.php?page=add#1` | NUPCO |
| Support number | 920000932 | NUPCO |
| After registration | NUPCO reviews documents → approval → requirements → training → activation | NUPCO |
| Patient identity | National ID / Iqama + prescription number are the lookup keys | Wasfaty portal |
| Dispensing economics | NUPCO reimburses the pharmacy at the agreed Wasfaty price + pharmacy margin; supplier settles the price difference by credit note | NUPCO contract/requirements |
| Settlement timing | 30 days in the 2025 requirements document; 45 days in the 2023 contract template — **confirm current terms** | NUPCO PDFs |
| Reporting | NUPCO provides dispensing reports per pharmacy; suppliers must share current stock monthly | NUPCO requirements |
| Patient guidance | NUPCO's “Wasfaty Library” holds the patient information leaflet, item images and **usage guide**; suppliers must provide patient guidance and method of use when requested | NUPCO requirements |
| Public API | **None found.** Portal (`cp.wasfaty.sa`) requires login; no developer portal, sandbox, or published endpoints | Research finding |

### What integration vendors say the workflow is

Commercial pharmacy systems (Juleb, Phenix, Aumet) advertise Wasfaty modules. Their published descriptions agree on this flow:

```
Patient presents ID / prescription number
  → pharmacy receives the e-prescription
  → view prescription lines and prescriber instructions
  → check local stock / availability
  → submit authorization request
  → pull authorization response (status polling)
  → dispense approved lines (substitution only if allowed)
  → print dispensing receipt + directions label
  → deduct inventory
  → record claim / report for NUPCO reconciliation
```

Juleb explicitly describes API-based authorization requests, “Pulling Authorization Response”, stock checks, dispensing, receipt generation, inventory movements, and reporting. Phenix describes a hosted integration module that links the Wasfaty account and “monitoring fields” to its system.

**Conclusion:** NUPCO does grant API access to approved software, but only through onboarding. There is no documented public contract to build against yet. The integration route itself is a decision NUPCO must confirm.

---

## 3. The three possible integration routes

| Route | What it means | Pros | Cons | When to use |
|---|---|---|---|---|
| **A. Direct NUPCO API** | NUPCO approves the pharmacy/software and issues credentials + technical docs | Full control; no middleman; best long-term cost; data stays between pharmacy and NUPCO | Approval and security review; unknown timeline; contract may change; all maintenance ours | Preferred end state |
| **B. Approved hub / POS vendor** | Integrate with a vendor that already has NUPCO approval (Juleb/Phenix/Aumet-style) | Fastest to live; proven; less NUPCO paperwork | Per-pharmacy/per-branch fees; patient data passes through a third party; dependent on their API and uptime | If direct access is refused or too slow |
| **C. Manual / portal-assisted** | Pharmacist dispenses in the Wasfaty portal; POS captures the structured result | Works immediately; zero NUPCO dependency; creates clean data for claims | Double entry; human error; no real-time status | Phase 0 and permanent fallback |

**Recommendation:** build **C as Phase 0**, apply for **A**, and keep **B** as a commercial fallback. The same POS screens and adapter should support all three.

---

## 4. What the app already has

This is important context — the integration is an extension, not a greenfield build.

| Existing capability | Where | Relevance to Wasfaty |
|---|---|---|
| Wasfaty vs private prescription source | `src/types/sales.ts` → `PrescriptionInfo` | Already models the two channels |
| Wasfaty reference number, prescriber, Rx number/date, patient national ID | `PrescriptionCaptureDialog.tsx` | These are the fields the pharmacy agreement expects the POS to be able to produce |
| Prescription data stored on the sale and mirrored to SQL | `salesStore.recordSale`, `server/src/routes/sales.ts` | Ready to extend with authorization/dispense IDs |
| Receipt prints “وصفتي / Wasfaty Prescription” + ref + Rx + patient ID | `ReceiptView.tsx` | Patient copy already identifies a Wasfaty dispense |
| Directions label (50 mm) | `DosagePrintView.tsx` | Satisfies the “label printer for medication instructions” requirement |
| Per-item directions library | `dosageStore`, Item Master links | Can later accept NUPCO's usage guidance |
| Third-party payer pattern | `Payment.insuranceCompany` + `insuranceApprovalCode` | Wasfaty is economically similar: a payer covers the patient share |
| Batch/stock deduction | `catalogStore` | Dispensing already moves stock |
| ZATCA invoices, VAT per line | POS + `server/src/ubl` | Must decide how a zero-patient-share dispense is documented |
| Item identifiers | `barcode`, `barcodes`, `gtin`, `registrationNo` | Need a NUPCO item code mapping on top |

**Gap:** no NUPCO item code, no authorization/dispense record, no claim record, no Wasfaty tender, no claim report, and the Wasfaty reference is free text with no validation.

---

## 5. Phase 0 — build this now (“Wasfaty-ready”)

Goal: make the pharmacy operationally correct and claim-ready without waiting for NUPCO's API.

### 5.1 POS: a dedicated Wasfaty dispense flow

Add a **Wasfaty** entry point in the POS (button next to the scan field):

```
[ Wasfaty ] → Patient ID (10 digits) → Prescription No → [Load]
   → prescription header card: prescriber, date, status (manual), auth no (optional)
   → add items to the cart, each line tagged with nupcoCode + claim price
   → coverage tender auto-added: patient share 0.00
   → complete sale → directions page → receipt + label
```

Rules:

- A Wasfaty sale is still a normal sale for stock, batch, ZATCA, loyalty (probably no points on a zero patient share — confirm), and audit.
- The pharmacist must still be able to sell non-Wasfaty items in the same basket (Wasfaty allows this; the patient pays for those normally).
- Never block a retail sale because the Wasfaty lookup failed; offer “record manually” with a reason.
- Do not auto-apply directions; keep the existing explicit “Use suggested” behaviour.

### 5.2 Item mapping

Add to `Item`:

```ts
nupcoCode?: string;        // NUPCO item code from the Wasfaty item list/certificate
wasfatyPrice?: number;     // NUPCO-approved unit price, if different from basePrice
wasfatyEligible?: boolean; // appears on the Wasfaty approved list
```

Add an **Inventory → Wasfaty mapping** screen:

- search local items; paste/scan NUPCO code; show mapped/unmapped counts
- warn when a dispensed line has no NUPCO code
- allow mapping by `registrationNo` / barcode as a fallback, but require confirmation
- keep a mapping history (who changed it, when)

### 5.3 Structured dispense record

Do not overload `PrescriptionInfo.wasfatyReferenceNo`. Add a first-class record:

```ts
type WasfatyProvider = 'manual' | 'direct' | 'hub';

interface WasfatyDispenseInfo {
  provider: WasfatyProvider;
  prescriptionNo: string;
  authorizationNo?: string;
  nupcoPrescriptionId?: string;
  dispenseId?: string;
  status:
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
  patientNationalId: string; // masked in UI and reports
  pharmacistId?: string;
  submittedAt?: string;
  authorizedAt?: string;
  dispensedAt?: string;
  rejectionReason?: string;
  rawReference?: string; // portal printout / vendor reference
}
```

Put it on `SaleHeader.wasfaty` and keep the existing `prescription` for SFDA/RASD-style record-keeping. They are different purposes and should not be merged.

### 5.4 Money: patient share vs claim amount

Store both, always:

```ts
SaleLine {
  nupcoCode?: string;
  nupcoUnitPrice?: number;
  patientShare?: number;   // normally 0 for covered lines
  claimAmount?: number;    // what NUPCO/supplier will reimburse
}
```

This lets us produce any of the accounting models in §8 later without re-entering data.

### 5.5 Tender

Add `PaymentMethod: 'wasfaty'`:

- auto-add a 100% coverage tender for covered lines
- patient due = non-covered items only
- receipt shows: `Wasfaty / NUPCO coverage — patient share 0.00`
- ZATCA payment means: map to `other` (“instrument not defined”) until a better code is agreed
- do **not** call it “insurance” in reports; keep Wasfaty separate

### 5.6 Claim report export

Add **Reports → Wasfaty claims**:

- month selector, branch selector
- columns: invoice no, date/time, prescription no, authorization no, patient ID (masked), NUPCO code, item, batch, qty, unit price, line total, patient share, claim amount, status
- CSV/XLSX export + print
- totals by item and by status
- a “missing authorization” and “unmapped item” exception list

Match NUPCO's own report columns once a sample is available; keep the internal export stable meanwhile.

### 5.7 Receipt and label

- Receipt: add a compact Wasfaty block (Rx no, auth no, patient share 0.00, “Paid by NUPCO — Wasfaty”).
- Keep the existing 50 mm directions label unchanged by default (item name + AR/EN directions only).
- If NUPCO requires a **dispensing label** with patient name / Rx no / date, add it as a separate optional label variant — do not silently change the agreed DOS label.

### 5.8 Phase 0 data safety

- Mask national ID in lists and reports (`••••••1234`); show full only to an authorised pharmacist.
- Record who dispensed and who authorised, with timestamps.
- Never delete a Wasfaty dispense record; cancel/void with a reason.
- Mirror the claim facts to SQL (unlike DOS, claim data is a financial fact).

**Phase 0 estimate:** 6–9 dev days, including tests and a live check.

---

## 6. Phase 1 — NUPCO onboarding (parallel, no code)

### 6.1 Confirm eligibility

- NUPCO-accredited pharmacy, active Wasfaty account
- valid pharmacy licence and commercial registration
- only approved Wasfaty suppliers
- SCFHS-licensed pharmacist
- internet-connected POS, label printer, barcode scanner
- If not yet registered: `https://wasfaty.sa/rp/suppliers_add.php?page=add#1`, support 920000932

### 6.2 Documents typically requested

- commercial registration copy
- Zakat and income certificate
- VAT registration certificate
- stamped bank IBAN certificate
- establishment registration table
- signed supplier/pharmacy agreement
- chamber-of-commerce-certified authorisation
- pharmacy licence, pharmacist SCFHS licences
- ZATCA certificate / Fatoora status (the app already has this)

### 6.3 Questions to put to NUPCO in writing

1. Is there a **partner/API integration programme** for this pharmacy's own POS, or must integration go through an approved vendor?
2. Can we receive the **API integration guide**: environments, auth, endpoints, payloads, error codes, rate limits, timeouts, idempotency rules?
3. Is there a **sandbox** with test patients, test prescriptions and test items?
4. What are the **IP allowlist / mTLS / OAuth2** requirements?
5. What **data-processing agreement** and **hosting/residency** requirements apply (KSA region, on-prem, encryption)?
6. What is the exact **dispensing receipt/label** content required?
7. What is the **claim report** format and delivery channel (portal, SFTP, API)?
8. What are the **cancellation, partial dispense, substitution and return** rules?
9. Who is the technical escalation contact and what are support hours?
10. Are there **certification/UAT** steps before production activation?

### 6.4 Do not do

- Do not automate the portal with a headless browser or store pharmacist credentials in the app.
- Do not put NUPCO secrets in frontend code or `localStorage`.
- Do not dispense against an unverified prescription just because the network is down.

---

## 7. Phase 2 — target architecture

### 7.1 Shape

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

The browser only calls our server. The server holds credentials in the existing secure store, performs retries, rate limiting, idempotency and audit.

### 7.2 Adapter interface

```ts
interface WasfatyProvider {
  lookupPrescription(input: { patientId: string; prescriptionNo?: string }): Promise<WasfatyPrescription>;
  getPrescription(id: string): Promise<WasfatyPrescription>;
  checkAvailability(lines: WasfatyLine[]): Promise<WasfatyAvailability[]>;
  requestAuthorization(input: WasfatyAuthorizationRequest): Promise<WasfatyAuthorization>;
  getAuthorization(id: string): Promise<WasfatyAuthorization>;
  dispense(input: WasfatyDispenseRequest): Promise<WasfatyDispenseResult>;
  cancelDispense(id: string, reason: string): Promise<void>;
  listClaims(month: string): Promise<WasfatyClaim[]>;
}
```

Implementations:

- `ManualProvider` — Phase 0; records what the pharmacist entered, no network.
- `DirectProvider` — NUPCO API once documented.
- `HubProvider` — approved vendor API.

Feature flag per branch: `wasfaty.provider = manual | direct | hub`.

### 7.3 Internal endpoints (our server, not NUPCO's)

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

These are deliberately provider-neutral so the UI does not change when the provider changes.

### 7.4 Reliability rules

- **Idempotency key** per dispense: `hash(pharmacyId | prescriptionNo | dispenseRef)`; store the provider's response id.
- **Retry only safe reads** (lookup/status) automatically; mutations need an explicit retry with the same idempotency key.
- **Circuit breaker** + clear “Wasfaty unavailable” state; never pretend an authorization succeeded.
- **Polling** for authorization status with backoff if no webhook; show a live “pending” state at the counter.
- **Audit every call**: operation, request id, status, latency, HTTP code, error code. Never log full patient payloads; store references and hashes.
- **Offline:** allow browsing/recording only; do not dispense covered items without an authorization unless a documented emergency override with reason and later reconciliation is approved by the pharmacy owner.

### 7.5 Status machine

```
draft → matched → authorization_pending → authorized
                                         ├→ partially_authorized
                                         └→ rejected
authorized → dispensed → claim_pending → claimed → paid → reconciled
     └→ cancelled
any → error (with reason, retryable flag)
```

---

## 8. Money, VAT and ZATCA — decision required

Wasfaty medicines are free to the beneficiary; NUPCO/supplier pays the pharmacy. There are three defensible document models. **This needs a Saudi tax advisor's sign-off; do not hard-code one yet.**

| Option | Patient document | Value on tax invoice | Pros | Cons |
|---|---|---|---|---|
| **A. Covered sale** (recommended to evaluate first) | Simplified invoice showing line values, `Wasfaty` tender 100%, patient due 0.00 | NUPCO-approved value, zero-rated for medicines | One document; clear audit trail; claim = invoices; no “free supply” ambiguity | Shows a value the patient did not pay; buyer/payment-means treatment must be confirmed |
| **B. Zero-value receipt** | Receipt at 0.00, not a tax invoice | No tax invoice for the covered value | Simple for the patient | May be wrong if NUPCO's payment is consideration for a taxable supply; weaker audit trail |
| **C. Two documents** | Patient receipt at 0.00 | Monthly standard tax invoice to NUPCO | Clean B2B treatment | Heaviest; requires NUPCO VAT details and agreed invoicing process |

Notes:

- Most SFDA-registered medicines are **zero-rated** in the app already (`vatRate: 0`); supplements/cosmetics are standard-rated. Wasfaty coverage may include both — keep VAT per line.
- Store `patientShare` and `claimAmount` separately regardless of the option chosen, so any model can be produced later.
- Do not change the existing ZATCA signing/submission path for this feature until the tax model is confirmed. A Wasfaty sale should still be reported/cleared as required.

---

## 9. DOS / label synergy (a real advantage)

Wasfaty's pharmacy requirements explicitly include a **label printer for medication instructions**. The app already prints a 50 mm directions label with:

```
Paracetamol 500mg (20 tabs)
حبة مرتين يومياً بعد الأكل
twice daily after meals
```

Two opportunities:

1. **Phase 0:** the existing DOS label already satisfies the “medication instructions label” expectation. No change needed.
2. **Phase 4 (optional):** NUPCO's Wasfaty Library carries patient guidance and a usage guide per item. If NUPCO exposes it (API or file), map `nupcoCode → patient guidance` and use it to **suggest** a DOS row for the item. Keep the pharmacist's explicit choice and the frozen sale snapshot; never auto-apply.

Do not merge NUPCO guidance into the DOS master silently. Import as a new suggestion with a source label (`Wasfaty Library`) and a review step.

---

## 10. Security, privacy and PDPL

Wasfaty data is health data linked to a national ID — sensitive personal data under Saudi PDPL.

### Required controls

| Area | Control |
|---|---|
| Credentials | Server-side only; encrypted secure store; rotation; no browser/localStorage |
| Transport | TLS 1.2+; mTLS if NUPCO requires; certificate expiry monitoring |
| Access | Role-based: cashier cannot authorise/dispense; licensed pharmacist role required; full national ID visible only to that role |
| Minimisation | Send only fields NUPCO requires; mask ID in UI/reports; no PHI in analytics |
| Logging | Audit trail of who/what/when; redact request/response bodies; keep provider request IDs |
| Storage | Encrypt at rest; consider column-level encryption for national ID; encrypted backups |
| Retention | Define per MOH/NUPCO rules (commonly 10 years for health/dispensing records — confirm); purge/archive after |
| Residency | Confirm NUPCO requirement; prefer KSA hosting/on-prem; document any cross-border transfer |
| Agreements | NUPCO data-processing/confidentiality agreement; vendor DPA if using a hub |
| Incidents | Breach detection and notification procedure; named owner |
| Testing | DPIA before go-live; penetration test of the connector; no production data in test |

### Current app note

The app already stores patient national ID in browser storage and mirrors sales to SQL. Before go-live, decide whether Wasfaty records should live **only** server-side (stronger) or continue to be mirrored. At minimum, mask the ID in the browser and restrict the route.

---

## 11. Effort and timeline (estimates)

| Phase | Work | Estimate | Dependency |
|---|---|---|---|
| 0 | Wasfaty mode, item mapping, tender, claim record/export, receipt block | 6–9 dev days | none |
| 1 | NUPCO onboarding, documents, API request, DPA | 2–8 weeks elapsed | pharmacy + NUPCO |
| 2 | Server connector, adapter, status machine, audit, POS wiring | 10–15 dev days | API docs + sandbox |
| 3 | Claim import, 3-way reconciliation, returns/cancellations | 8–10 dev days | sample report |
| 4 | Wasfaty Library → DOS suggestions; delivery | 5–8 dev days | NUPCO data access |
| — | Hardening, DPIA, UAT, pilot | 5–7 dev days | phases 0–2 |

**Total after credentials: ~25–35 dev days.** With Phase 0: **~35–45 dev days**, spread over the onboarding wait.

---

## 12. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| No public API / approval delayed | Cannot schedule Phase 2 | Phase 0 now; written NUPCO confirmation; hub fallback |
| API contract differs from vendor descriptions | Rework | Adapter + contract tests; no NUPCO shapes in UI |
| Authorization latency at the counter | Queue builds | Prefetch on ID entry; pending state; separate “authorize now” action |
| Network outage | Cannot dispense | Read-only fallback; explicit emergency override with reason; reconcile later |
| Item mapping errors | Wrong claim / wrong drug | Mapping screen, registrationNo/barcode fallback, unmapped block, audit |
| Partial dispense / substitution rules | Wrong claim | Per-line status; reason codes; NUPCO rules encoded, not guessed |
| Duplicate dispense | Double claim / audit finding | Idempotency key + status check before dispense |
| VAT/ZATCA treatment wrong | Compliance exposure | Accountant sign-off before Phase 0 money model is final |
| PHI leakage | PDPL breach | Server-only credentials, RBAC, masking, redacted logs, DPIA |
| Returns / claim clawback | Revenue loss | Reversal flow tied to original authorization/dispense |
| Staff double entry in pilot | Errors | Shadow mode: portal + POS in parallel for 2–4 weeks, then compare |

---

## 13. Open decisions (need your answer)

1. **Route:** direct NUPCO API (recommended target), approved hub (faster), or manual only (Phase 0)?
2. **Accreditation:** is the pharmacy already NUPCO-accredited and active in Wasfaty? Which branch(es) first?
3. **Access:** do you already have a NUPCO integration contact, credentials, or a signed integration agreement?
4. **Sale creation:** should a Wasfaty dispense **automatically create the POS sale** (recommended), or only prefill the cart for the cashier?
5. **Money model:** Option A (covered sale, 100% Wasfaty tender, patient 0.00), Option B (0.00 receipt), or Option C (monthly invoice to NUPCO)? Accountant must confirm.
6. **Pharmacist role:** should authorization/dispensing be restricted to a licensed-pharmacist login, separate from cashier?
7. **Data:** is the SQL server on-prem in KSA? Any NUPCO residency requirement you already know?
8. **Claim report:** can you share a sample NUPCO/supplier monthly report so the export matches it exactly?
9. **DOS:** do you want Wasfaty's patient guidance to feed suggested directions later (Phase 4)?
10. **Pilot:** one branch first, then rollout — or all branches at once?

---

## 14. What I need to start Phase 0

- Confirmation of the branch and pharmacist users.
- The NUPCO item list / certificate (or a sample) to seed `nupcoCode`.
- A sample Wasfaty prescription printout and a sample monthly claim report.
- The tax advisor's choice for §8 (can be decided during Phase 0; the data model supports all three).
- Approval to add `nupcoCode` / `wasfatyPrice` to the Item Master and a Wasfaty mapping screen.

No code will be changed until you approve the scope and the money model.

---

## 15. Sources

- NUPCO — Wasfaty: An Open Opportunity for All Pharmacy Owners
  `https://www.nupco.com/en/wasfaty-an-open-opportunity-for-all-pharmacy-owners`
- NUPCO — Wasfaty service overview
  `https://www.nupco.com/en`
- NUPCO — Wasfaty supplier requirements (Arabic PDF, 2025)
  `https://www.nupco.com/wp-content/uploads/2025/01/اشتراطات-وصفتي.pdf`
- NUPCO — Wasfaty service contract template (Arabic PDF, 2023)
  `https://www.nupco.com/wp-content/uploads/2023/03/عقد-خدمة-وصفتي.pdf`
- Saudipedia — Wasfaty Service
  `https://saudipedia.com/en/wasfaty-service`
- Juleb — Wasfaty Integrated Pharmacy Software: Technical Guide
  `https://juleb.com/blog/Wasfaty-Integrated-Pharmacy-Software/en`
- Juleb — Wasfaty–Juleb integration
  `https://juleb.com/blog/wasfaty-juleb-integration-pharmacy-management/en`
- Phenix Systems — Wasfaty integration module
  `https://phenixsoft.com/en/integration/wasfaty`
- VitaCare — Wasfaty registration documents
  `https://vitacareonline.com/en/vc-wasfaty`
- Wasfaty public portal (lookup only; no public API docs)
  `https://wasfaty.sa`
- Wasfaty community portal (login required)
  `http://cp.wasfaty.sa`
