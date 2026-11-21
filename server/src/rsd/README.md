# RSD (رصد) adapter - Pharmacy Sale / Pharmacy Sale Cancel

SFDA's Drug Track & Trace System (DTTS, branded **RSD**) treats every *pack* as a tracked unit.
This app therefore reports at unit level: one `Pharmacy Sale` per physical pack sold, identified by
its GS1 DataMatrix `GTIN + SN`, with the `BN` and `XD` it was dispensed from.

## Scope

In scope, and nothing else:

| Operation | When this app sends it |
|---|---|
| `Pharmacy Sale` | A POS sale line carried captured GS1 serials. One call per pack. |
| `Pharmacy Sale Cancel` | A **full** return of that invoice. One call per pack whose sale RSD accepted. |

Out of scope: Accept, Dispatch, Return, Transfer, Deactivate, Consume, PTS, batch-level sale.
A **partial return sends nothing**: RSD has no partial-sale-cancel, and cancelling a unit that is
still with the patient would be false. Only a full return cancels the units.

## Architecture

```
POS (browser, local-first)
  └─ src/api/rsdApi.ts ──HTTP JSON──> /api/rsd (server/src/routes/rsd.ts)
                                        └─ service.ts  (idempotency, ordering, ledger)
                                             ├─ mock.ts       RSD_MODE=mock
                                             └─ wire.ts + soapClient.ts   RSD_MODE=live
                                                                             └─ SFDA SOAP 1.1
```

* The browser never sees credentials. `GET /api/rsd/status` exposes only `credentialsConfigured`,
  the GLN, and the endpoint URLs.
* Checkout never blocks on RSD. The sale is saved locally first; reporting is a best-effort mirror.
  A transport failure returns `retryable: true` and the caller queues it.
* `server/data/rsd-ledger.json` is append-oriented: one sale record and one cancel record per
  `(GTIN, SN)`, each retaining every attempt with its raw SOAP request/response. Like the rest of
  `server/src/store`, it is **dev-grade plaintext on disk**; production needs an access-controlled
  database with backups.

## Rules the service enforces

1. **One sale per unit, ever.** A sale that returned `RC 00000` is returned as `already_reported`
   on replay and is never sent to SFDA a second time.
2. **One cancel per unit, ever**, and only after its sale was accepted. A cancel can never overtake
   its sale, even if the POS retries both out of order.
3. **Business rejections are terminal.** An `RC` or a SOAP fault is only retried after the payload
   changes (corrected batch/expiry/payer/prescription). Replaying the identical rejected payload
   would just fail again.
4. **Infrastructure failures are retryable.** Timeout, connection loss, HTTP 429/5xx append a new
   attempt to the same record. HTTP 401/403 is reported as non-retryable configuration failure.
5. **Validation before the wire.** GTIN is padded to 14 digits (a GTIN-13 is the same identity),
   serial must be 2-20 characters, expiry must be a real date, and GS1 day `00` becomes the last
   day of that month instead of an invalid `YYYY-MM-00`.

## Configuration (`server/.env`)

| Variable | Default | Meaning |
|---|---|---|
| `RSD_MODE` | `mock` | `mock` or `live`. |
| `RSD_ENV` | `test` | `test` or `production`. Selects the credential pair and endpoints. |
| `RSD_TEST_GLN`, `RSD_TEST_USERNAME`, `RSD_TEST_PASSWORD` | - | Test credentials (HTTP Basic). |
| `RSD_PROD_GLN`, `RSD_PROD_USERNAME`, `RSD_PROD_PASSWORD` | - | Production credentials. |
| `RSD_TEST_SALE_URL`, `RSD_TEST_CANCEL_URL` | none | Required in live test mode; there is no published default, so a test run cannot silently hit production. |
| `RSD_PROD_SALE_URL`, `RSD_PROD_CANCEL_URL` | published SFDA URLs | Override only if SFDA changes them. |
| `RSD_DIRECT_TO_GLN` | `0000000000000` | To-GLN for a patient/direct sale. |
| `RSD_DIRECT_PRESCRIPTION_ID` | `DIRECT-SALE` | Placeholder `PRESCRIPTIONID` for OTC sales. |
| `RSD_TIMEOUT_MS` | `20000` | Per-request timeout. |
| `RSD_DATA_FILE`, `RSD_MOCK_FILE` | `server/data/*.json` | Ledger and mock state overrides. |

Live mode fails closed: if credentials or the environment's URLs are missing, every report returns
`503 rsd_not_configured` and nothing is faked. Production endpoints must be `https://`; the adapter
refuses to send credentials over plain HTTP.

