# Wasfaty / NUPCO API — build reference

This document describes **this app's** Wasfaty API. It is not, and does not claim to be, NUPCO's
wire contract.

> **Why that distinction matters**
>
> NUPCO has no public Wasfaty API documentation, no open sandbox and no self-service credentials.
> Wasfaty integration is available only to an accredited pharmacy through NUPCO onboarding, often
> with an approved supplier/vendor in the middle. Publishing invented NUPCO endpoints or payloads
> would produce an integration that looks complete and fails on the first real call.
>
> So the app is built in two layers:
>
> 1. **A complete, provider-neutral API** (`/api/wasfaty`) that the POS uses today. It is fully
>    implemented, tested and documented here.
> 2. **A contract-file-driven live adapter** (`direct` / `hub`) that refuses to make a call until
>    NUPCO onboarding supplies the real base URL, operations, auth scheme and field mapping.
>
> `manual` and `mock` providers implement the same neutral API entirely in-process, so every part of
> the dispensing and claiming loop can be exercised now.

---

## 1. Provider modes

Selected with `WASFATY_PROVIDER` (default `manual`).

| Provider | What it does | NUPCO access | Typical use |
|---|---|---|---|
| `manual` | The pharmacist reads the prescription from the patient's Wasfaty message and records the dispense. No lookup, authorization or claim submission is faked. | none | Phase 0, go-live at the counter |
| `mock` | Deterministic simulator: lookup returns two known items, authorization approves all lines, dispense/claim get stable fake ids. | none | Demos, training, E2E tests |
| `direct` | Calls the operations defined in the signed contract file. Fails closed if anything is missing. | live NUPCO | After onboarding |
| `hub` | Same as `direct`, through an approved integration hub. | live hub | If NUPCO requires a vendor |

Health always reports the active provider and whether it is configured:

```bash
curl http://localhost:4300/api/wasfaty/health
```

```json
{
  "ok": true,
  "provider": "manual",
  "configured": true,
  "environment": "sandbox",
  "capabilities": {
    "lookupPrescription": false,
    "requestAuthorization": false,
    "submitDispense": true,
    "submitClaim": false
  },
  "contract": {
    "source": "none",
    "missingOperations": ["lookupPrescription", "requestAuthorization", "..."]
  },
  "checkedAt": "2026-11-06T05:30:00.000Z"
}
```

`configured: false` on `direct`/`hub` means the contract is incomplete — the POS keeps working in
manual mode and the Settings panel lists exactly what is missing.

---

## 2. Money model (Option A)

For a covered line:

| Field | Value |
|---|---|
| Invoice line | NUPCO-approved price (`Item.wasfatyPrice`, else the normal price) |
| VAT | Normal per-line VAT, unchanged |
| `patientShare` | `0.00` |
| `claimAmount` | line total incl. VAT |
| Tender | one `wasfaty` payment leg equal to the covered total |
| ZATCA payment means | `other` (UNCL4461 "instrument not defined") |

Non-covered items in the same basket are paid normally by the patient. The invoice total is the
full NUPCO-approved value; the claim can never exceed it.

The server re-validates the arithmetic rather than trusting the client:

* `claimTotal` must equal `Σ line.claimAmount` within 0.01;
* `claimTotal` must be > 0 and ≤ `invoiceTotalInclVat` (+0.01);
* every NUPCO code must be 13 digits, every quantity > 0, every amount ≥ 0;
* patient national ID must be exactly 10 digits.

A rejected payload is a `400` with `{ "error": "...", "code": "invalid_request" }` — the POS never
files a claim that disagrees with the invoice.

---

## 3. Endpoints

Base URL: `http://localhost:4300/api/wasfaty` (the frontend reads `VITE_ZATCA_SERVER_URL`).

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | provider, capabilities, contract completeness |
| GET | `/openapi.json` | OpenAPI 3.0 document |
| POST | `/prescriptions/lookup` | prescription lookup through the active provider |
| POST | `/authorizations` | request NUPCO authorization for covered lines |
| POST | `/dispenses` | record a dispense + open its claim (idempotent) |
| GET | `/dispenses` | list dispenses (`month`, `status`, `invoiceNo`) |
| GET | `/dispenses/:id` | one dispense + claim |
| POST | `/dispenses/:id/cancel` | cancel dispense and pending claim |
| GET | `/claims` | claim ledger (`month`, `status`) |
| POST | `/claims/:id/submit` | submit a pending claim |
| POST | `/claims/:id/reconcile` | record reported/paid amounts or a variance |

### 3.1 Record a dispense

This is the only call the POS must make at checkout. Everything else is reporting/operations.

