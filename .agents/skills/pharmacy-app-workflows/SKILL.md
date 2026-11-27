---
name: pharmacy-app-workflows
description: Use this skill whenever work touches the Pharmacy-App repository at F:/SOURCE/React/Pharmacy-App — adding or changing a page, touching POS/inventory/purchasing/Wasfaty/ZATCA/RSD flows, running or debugging tests, doing a UI/accessibility/performance pass, or verifying a change. It requires reading .mdfile/Maindeign.md before any new task and captures the project's auth/shift gates, mock integration modes, accessibility rules, bundle rules, and the exact verification commands. Trigger even when the user does not name this skill, as long as the task is about this codebase.
compatibility: Node 20+, npm, Playwright Chromium, optional agent-browser + axe for UI audits.
---

# Pharmacy-App workflows

This is a local-first pharmacy POS. Almost every screen is a Zustand store over `localStorage` plus an
Express mirror on `:4300`; the cashier shift comes from a separate dotnet-pos API on `:5000`. Treat
those boundaries as intentional: a backend failure must never block the till.

## 0. Non-negotiable engineering standards

**Before starting ANY new task in this repository, read `.mdfile/Maindeign.md` in full.** The owner
adopted it as the fixed canonical standards file for every phase (analysis, design, implementation,
testing and review). Do not rely on memory alone; open the file again. The five focus areas are:

1. **Do not change existing business logic before understanding it.** Preserve pricing/discount/tax,
   unit conversion, stock balances and sale/purchase/return rules; add regression tests first.
2. **Performance starts in SQL Server and index design.** Deliberate (composite) indexes, Index Seek
   over Table Scan, no `SELECT *`, barcodes stored as text, and Execution Plan / Logical Reads compared
   before and after.
3. **Never load more data than the screen needs.** Explicit Prisma `select`/DTOs, server-side search,
   pagination/virtualization, no whole-catalogue loads on screen open.
4. **Test every change before integrating it.** Build + lint + unit + e2e as appropriate; verification
   is evidence, not an assumption.
5. **No task is complete without performance measurement and tests.** Include before/after numbers and
   test results in the implementation report.

Priority: Data Integrity > Business Logic Correctness > Performance > Security > Scalability >
Maintainability > User Experience. Analyze first, propose second, implement third.

## 1. Know the gates before debugging "the page is empty"

- `RequireAuth` reads the persisted `pharmacy-auth` session from `localStorage`.
- `DrawerGate` calls `GET http://localhost:5000/Shift/Current`. Without an open shift the app shows
  the open-drawer dialog instead of the page. In E2E this endpoint is stubbed in `e2e/fixtures.ts`.
- Each Playwright test gets a fresh browser context, which means fresh seed data from
  `src/utils/seedData.ts`. Do not "fix" tests by sharing state between them.
- The persisted stores are the source of truth for offline work. `pendingSyncStore` and
  `rsdOutboxStore` flush on an interval from `src/App.tsx`; keep retries idempotent.

## 2. Verification gates (run before calling a change done)

```powershell
npm run build          # tsc -b && vite build; must have no chunk-size warning
npm run lint           # oxlint; warnings are allowed, new ones should be justified
npm test               # Vitest: 46 files / 574 tests at last verified state (2026-11-27)
npm run test:e2e       # Playwright: 47 tests; workers are pinned to 2 in playwright.config.ts
```

If `npm run test:e2e` reports `ERR_CONNECTION_REFUSED`, check that Vite is listening on `:5173`
before suspecting application code. If only the RSD spec fails, check whether a local backend is
running in mock mode; that spec aborts `/api/rsd/**` itself and should be independent of it.

For a UI audit with `agent-browser`, seed the auth session and a benign open shift with an init
script before opening the app, then run `a11y --json`. Wait for lazy routes to finish loading before
auditing: a Suspense spinner has no `main`/`h1` and produces false violations. Representative routes:
`/`, `/inventory`, `/purchases`, `/items`, `/vendors`, `/offers`, `/cost-centers`, `/dashboard`,
`/settings`, `/prescriptions`, `/reports`, `/sales-invoices`, `/zatca-setup`, `/wasfaty-claims`,
`/rsd-reporting`. Expected result is zero axe violations.

## 3. Integration modes — never switch them silently

- Defaults in `server/.env` are live/production integrations; local manual testing has used
  process-local overrides instead: `WASFATY_PROVIDER=mock`, `WASFATY_ENV=sandbox`,
  `ZATCA_MODE=mock`, `RSD_MODE=mock`, `RSD_ENV=test`.
- When temporarily stopping/restarting the backend, restore the same overrides. The browser never
  receives credentials; `GET /api/rsd/status` exposes only masked state.
- Wasfaty/NUPCO: mapping → lookup → authorization → dispense → claim → reconcile. Every step has a
  mock adapter; keep the claim ledger and idempotency intact.
- ZATCA: invoices are saved locally first, then submitted; mock mode must be obvious in the UI.
- RSD: a sale is always recorded locally and queued if SFDA is unreachable. `Accept` of supplied
  units is outside this app, so a business rejection ("not in pharmacy inventory") is expected.
- Controlled drugs: dispense, return and write-off all write an outward/inward register row.

## 4. Design and accessibility conventions

- The designed system lives in `src/theme.ts`. Prefer adjusting tokens there over one-off colors in
  pages; semantic colors must reach at least 4.5:1 on the page background and selected-tab tint.
- `AppLayout` owns the skip link, `<nav>`, `<main id="main-content">`, `<h1>` and the sidebar list.
  Pages should not add a second visible title bar just to satisfy an outline check.
- `MuiTypography.variantMapping` keeps the type scale while giving headings meaningful tags:
  `h4/h5 → h2`, `h6 → h3`, subtitles → `p`. Use `component="h2"` for the sole title of a page.
- Icon-only buttons need descriptive `aria-label`s (`Edit offer for <item>`, `Remove <item> from sale`).
  Table action columns need a visible `Actions` header, not an empty `<th>`.
- MUI `Select` without a visible `InputLabel` needs `inputProps={{ 'aria-label': ... }}`.
  Prefer short visible tab labels with a fuller `aria-label` for screen readers.
- `CardNetworkPicker` uses `ButtonBase` with `aria-pressed`; keep keyboard focus visible.
- The app is English-first with Arabic text in Wasfaty/ZATCA contexts; there is no central RTL setup.

## 5. Performance conventions

- POS, Inventory and Purchasing hubs stay eager: they are the cashier hot path.
- Compliance/reporting/config pages are `React.lazy` inside the `Suspense` boundary in `App.tsx`.
- `vite.config.ts` splits `react`, `mui`, `router`, `qrcode` and `xlsx` into vendor chunks. Do not
  reintroduce a static `import * as XLSX from 'xlsx'`; use `await import('xlsx')` inside the handler
  that actually exports or imports a file. Verify with a fresh session that `/` makes no `xlsx` request.
- Before adding a dependency to a page, ask whether it belongs in a lazy route or a vendor chunk.

## 6. Working style

- Read the surrounding hub/store before editing a page; most pages are path-driven tab content and
  renaming/moving a route silently breaks bookmarks and E2E specs.
- Keep changes small and behavior-preserving. React purity / `set-state-in-effect` lint warnings are
  existing technical debt; fix them in a dedicated refactor with tests, not as a side effect.
- Nothing is committed by default. Summarize changed files and verification results, and let the user
  decide when to commit.
- The audit that produced these rules is in `docs/skills-audit-report.md`; read it for the exact
  before/after numbers and the rationale behind the fixes.