> SFDA's **test** host is plain HTTP on port 8080. That means HTTP Basic sends the test password
> unencrypted on the network. Use a password created only for this test account, never a
> production or personal one, and never reuse it anywhere else.

## HTTP API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/rsd/status` | Mode, environment, masked config state, ledger counters. |
| POST | `/api/rsd/sales` | Report one pack. Idempotent on `gtin + serialNo`. |
| POST | `/api/rsd/sales/cancel` | Cancel one pack after a full return. |
| GET | `/api/rsd/records` / `/api/rsd/reports` | Ledger, filter by `kind`, `status`, `invoiceId`, `invoiceNo`, `limit`. |
| GET | `/api/rsd/units/:gtin/:serialNo` | Sale/cancel state of one unit. |
| POST | `/api/rsd/mock/accept` | Mock only: seed a unit as accepted into inventory. |
| POST | `/api/rsd/mock/reset` | Mock only. |

A sale payload is `{ gtin, serialNo, batchNo, expiryDate, toGln?, prescriptionId?,
prescriptionDate?, doctorId?, patientNationalId?, invoiceId?, invoiceNo?, saleLineId? }`. Local
references are stored for reconciliation and never sent to SFDA.

## Wire format

Verified against SFDA's production endpoints by field probes, and implemented in `wire.ts`:

* SOAP 1.1 (`text/xml; charset=utf-8`, `SOAPAction: ""`), HTTP Basic, document/literal.
  The integration guide states SOAP 1.2; the live endpoints answer that with HTTP 415.
* Sale namespace `http://dtts.sfda.gov.sa/PharmacySaleService`, request element
  `PharmacySaleServiceRequest`, child order
  `TOGLN, DOCTORID?, PATIENTNATIONALID?, PRESCRIPTIONID, PRESCRIPTIONDATE, PRODUCTLIST`,
  with `PRODUCT = GTIN, SN, BN, XD`.
* Response: `NOTIFICATIONID` plus a per-product `RC`; faults carry `faultstring` and `<FC>`.

**Unverified:** the cancel envelope/namespace (`PharmacySaleCancelService`) is built symmetrically
and must be confirmed against `DTTS-ISD.PHARMACYSALE-nnn` or the cancel WSDL before the first live
cancel. Run `npm run rsd:trial -- --probe` first; it never creates a movement.

## Trial

From `server/`:

```bash
npm run rsd:trial                 # full offline suite against the mock
npm run rsd:trial -- --probe      # live WSDL/auth probe only, no sale/cancel
npm run rsd:trial -- --unit 06281007320021:SN123456:AX24C09:2027-05-31
npm run rsd:trial -- --unit ... --yes   # required for RSD_ENV=production
```

`--probe` needs only the username/password (it never reads or needs a GLN). A sale/cancel also
needs `RSD_TEST_GLN` and a unit that is already in that GLN's RSD inventory.

The mock suite covers: accepted sale, duplicate sale (no second send), wrong batch (`11036`),
unit outside inventory (`11043`), accepted cancel, duplicate cancel, cancel without sale, and an
HTTP 500 that stays retryable while appending attempts.

The live suite probes both WSDLs, sells one real unit, replays the sale (must be local
`already_reported`, no second send), cancels it, and replays the cancel. It deliberately does not
test unknown units or wrong batches live: every such attempt is a real operation.

Evidence is written to `server/data/rsd-trial-<timestamp>.json` (gitignored) with steps, RC codes,
notification ids, attempt counts and probe results. No credentials are written; the GLN is masked.

Interpretation: `HTTP 401` means the username/password were rejected. `UND_ERR_CONNECT_TIMEOUT` /
`ECONNREFUSED` means the host is unreachable from this machine - SFDA's test environment is often
restricted by VPN or source-IP allowlisting, so check that before touching credentials.

## Open questions (blocking parts of a production rollout)

1. Who performs **Accept** of supplier dispatches? A sale is rejected with `11043` until the unit
   is in the pharmacy's RSD inventory. Accept is outside this app's scope.
2. Test-environment service URLs and the `DTTS-ISD.PHARMACYSALE-nnn` document.
3. Are non-serialised sales allowed to complete locally and simply not reported, or should RSD
   enabled stores block them? Current behaviour: not reported.
4. Always `Direct Sale`, or a payer GLN for Wasfaty/insurance sales with a real prescription id?
5. One GLN per branch, or one per organisation?
6. Manual serial entry for a damaged/unreadable DataMatrix label (Phase 1b).
