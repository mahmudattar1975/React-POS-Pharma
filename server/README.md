# Pharmacy-App ZATCA Server

Holds the ZATCA CSID private key and does everything that has to happen server-side for ZATCA
Phase 2 e-invoicing: CSR/onboarding, UBL 2.1 invoice XML generation, canonicalization, hashing,
ECDSA signing, QR building, and submission to ZATCA's clearance/reporting API. The frontend never
sees the private key - it calls this server over HTTP (`src/api/zatcaApi.ts` on the frontend side).

## Setup

```bash
cd server
npm install
cp .env.example .env   # fill in your real seller/CSR details
npm run dev
```

Requires `openssl` on PATH (used to generate the CSID's EC key + CSR - see `src/crypto/csr.ts`).

## This app's own database (sales/invoices/returns backup)

Sales and returns are still recorded primarily in the browser's local storage (`src/store/
salesStore.ts`) - a sale must never fail because a server or database is unreachable. This
database is a best-effort backup of that same data, written to right after every local save (see
`salesStore.ts`'s `recordSale`/`recordReturn`), so it survives a cleared browser/new device instead
of living only in one browser's local storage. It's a brand-new, empty database - **not** a
connection to XPH, and **not** the legacy `ftotsalf_ph`/`ftrnsalf_ph` tables (see
`src/erp/README.md`'s "Multi-branch / head-office visibility" section for why those weren't used:
incomplete scaffolding, no real stock decrement, no safe invoice numbering).

One-time setup:
1. Run `prisma/create-database.sql` once against your SQL Server (the same instance that hosts
   XPH), using an account with rights to create databases.
2. Add a real `DATABASE_URL` to `.env` pointing at that new, empty database (see `.env.example`
   for the format).
3. `npm run db:migrate` - creates this app's own tables (`prisma/schema.prisma`, a field-for-field
   mirror of `src/types/sales.ts`) inside it. Re-run this after any future schema change.

Until that's done, `/api/sales` and `/api/sales/returns` just fail with a 502 - confirmed live: the
server still starts and serves everything else normally, and a sale still completes and prints a
receipt with no `DATABASE_URL` set at all (the failure is caught and only logged, never surfaced to
the cashier).

Confirmed live end-to-end (2026-10-02): created `PharmaDB` (collation `Arabic_CI_AS` - every text
column here is `NVARCHAR`, confirmed via `npx prisma migrate diff --from-empty --to-schema-datamodel
prisma/schema.prisma --script`, so this only affects sort/compare order, not whether Arabic text
stores correctly) on the same named-instance SQL Server that hosts XPH (`HOST\InstanceName` works
directly in Prisma's connection string - no `instanceName=` param needed). Migration applied, and a
real POST to `/api/sales` was confirmed to actually land a row in the table, not just return `200`.

### Test catalog (Item/Batch/Offer) - `npx prisma db seed`

Added so the app can be exercised against PharmaDB with real-shaped data, without a live ERP
connection every time. `prisma/seed.ts` is idempotent (every write is an upsert keyed by a
deterministic id - safe to re-run) and does two things:
1. Copies this app's existing fictional demo data (`src/utils/seedData.ts`'s items/batches/offers)
   in as-is.
2. Pages through XPH's real item catalog (`searchItems('', page)` - `page` added as an optional
   param for this, default unchanged) and copies a **test batch of 200 real items** (not the whole
   catalog - confirmed live it's large: a generic search term alone matched 3000+ rows) plus
   whichever of those currently have in-stock batches (`getSellableBatches`), into PharmaDB.

Confirmed live (2026-10-02): 200 real items fetched across 6 pages; 93 had a populated barcode
(`GTIN_NO`) and were imported (the rest skipped - no barcode means the POS could never scan them
anyway, and `barcode` is a unique column here); 0 of those 93 had any in-stock batch in this test
ERP instance - a real finding about this dev data (the lowest real item numbers appear to be old/
discontinued stock), not a seeding bug.

Promotions have no real source in XPH at all (confirmed separately) - the Offer rows this seeds are
the same fictional demo offers already in `seedData.ts`, copied as-is, not a snapshot of anything
real.

## What's been verified, and what hasn't

This was built without live ZATCA onboarding credentials (no OTP was available from a real
Fatoora portal account while building it). Two different kinds of testing were done, and they
prove different things - don't conflate them:

**Local smoke test** (`npm run build` then run a script that imports `dist/` and drives CSR
generation → self-signed test cert → invoice build → canonicalize → hash → sign → QR, all without
touching the network): confirms the code runs without exceptions and is internally consistent -
specifically, that the ECDSA signature it produces actually verifies against the public key it
also produces, and that the QR decodes to exactly 9 TLV fields of sane size. This caught two real
bugs before they'd have silently produced wrong output:
- `signInvoice.ts` originally put the **raw ~10KB canonical XML** into the QR's "invoice hash"
  field (tag 6) instead of its 32-byte SHA256 digest - a variable named `invoiceHash` actually
  held the XML bytes, not a hash. Fixed; the QR is now the expected ~350-450 bytes, not several KB.
- Fixed alongside it: `signHash()` must receive the *original* message (it hashes once
  internally), not a pre-computed digest - signing the digest itself would have silently
  double-hashed and produced a signature ZATCA's verification would reject.

**Live endpoint check** (hit ZATCA's real `simulation` base URL with a throwaway OTP, expecting
rejection since there's no real onboarding credential): this is *more* informative than it sounds,
because ZATCA's gateway validates requests in layers, and each layer you get past tells you that
layer is correct:
1. First response: `406 "This Version is not supported or not provided in the header"` → fixed by
   adding an `Accept-Version: V2` header (`src/zatca/client.ts`) that wasn't in the original
   implementation.
2. After that fix: `400 {"errorCategory":"Invalid-CSR","errorMessage":"The provided Certificate
   Signing Request (CSR) is invalid."}` - a *specific, structured* error from ZATCA's own CSR
   validator, not a generic gateway rejection.

Point 2 confirms: the base URL, HTTP method, headers (including auth), and JSON body shape are
all correct enough to reach ZATCA's real CSR validation logic. What's **not yet confirmed** is the
exact CSR field/extension encoding ZATCA's validator wants (`src/crypto/csrTemplate.ts`) - getting
further than "invalid" requires either a real OTP to iterate against (each attempt is a real call
to ZATCA's infrastructure, so this wasn't done speculatively), or cross-checking the CSR fields
against ZATCA's own CSR-generation tool/current documentation before the next real attempt.

**A UI/API for switching ZATCA environment was added** (`sandbox` / `simulation` / `production` -
Settings > ZATCA in the frontend, `POST /api/zatca/onboarding/environment` on this server) on the
premise that ZATCA's `sandbox` (the public "developer portal") accepts a fixed test OTP with no
real Fatoora account needed, letting the whole onboarding flow be exercised live without real
business credentials. That premise mostly holds, per ZATCA's own community forum: sandbox has a
lightweight "Developer" tier that reportedly doesn't validate the OTP at all (vs. its "Simulation"
tier, which mirrors production and needs a real OTP from the Fatoora Simulation portal).

First attempt used OTP `123456` (misremembered) and got `400 "Invalid Request"`. Two real
follow-ups, not further guessing:
1. **Web research found a genuine bug**: this file's `csrTemplate.ts` used
   `ASN1:PRINTABLESTRING:TSTZATCA-Code-Signing` for every environment. Cross-checking against a
   published ZATCA integration library (SallaApp/ZATCA's `GenerateCSR.php`) showed the
   certificateTemplateName extension needs a *different ASN.1 string type* per environment, not
   just a different value: sandbox is `UTF8String`, simulation/production are `PRINTABLESTRING` -
   and simulation's template name is `PREZATCA-Code-Signing`, not `TST...` (that was only ever
   right for sandbox). Fixed in `csrTemplate.ts`; confirmed via the local smoke test that CSR
   generation still runs cleanly, but **not yet re-verified against ZATCA live** for simulation.
2. **The OTP itself was wrong**: the commonly-documented sandbox sample OTP is `123345`, not
   `123456` - a two-digit transposition. Retried with `123345`.

**Still gets the same `400 "Invalid Request"` after both fixes.** Since this is the same generic
error as before (not a CSR-specific one like simulation gave), the CSR encoding fix - while a real,
worthwhile correction - probably isn't what's blocking sandbox specifically. The request body/
header shape this project assumes (mirrors simulation's `POST /compliance` + `OTP` header +
`{csr}` body) may not be exactly what the lightweight "Developer" sandbox tier expects, and
community sources didn't have the exact request shape for that specific tier. **Stopped here**
rather than keep guessing against live ZATCA infrastructure without a concrete next lead. Next
real step: get ZATCA's actual Swagger/API reference for the developer-portal environment
specifically (not inferred from simulation's docs), or skip sandbox and go straight to simulation
with a real Fatoora-portal OTP, which is much better documented and already got further (a
CSR-specific error, not a generic one) on the first live attempt.

**Update (2026-09-30) - CSR field encoding checked against ZATCA's own official documentation**,
not just a third-party library this time: downloaded and read ZATCA's real "Developer Portal User
Manual" PDF directly (section 5.3.1, its page 81 config-file screenshot). Two outcomes:
- **Confirmed correct, unchanged**: this file's DN fields (C/OU/O/CN), alt_names fields
  (SN/UID/title/registeredAddress/businessCategory), and the ASN.1 string type + template name per
  environment all match ZATCA's own example exactly. A generated CSR was decoded locally
  (`openssl req -text -noout`) and every field lines up correctly, including the
  `certificateTemplateName` extension value for each environment.
- **A tempting change from that same manual was tried and reverted**: ZATCA's own example declares
  `certificateTemplateName` via a symbolic `[OIDs]` section rather than this file's raw-numeric-OID
  key. Switching to match broke CSR generation outright on this machine's real OpenSSL 3.5.7
  (`OBJ_txt2obj:unknown object name`) - caught by the local smoke test before it could ship. ZATCA's
  own example has other loose ends (a duplicated `req_extensions=` key, an `x509_extensions = v3_ca`
  pointing at a section that doesn't exist in the same example) suggesting it's an illustrative
  screenshot that was never itself run against modern OpenSSL. Kept the raw-OID form, which
  demonstrably works (confirmed by both this local test and the earlier live ZATCA attempt that
  reached ZATCA's own CSR content validator with it - see above).

**Bottom line**: the plumbing (network, auth, crypto, XML structure, QR encoding) is solid, and the
CSR generation itself is now confirmed to be well-formed and to match ZATCA's documented field set
exactly - locally verified, not just assumed. What's still unconfirmed is whether ZATCA's live
validator accepts it, since no real OTP has been available to re-attempt onboarding. That's the one
remaining step once real credentials are available.

## Architecture

```
src/
  config.ts              env-driven seller/CSR/environment config
  crypto/
    csr.ts                shells out to openssl for EC key + CSR generation
    csrTemplate.ts         the openssl config template - MOST LIKELY PLACE TO NEED FIXES, see above
    hash.ts, sign.ts, x509.ts   SHA256, ECDSA signing, X.509 cert field extraction
  ubl/buildInvoiceXml.ts   UBL 2.1 invoice XML builder (ZATCA profile)
  xml/canonicalize.ts      practical C14N stand-in - see its own header comment for caveats
  qr/buildQr.ts            9-tag TLV QR builder (Phase 2)
  zatca/
    client.ts              raw HTTP client for ZATCA's gateway
    onboarding.ts           orchestrates compliance CSID -> checks -> production CSID
    signInvoice.ts           ties XML + canonicalize + hash + sign + QR together for one invoice
    submitSaleInvoice.ts      takes a POS sale, builds+signs+submits it, advances the invoice chain
    sampleInvoices.ts         the 6 throwaway samples ZATCA's compliance check requires
  store/secureStore.ts     DEV-GRADE plaintext JSON storage for CSID keys/certs - see its own
                            header comment before using this anywhere but local development
  routes/, index.ts        Express app
```

## Security note

`store/secureStore.ts` is plaintext-on-disk. Fine for building/testing this locally. Before this
goes anywhere near production, that needs to become a real secrets store (KMS/HSM or at minimum
encrypted-at-rest with access control) - the CSID private key is exactly the kind of thing whose
compromise lets someone forge invoices under this business's VAT registration.
