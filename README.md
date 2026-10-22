# Pharmacy POS

A from-scratch point-of-sale app for pharmacy retail in Saudi Arabia, designed against the
legacy `w_scrn_sales_pharmacy` PowerBuilder screen as a functional spec (not ported line-by-line).
See `../OpenMind-FrontEnd-React/PROJECT_OVERVIEW.md` for the full background on why this exists
as a standalone app rather than another screen in the PharmaAxis ERP port.

## Run it

```bash
npm install
npm run dev
```

Runs entirely against seed/mock data persisted to the browser's localStorage (via zustand
`persist`), so it's testable standalone even without the ZATCA server below. Seed data lives in
`src/utils/seedData.ts`.

For real (Phase 2) ZATCA signing/submission, and for live XPH item/customer data, also run the
companion server - see `server/README.md` and `server/src/erp/README.md`:

```bash
cd server && npm install && cp .env.example .env && npm run dev
```

`.env.example` covers both ZATCA and ERP config in one place. If that server isn't running, isn't
ZATCA-onboarded yet, or can't reach XPH, the app still works - checkout falls back to the Phase 1
client-side QR, and the POS still uses local seed data - rather than blocking the sale.

## What it covers

- **Batch/lot + expiry-aware selling** — every cart line resolves to a specific batch; scanning
  an item with stock in multiple batches prompts a FEFO-ordered picker (`src/utils/fefo.ts`).
- **GS1 pharmaceutical barcode scanning** — `src/utils/gs1.ts` parses GS1 DataMatrix/QR payloads
  (GTIN, batch/lot, expiry, serial) the way SFDA drug track-and-trace barcodes are structured.
  Falls back to plain SKU barcode lookup for anything that doesn't match that shape.
- **Promotions + customer tiers** — buy-X-get-Y, percent, or flat-value item offers, stacked with
  a normal/special/VIP customer discount tier (`src/utils/pricing.ts`).
- **VAT, per item** — every line reads its own VAT rate from the item master (`Item.vatRate`),
  never a single invoice-wide rate: SFDA-registered medicines are 0%, cosmetics/hygiene/most OTC
  supplements are 15%, so one invoice routinely mixes both. Cart totals and the receipt show a
  breakdown per rate present (`src/utils/vat.ts`'s `groupVatByRate`), not one flat "VAT (15%)"
  figure - see `src/types/catalog.ts`'s note on `vatRate` for the full rule.
- **ZATCA e-invoicing, both phases**:
  - **Phase 1** (`src/utils/zatcaQr.ts`) — the 5-field TLV QR (seller name, VAT number,
    timestamp, total, VAT total), generated entirely client-side. Always available as a fallback.
  - **Phase 2** (`server/`) — a companion Node backend that holds the ZATCA CSID private key,
    builds and signs a real UBL 2.1 invoice, and submits it to ZATCA's clearance (B2B) or
    reporting (B2C) API, returning the full 9-field cryptographically-stamped QR. See
    `server/README.md` for exactly what's been verified so far and what still needs a real
    onboarding OTP to confirm.
- **Sales returns**, an inventory/expiry view with near-expiry and reorder alerts, a stock
  receiving screen, and daily sales/VAT reports.
- **Bilingual (Arabic + English) receipts** — required, not decorative: ZATCA tax invoices are
  legal Saudi documents and must show the Arabic invoice-type term (فاتورة ضريبية مبسطة /
  فاتورة ضريبية), not just an English label. Store name and item names are bilingual too.
- **Live read access to the real PharmaAxis ERP (XPH database)** — `server/src/erp/` reads real
  item master, batch/stock, and customer data from XPH through the existing .NET API (not a
  direct DB connection), so this can be tested against real pharmacy data instead of only the
  local seed catalog. Read-only by design - see `server/src/erp/README.md`. Try it in Settings.

## What it deliberately doesn't cover yet

- **Prescription / controlled-substance workflow** — not present in the legacy screen reviewed
  for this design; confirm whether it's out of scope or lives elsewhere before shipping.
- **Multi-terminal sync** — state is per-browser (localStorage), not shared across registers.
- **Production-grade secrets storage** for the ZATCA CSID private key — see the security note in
  `server/README.md`.