```bash
curl -X POST http://localhost:4300/api/wasfaty/dispenses \
  -H "Content-Type: application/json" \
  -d '{
    "saleId": "9f1c2d3e-...",
    "invoiceNo": "SIM-000042",
    "session": {
      "patientNationalId": "1234567890",
      "prescriptionNo": "RX-2026-000123",
      "authorizationNo": "AUTH-7788",
      "prescriberName": "Dr. Example",
      "prescriptionDate": "2026-11-06",
      "pharmacistId": "Cashier 1"
    },
    "lines": [{
      "lineId": "line-1",
      "nupcoCode": "6281007320014",
      "itemId": "itm-1",
      "itemNameEn": "Paracetamol 500mg (20 tabs)",
      "itemNameAr": "باراسيتامول 500 مجم",
      "batchNo": "PC23F02",
      "expiryDate": "2027-05-31",
      "qty": 1,
      "unit": "Strip",
      "nupcoUnitPrice": 4.25,
      "patientShare": 0,
      "claimAmount": 4.25
    }],
    "invoiceTotalInclVat": 4.25,
    "claimTotal": 4.25,
    "currency": "SAR"
  }'
```

Response `201`:

```json
{
  "dispense": {
    "id": "WDSP-000001",
    "provider": "manual",
    "status": "manual_recorded",
    "saleId": "9f1c2d3e-...",
    "invoiceNo": "SIM-000042",
    "prescriptionNo": "RX-2026-000123",
    "patientIdLast4": "7890",
    "totalClaimAmount": 4.25,
    "totalPatientShare": 0,
    "claimId": "WCLM-000001",
    "claimStatus": "pending",
    "claimMonth": "2026-11",
    "lines": [ ... ],
    "createdAt": "2026-11-06T05:30:00.000Z",
    "updatedAt": "2026-11-06T05:30:00.000Z"
  },
  "claim": {
    "id": "WCLM-000001",
    "dispenseId": "WDSP-000001",
    "invoiceNo": "SIM-000042",
    "prescriptionNo": "RX-2026-000123",
    "month": "2026-11",
    "expectedAmount": 4.25,
    "status": "pending",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

**Idempotency.** `saleId` is the key. Re-POSTing the same sale returns the existing dispense and
claim instead of creating a second claim. This is what makes the POS retry queue safe.

### 3.2 Submit / reconcile a claim

```bash
curl -X POST http://localhost:4300/api/wasfaty/claims/WCLM-000001/submit
curl -X POST http://localhost:4300/api/wasfaty/claims/WCLM-000001/reconcile \
  -H "Content-Type: application/json" \
  -d '{ "reportedAmount": 4.25, "paidAmount": 4.10, "varianceReason": "NUPCO paid the 2025 margin" }'
```

`manual` returns `503 provider_unavailable` for both: there is no NUPCO connection to submit
through, and pretending a claim was filed would be worse than saying so. `mock` reports the claim
and reconciles it. A live adapter calls the contracted operation.

### 3.3 Cancel

```bash
curl -X POST http://localhost:4300/api/wasfaty/dispenses/WDSP-000001/cancel \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Patient returned the medicine before leaving" }'
```

Cancelling sets the dispense to `cancelled` and a still-pending claim to `cancelled`. A claim
already submitted/paid is left alone — that needs reconciliation, not a silent void.

---

## 4. Contract file (only for `direct` / `hub`)

`WASFATY_CONTRACT_FILE`, default `server/data/wasfaty-contract.json`. Nothing in the repo ships a
live one: the file is created only from NUPCO onboarding material.

```json
{
  "version": "1.0",
  "environment": "production",
  "baseUrl": "https://<supplied-by-nupco>",
  "auth": {
    "type": "bearer",
    "tokenEnv": "NUPCO_WASFATY_TOKEN"
  },
  "operations": {
    "lookupPrescription":  { "method": "POST", "path": "/<supplied-path>" },
    "requestAuthorization": { "method": "POST", "path": "/<supplied-path>" },
    "submitDispense":      { "method": "POST", "path": "/<supplied-path>" },
    "cancelDispense":      { "method": "POST", "path": "/<supplied-path>" },
    "submitClaim":         { "method": "POST", "path": "/<supplied-path>" },
    "reconcileClaim":      { "method": "POST", "path": "/<supplied-path>" }
  },
  "mappings": {
    "lookupPrescription": {
      "prescriptionId": "data.rxId",
      "patientIdLast4": "data.patient.last4",
      "prescriberName": "data.doctor.nameEn",
      "issuedAt": "data.issueDate",
      "status": "data.status",
      "lines": "data.items",
      "lineId": "itemId",
      "nupcoCode": "gtin",
      "qty": "quantity"
    }
  }
}
```

* **`operations`** — required. Every one of the six must exist or the adapter stays disabled. A
  missing operation is reported by `/health` and in Settings; it is never guessed.
* **`auth`** — `none`, `bearer` or `apiKey`. Prefer `tokenEnv`; a literal `token` is only for a
  local harness and should never be committed.
* **`mappings`** — optional. Without a mapping the supplier must answer in the neutral shape shown
  in `/openapi.json`. With a mapping, dot paths (including `[n]` indexes) translate the supplier's
  envelope. This is the one place where NUPCO's real field names belong.

Live adapters send the neutral record/claim as the request body; the record includes `saleId` so
NUPCO can implement its own idempotency if the contract requires it.

---

## 5. Storage

`server/data/wasfaty.json` (override: `WASFATY_DATA_FILE`):

```json
{
  "dispenses": [],
  "claims": [],
  "counters": { "dispense": 0, "claim": 0 }
}
```

* Writes are serialised through one promise chain and written to a temp file then renamed, so two
  concurrent tills cannot lose a claim and a crash cannot truncate the file.
* Only the **last four digits** of the patient ID are stored. The full ID stays in the local sale /
  dispense screen, masked in lists, receipts and exports.
* This is dev-grade plaintext storage. Production needs an access-controlled database with a
  retention/backup policy. It is not part of the ZATCA signed-invoice archive.

---

## 6. What NUPCO still has to supply

This is the complete blocker list. Until each item is answered, `direct`/`hub` stays disabled and
manual dispensing remains the honest mode.

1. **Onboarding + credentials** — pharmacy NUPCO registration, Wasfaty participation approval,
   environment approval (test/production), an approved supplier/hub if required.
2. **Base URLs per environment** and any IP allow-list / VPN requirement.
3. **Authentication** — scheme (OAuth2 client credentials, mTLS, API key), token lifetime,
   rotation, and how the pharmacy-specific identity is bound.
4. **Prescription lookup** — path, method, request/response fields, error codes, pagination, and
   whether partial dispensing is allowed.
5. **Authorization** — request and status operations; meaning of partial/rejected lines; expiry of
   an authorization; substitution rules.
6. **Dispense** — submit/cancel operations, whether a NUPCO dispense id is returned, idempotency
   key expectations, and how a corrected dispense is handled.
7. **Claims** — submission window and cut-off (30 or 45 days depending on contract year), month
   close, reported/paid/variance fields, credit-note flow for supplier price differences.
8. **Reference data** — the authoritative 13-digit NUPCO item list and approved prices, plus how
   updates are delivered.
9. **Non-functional** — rate limits, retry/backoff, sandbox availability, support contacts.
10. **Compliance** — written patient-data handling confirmation under PDPL, audit/log retention, and
    whether the pharmacy or the hub is the data processor.

Record the answers in the contract file and this document. Do not fill them in from memory or from
a third-party blog post.

---

## 7. Client behaviour

`src/api/wasfatyApi.ts` is the only browser client. The sale is always recorded locally first; the
dispense mirror is best-effort:

* success → the local invoice's `wasfaty` block is patched with the server ids (`patchInvoiceWasfaty`);
* failure → the dispense input is queued in `pendingSyncStore` as `wasfatyDispense` and retried on
  the next app load/periodic flush;
* the tax invoice, VAT, payments and ZATCA document never change as a result of either path.

The claim report (`/wasfaty-claims`) is built from saved sales, not from the item master, so editing
a NUPCO mapping or price today cannot rewrite an issued claim.

---

## 8. Verification

Automated (run from the project root):

```bash
npx tsc -b --pretty false          # client
cd server && npx tsc -b --pretty false
npx vitest run                     # 295 tests
npm run lint
npm run build
```

End-to-end server smoke with the simulator:

```powershell
cd server
$env:WASFATY_PROVIDER='mock'
$env:WASFATY_DATA_FILE="$env:TEMP\wasfaty-smoke.json"
$env:PORT='4301'
node dist/index.js
```

Then `POST /api/wasfaty/dispenses`, `GET /api/wasfaty/claims`, `POST /api/wasfaty/claims/{id}/submit`
and `POST /api/wasfaty/claims/{id}/reconcile` — all should succeed and be idempotent on replay.

---

## 9. Files

```
server/src/wasfaty/types.ts        provider-neutral types + provider interface + contract shape
server/src/wasfaty/contract.ts     contract loading + completeness check
server/src/wasfaty/providers.ts    manual / mock / direct / hub adapters
server/src/wasfaty/store.ts        serialised JSON dispense + claim ledger
server/src/wasfaty/service.ts      validation, Option A arithmetic, idempotency, lifecycle
server/src/wasfaty/openapi.ts      OpenAPI 3.0 document
server/src/routes/wasfaty.ts       /api/wasfaty routes
src/api/wasfatyApi.ts              browser client
src/types/wasfaty.ts               browser-side types
src/utils/wasfaty.ts               pure mapping/coverage/claim helpers
src/store/cartStore.ts             session, coverage flagging, approved-price repricing
src/components/POS/POSPage.tsx     capture, guard, coverage totals, dispense mirror
src/components/POS/WasfatyCaptureDialog.tsx
src/components/Inventory/WasfatyMappingPage.tsx
src/components/Reports/WasfatyClaimsPage.tsx
src/components/Settings/WasfatySettingsPanel.tsx
```
