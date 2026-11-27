# ERP CLOUD SECURITY AUDIT — Pharmacy-App

**Assessment type:** Static security assessment / pre-production architecture review  
**Date:** 2026-11-27  
**Repository:** `F:\SOURCE\React\Pharmacy-App`  
**Baseline commit:** `b66c4be feat(items): finalize item master domains and SQL ordering`  
**Authorization:** Owner-authorized assessment of own application. Staging/approved accounts only. No destructive tests, DoS, or third-party testing performed.  
**Code changes during assessment:** None. Only this report file was created.

---

## 0. Scope, method and honesty statement

### 0.1 Actual stack found (important correction)

The requested role described **ASP.NET Core Web API + EF Core**. The repository does **not** contain ASP.NET Core source:

- No `.cs`, `.csproj`, `.sln`, `.aspx`, or .NET config files were found.
- The in-repo backend is **Node.js + Express 4 + TypeScript + Prisma 6** on **Microsoft SQL Server**:
  - `server/src/index.ts:1-2` — `import express ...; import cors ...`
  - `server/prisma/schema.prisma:13-16` — `provider = "sqlserver"; url = env("DATABASE_URL")`
- A separate external ASP.NET Core service (`dotnet-pos`) is called by the React app on `http://localhost:5000` (`src/api/posApi.ts:1-9`). Its source is **outside this repository**. Therefore ASP.NET-specific controls (password hashing, JWT signing, lockout, MFA) **cannot be verified from this repo** and are recorded as *not verified / staging required*.

### 0.2 What was done

- Full read-only review of `src/**`, `server/src/**`, `server/prisma/**`, config, dependency manifests, docs, ignore rules and local environment files (values redacted).
- Targeted `grep`/line-level verification of critical claims.
- Dependency audit:
  - Root: `npm audit --omit=dev` → **0 vulnerabilities**.
  - Server: `npm audit --omit=dev` → **8 vulnerabilities (6 high, 2 moderate)**.
- Tool availability check: `OWASP ZAP`, `Burp Suite`, `SonarQube`, `Trivy` were **not available** in this environment. No dynamic scanning, proxy interception, or active exploitation was performed.

### 0.3 What this is NOT

This is **not a penetration test**. It is a static architecture/configuration assessment plus a dependency audit. No claim is made that exploitation was attempted or that the application is 100% secure. Dynamic verification in an isolated staging environment is mandatory before production.

### 0.4 Risk classification

- **CRITICAL** — exploitable by an unauthenticated actor with severe business/regulatory impact; blocks production.
- **HIGH** — serious privilege, isolation, data, or credential exposure; blocks production unless formally mitigated.
- **MEDIUM** — meaningful weakening of defence-in-depth or operability; fix before go-live where practical.
- **LOW** — limited impact or requires additional preconditions.
- **INFORMATIONAL** — positive control or observation.

---

## 1. ERP Security Assessment Report (Deliverable 1)

### 1.1 Architecture summary

| Layer | Implementation | Security observation |
|---|---|---|
| React SPA | React 19 + MUI + Zustand persisted stores | Local-first; `localStorage` holds session token and sensitive PHI; client gates are UX only. |
| Local API | Express 4 + Prisma 6, port 4300 | **No authentication**, wildcard CORS, no security headers, no rate limiting, binds all interfaces. |
| External POS API | ASP.NET Core, port 5000 (outside repo) | JWT bearer token used by React; implementation not reviewable here. |
| Database | SQL Server `dotnet_pos` / `PharmaDB` | Two Prisma clients; `trustServerCertificate=true`; admin-style credentials in gitignored local `.env`. |
| Compliance | ZATCA + RSD/SFDA integrations | CSID private key and RSD password stored in plaintext JSON; submission endpoints unauthenticated. |
| Cloud | Not represented in repo | No IaC, firewall, TLS termination, backup, or monitoring definitions found. |

### 1.2 Production readiness verdict

**NOT PRODUCTION READY.** Two CRITICAL and numerous HIGH findings remain. Most importantly:

1. The Express API accepts unauthenticated reads and writes across sales, returns, stock, master data, ZATCA/RSD configuration and submission.
2. There is no company/tenant isolation in the data model and no authoritative server-side branch identity.
3. Signing credentials and SFDA credentials are stored in plaintext and reachable through unauthenticated APIs.

Per the acceptance criteria, production deployment must be blocked until CRITICAL issues are resolved, HIGH issues are fixed or formally mitigated, and company/branch isolation is verified by testing.

---

## 2. Vulnerability Register (Deliverable 2)

| ID | Severity | Title | Primary location |
|---|---|---|---|
| SEC-01 | CRITICAL | Entire Express API has no authentication | `server/src/index.ts:27-47` |
| SEC-02 | CRITICAL | No RBAC / function-level authorization; admin actions open | `server/src/routes/branches.ts:54-94`, `onboarding.ts:30-100`, `rsd.ts:122-156`, `incentives.ts:145-257` |
| SEC-03 | HIGH | Broken object-level authorization on sales returns | `server/src/routes/sales.ts:200-265` |
| SEC-04 | HIGH | Client-controlled sale totals, status, qty and cashier accepted | `server/src/routes/sales.ts:76-171` |
| SEC-05 | HIGH | Receiving/purchase stock writes unauthenticated and unvalidated | `server/src/routes/receiving.ts:34-111` |
| SEC-06 | HIGH | Cross-branch inventory disclosure | `server/src/routes/stock.ts:11-53` |
| SEC-07 | HIGH | No company/tenant dimension; branch from editable local file | `server/prisma/schema.prisma`, `server/src/branch.ts:8-51` |
| SEC-08 | HIGH | Commission ledger trusts client-supplied record IDs | `server/src/routes/incentives.ts:272-374` |
| SEC-09 | HIGH | Plaintext CSID private key / RSD password on disk | `server/src/store/secureStore.ts:1-25`, `rsd/settings.ts:246-249` |
| SEC-10 | HIGH | Live ZATCA/RSD submission and mode endpoints unauthenticated | `server/src/routes/invoices.ts:25-41`, `onboarding.ts:42-100`, `rsd.ts:50-156` |
| SEC-11 | HIGH | JWT bearer token persisted in browser localStorage | `src/store/authStore.ts:11-19`, `posApi.ts:12-17` |
| SEC-12 | HIGH | Raw patient/customer PHI persisted in localStorage | `src/store/prescriptionStore.ts:107-108`, `controlledRegisterStore.ts:110,125`, `customerStore.ts:23-26` |
| SEC-13 | HIGH | Frontend auth gates are not a security boundary; 4300 calls send no credentials | `src/components/Auth/RequireAuth.tsx:4-12`, `src/api/**` |
| SEC-14 | MEDIUM | SSRF via operator-configured RSD endpoints | `server/src/rsd/settings.ts:190-250`, `rsd/service.ts:569-602` |
| SEC-15 | MEDIUM | Excessive data exposure (cost price, VAT/CR/GLN, signed XML, staff data) | `server/src/routes/items.ts:143-169`, `branches.ts:44-51`, `invoices.ts:16-23` |
| SEC-16 | MEDIUM | Raw internal error strings returned to clients | Multiple route `catch` blocks, e.g. `sales.ts:268`, `branches.ts:50` |
| SEC-17 | MEDIUM | Wildcard CORS, no security headers, no rate limiting | `server/src/index.ts:28-29` |
| SEC-18 | MEDIUM | Unrestricted resource consumption (imports, unbounded lists) | `server/src/items/import.ts:14,61-80`, `rsd/service.ts:497-511` |
| SEC-19 | MEDIUM | TLS encryption configured but certificate validation disabled | `server/.env:48,64` (redacted), `.env.example:82` |
| SEC-20 | MEDIUM | Cleartext live credentials in local `.env`; incomplete ignore rules | `server/.env` (gitignored), root `.gitignore`, `server/.gitignore:3` |
| SEC-21 | MEDIUM | No IaC/cloud/network/TLS termination configuration in repo | Repository root and `server/` (absence) |
| SEC-22 | MEDIUM | No encrypted backup / restore evidence | `server/README.md:77-105`, no `BACKUP`/`RESTORE` scripts |
| SEC-23 | MEDIUM | No monitoring, alerting, CI secret scan or dependency audit gate | `package.json:6-15`, no workflows |
| SEC-24 | MEDIUM | No Content Security Policy | `index.html:1-13`, `vite.config.ts:8-30` |
| SEC-25 | MEDIUM | Hardcoded plaintext `http://localhost` API defaults | `.env.development:1-2`, all `src/api/**` base URLs |
| SEC-26 | MEDIUM | Frontend-supplied identity/branch/company fields in payloads | `POSPage.tsx:480-484`, `salesApi.ts:9-14`, `rsdApi.ts:77-86` |
| SEC-27 | HIGH | Server dependency vulnerabilities: 8 advisories (6 high, 2 moderate) | `server/npm audit --omit=dev` |
| SEC-28 | LOW | Sandbox OTP constant shipped and auto-submitted | `ZatcaOnboardingPanel.tsx:19-24,142-149` |
| SEC-29 | LOW | Raw error objects logged to browser console | `IncentiveReportPage.tsx:33-35`, `POSPage.tsx:633` |
| SEC-30 | LOW | CSV formula injection in exports | `utils/controlledRegister.ts:87-90,118-134`, `utils/wasfaty.ts:341-344` |
| SEC-31 | LOW | Client-side spreadsheet parsing with no size/type limits | `ItemImportDialog.tsx:115-129,193-200` |
| SEC-32 | LOW | Admin-style DB account and elevated setup path documented as normal | `server/prisma/create-database.sql:1-4,14`, `.mdfile/branch.md` |
| SEC-33 | LOW | Process-local invoice lock; best-effort dual-DB consistency | `server/src/zatca/chain.ts:1-12`, `routes/items.ts:377-434` |
| SEC-34 | LOW | Plaintext HTTP allowed for SFDA test credentials | `server/src/rsd/README.md:80-85`, `rsd/service.ts:118-128` |
| SEC-35 | INFORMATIONAL | CDN-hosted `xlsx` dependency / supply-chain provenance | `package.json:26`, `package-lock.json` |

Positive controls are listed in section 12.

---

## 3. Detailed findings

### SEC-01 — CRITICAL — Entire Express API has no authentication
1. **Description:** No authentication middleware exists on any `/api/*` route; every read and write is reachable by any caller with network access to port 4300.
2. **Affected:** `server/src/index.ts:27-47` and all mounted routers.
3. **Evidence:**
   ```ts
   27: const app = express();
   28: app.use(cors());
   29: app.use(express.json({ limit: '2mb' }));
   32: app.use('/api/zatca/onboarding', onboardingRouter);
   ...
   47: app.use('/api/brands', brandsRouter);
   ```
   No `authenticate`, `req.user`, JWT verification or session middleware appears anywhere in `server/src`.
4. **Impact:** Unauthenticated sales/returns writes, stock manipulation, item-master import, ZATCA/RSD configuration changes and data disclosure. Identity attribution is impossible.
5. **Reproduction (authorized, descriptive):** On staging, call `GET http://<staging>:4300/api/branches` without any credential and observe HTTP 200. Confirm the same for a harmless read endpoint; do not exercise write endpoints against production data.
6. **Remediation:** Add deny-by-default authentication for all `/api/*`; validate JWT signature, `iss`, `aud`, `exp`, `nbf` and algorithm allow-list against the external issuer; populate `req.auth` from verified claims; keep `/health` minimal and public.
7. **Verification:** Automated route matrix: no token → 401; tampered/expired token → 401; valid token → allowed per role. Inspect middleware order in `index.ts`.

### SEC-02 — CRITICAL — No RBAC / function-level authorization
1. **Description:** Administrative operations have no role checks: branch master edits, ZATCA environment/mode/CSID changes, RSD settings and mock controls, commission rules, and bulk item imports.
2. **Affected:** `routes/branches.ts:54-94`, `routes/onboarding.ts:30-100`, `routes/rsd.ts:122-156`, `routes/incentives.ts:145-257,347-374`, `routes/items.ts:193-467`, `routes/brands.ts:29-66`, `routes/units.ts:20-57`, `routes/locations.ts:27-64`.
3. **Evidence:** `branches.ts:72-74` patches any branch by `req.params.id` with no role check; `onboarding.ts:55-62` accepts `POST /mode`; `rsd.ts:122-124` accepts `PUT /settings` storing credentials.
4. **Impact:** Any caller can perform head-office actions — privilege escalation and regulatory/financial misuse.
5. **Reproduction (authorized, descriptive):** With a cashier-role staging account, attempt a harmless test seller-name change under `/api/zatca/onboarding/settings` in an isolated DB; observe success before remediation.
6. **Remediation:** Introduce claim-based roles (`cashier`, `pharmacist`, `inventory_manager`, `admin`), enforce per route, require admin plus dual control for environment/mode/secret changes, deny by default, and audit every privileged action.
7. **Verification:** Role/endpoint matrix tests for anonymous, cashier, manager and admin; confirm admin-only actions emit immutable audit records.

### SEC-03 — HIGH — Broken object-level authorization on sales returns
1. **Description:** Return handlers scope the batch-restock lookup to the terminal branch but update the original sale and sale lines by client-supplied IDs without branch scoping or remaining-quantity validation.
2. **Affected:** `server/src/routes/sales.ts:206-213`, `232-264`.
3. **Evidence:**
   ```ts
   208: id: { in: body.lines.map((l) => l.saleLineId) },
   210: sale: { branchId: terminalBranch.id },   // only the restock lookup
   252: prisma.sale.update({ where: { id: body.originalInvoiceId }, ... })
   261: body.updatedLineReturnedQtys.map((l) =>
   262:   prisma.saleLine.update({ where: { id: l.lineId }, ... })
   ```
4. **Impact:** A terminal can alter another branch's sale status, points, incentives and returned quantities, and inflate its own stock by claiming arbitrary return quantities.
5. **Reproduction (authorized, descriptive):** In isolated staging with two branch configs, note a sale ID on terminal A; from terminal B post `POST /api/sales/returns` with that ID and a new test `returnNo`; inspect DB rows.
6. **Remediation:** Fetch the sale with `where: { id, branchId: terminalBranch.id }`; reject with 404/403 if absent; validate every return line against remaining returnable quantity; require idempotency; use a single transaction with row locking.
7. **Verification:** Cross-branch ID must be rejected and leave both branches unchanged; same-branch return must update exactly once; replayed idempotency key must be a no-op.

### SEC-04 — HIGH — Client-controlled sale values accepted verbatim
1. **Description:** Sale backup accepts totals, VAT, status, cashier name, points and line quantities directly from the request body.
2. **Affected:** `server/src/routes/sales.ts:76-171` (especially `92`, `106-118`).
3. **Evidence:**
   ```ts
   92: qtyOnHand: { decrement: l.qty }
   106: subtotalExclVat: body.subtotalExclVat
   109: totalInclVat: body.totalInclVat
   113: status: body.status
   114: cashierName: body.cashierName
   ```
4. **Impact:** Fabricated sales, arbitrary totals/points, negative quantities increasing stock, forged cashier identity and broken non-repudiation.
5. **Reproduction (authorized, descriptive):** In isolated staging POST a small sale JSON with `qty: -1` and inconsistent totals; inspect `sales`, `sale_lines`, `batches`.
6. **Remediation:** Strict schema validation; reject non-positive/non-finite quantities; recompute totals/VAT/discounts server-side; derive cashier/branch from token; allow-list status transitions; idempotency on `invoiceNo + branch`.
7. **Verification:** Tests assert rejection of negative qty, mismatched totals, unknown status and forged cashier; stored `cashierName` always equals token subject.

### SEC-05 — HIGH — Receiving/purchase stock writes unauthenticated and unvalidated
1. **Description:** `POST /api/receiving` upserts item masters and increments/decrements batch stock from unvalidated body fields; `/reverse` is replayable.
2. **Affected:** `server/src/routes/receiving.ts:34-111`.
3. **Evidence:** `body.qty`, `body.barcode`, `body.basePrice` accepted; `64: qtyOnHand: { increment: body.qty }`; `104: Math.max(0, existing.qtyOnHand - body.qty)`.
4. **Impact:** Any caller can create items and add/remove stock; negative qty reverses the direction of the change.
5. **Reproduction (authorized, descriptive):** In isolated staging POST `/api/receiving` with a new test item ID and `qty: -5`; inspect `batches.qtyOnHand`.
6. **Remediation:** Require auth + inventory-manager role; validate `qty > 0`, dates, prices, item identity; transactional increments; idempotency on `(branchId, itemId, batchNo, documentNo)`; audit actor.
7. **Verification:** Negative/zero/non-numeric qty and duplicate document numbers are rejected; stock changes exactly once.

### SEC-06 — HIGH — Cross-branch inventory disclosure
1. **Description:** `/api/stock/other-branches` intentionally returns other branches' stock identities and quantities for any item, with no company filter.
2. **Affected:** `server/src/routes/stock.ts:11-53`; ERP variant `routes/erp.ts:60-66`.
3. **Evidence:**
   ```ts
   21: where: { itemId, branchId: { not: terminalBranch.id }, qtyOnHand: { gt: 0 } }
   43: branchId: t.branchId, 45: nameEn: ..., 47: qtyOnHand: ...
   ```
4. **Impact:** Other-branch commercial stock data disclosed to any caller; becomes cross-company leakage if legal entities share the server.
5. **Reproduction (authorized, descriptive):** From staging terminal A call `GET /api/stock/other-branches?itemId=<test-item>` and confirm B's branch identity and quantity.
6. **Remediation:** Apply explicit same-company-only policy, role-gate, return approximations if exact quantities are unnecessary, and scope by token-derived `companyId`.
7. **Verification:** Cross-company query returns 403/empty; same-company query allowed only for approved roles.

### SEC-07 — HIGH — No company/tenant dimension; branch from editable local file
1. **Description:** Neither Prisma schema has a company/tenant key, and branch scoping depends on a gitignored local `config/branch.json`.
2. **Affected:** `server/prisma/schema.prisma`, `server/prisma/dotnet-pos-schema.prisma`, `server/src/branch.ts:8-51`, `routes/context.ts:25-40`, `routes/branches.ts:44-94`.
3. **Evidence:** Grep for `CompanyId|TenantId|OrganizationId` in `server/prisma/**/*.prisma` → no matches. `branch.ts:8` reads `config/branch.json`; `branch.ts:51` exports `terminalBranch` with a fallback branch ID.
4. **Impact:** No enforceable ERP-style company/branch isolation; changing a local file changes which branch's data is read/written.
5. **Reproduction (authorized, descriptive):** With two staging terminals using different `branch.json` values, show that the server has no token-derived tenant identity and that file edits alone change data scoping.
6. **Remediation:** Add `CompanyId` to every tenant-owned table and token; derive keys from verified identity; use composite scoping or SQL Server RLS; scope every query; audit cross-tenant attempts.
7. **Verification:** Two-tenant automated suite: every endpoint returns only token-matching rows; changing local config must not change authorization.

### SEC-08 — HIGH — Commission ledger trusts client-supplied record IDs
1. **Description:** `posItemId`/`posSaleId` from the client are used to update commission rows in the legacy `.NET` database, with a code comment explicitly trusting them.
2. **Affected:** `server/src/routes/incentives.ts:272-374`, `145-257`.
3. **Evidence:**
   ```ts
   314: const specifiedId = parsePositiveId(String(line.posItemId ?? ''));
   315-318: // "posItemId comes from the original sale line, so trust it directly"
   323-328: dotnetPos.posItem.update({ where: { id: posItem.id }, data: { commissionAmount: ... } })
   ```
4. **Impact:** False payouts or clawbacks by altering unrelated invoices' commission rows; rate rules set by anyone.
5. **Reproduction (authorized, descriptive):** In an isolated `dotnet_pos` staging DB, include another invoice's `posItemId` in an authorized commission request; inspect the unrelated row.
6. **Remediation:** Resolve targets through verified invoice + item + branch; validate rate bounds; require finance role; transaction + audit log.
7. **Verification:** Foreign `posItemId` rejected; target row unchanged; rate/role limits enforced.

### SEC-09 — HIGH — Plaintext CSID private key and RSD password on disk
1. **Description:** ZATCA CSID secret, certificate and private key are written unencrypted to a local JSON file; RSD credentials are written to another JSON file. Source itself labels this "DEV-GRADE ONLY".
2. **Affected:** `server/src/store/secureStore.ts:1-25,75-78`, `rsd/settings.ts:1-10,246-249`, `store/invoiceArchive.ts`.
3. **Evidence:**
   ```ts
   4: // DEV-GRADE ONLY - this is plaintext-on-disk storage...
   16: const FILE = path.join(DATA_DIR, 'zatca-state.json');
   21: secret: string; 22: certificatePem: string; 23: privateKeyPem: string;
   ```
4. **Impact:** File compromise lets an attacker forge invoices under the business's VAT registration and submit SFDA movements.
5. **Reproduction (authorized, descriptive):** On staging, inspect existence and NTFS ACLs of `server/data/zatca-state.json` and `rsd-settings.json` using key names only; confirm via unauthenticated API that identity/config writes are currently possible.
6. **Remediation:** Move secrets to KMS/HSM or encrypted-at-rest store with strict ACLs and audit; rotate any credential ever stored in plaintext; require admin + dual control for identity changes.
7. **Verification:** No plaintext private key/password on disk in staging; unauthorized config writes return 401/403. **Status:** encryption/fail-closed/plaintext-absence implemented and unit-tested in §16; per-decryption key-usage audit and staging ACL check remain open.

### SEC-10 — HIGH — Live ZATCA/RSD submission and mode endpoints unauthenticated
1. **Description:** Invoice submission, environment/mode switching, production CSID requests and RSD sales/mock controls require no credential.
2. **Affected:** `routes/invoices.ts:25-41`, `onboarding.ts:42-100`, `rsd.ts:50-65,98-156`.
3. **Evidence:** `invoices.ts:25` `post('/')` → `submitSaleInvoice(parsed.value)`; `onboarding.ts:55-62` `POST /mode`; `rsd.ts:50-52` `POST /sales`; `rsd.ts:149-152` `POST /mock/reset`.
4. **Impact:** Real legal/fiscal consequences: signed invoices under the real VAT identity and SFDA track-and-trace movements triggered by anyone who reaches port 4300.
5. **Reproduction (authorized, descriptive):** In a staging instance kept in mock mode, confirm status endpoints are anonymous; do not attempt live submission. After remediation, confirm anonymous/cashier requests are rejected.
6. **Remediation:** Authenticate and authorize all such endpoints; admin + explicit confirmation for mode/environment/production/mock routes; disable mock routes in production profile; rate-limit, allow-list destinations and audit.
7. **Verification:** Anonymous and cashier tokens receive 403; admin action creates immutable audit record; mock routes return 404 in production profile.

### SEC-11 — HIGH — JWT bearer token persisted in browser localStorage
1. **Description:** The full cashier session, including bearer token, is persisted by Zustand under `pharmacy-auth` in localStorage.
2. **Affected:** `src/store/authStore.ts:11-19`, `src/types/auth.ts:2`, `src/api/posApi.ts:12-17`, `e2e/fixtures.ts:34-37`.
3. **Evidence:**
   ```ts
   persist(..., { name: 'pharmacy-auth' })
   ...(token ? { Authorization: `Bearer ${token}` } : {})
   ```
4. **Impact:** Any XSS, malicious extension or shared unlocked kiosk can read and replay the token against the .NET POS API; logout only clears local state (`authStore.ts:16`), with no server-side revocation from the client.
5. **Reproduction (authorized, descriptive):** Log in on staging, inspect `localStorage['pharmacy-auth']`, observe token; use a copy in an authorized replay test after logout.
6. **Remediation:** Use `HttpOnly; Secure; SameSite=Strict` cookies via a backend-for-frontend, or in-memory tokens with secure refresh; implement server-side revocation/deny-list, rotation and short TTL.
7. **Verification:** No credential material in any browser storage; harvested token rejected after logout; cookie flags verified with `curl -i`.

### SEC-12 — HIGH — Raw patient/customer PHI persisted in localStorage
1. **Description:** Prescriptions, controlled-drug register, customers and queues persist raw national IDs and patient/staff names in browser storage; UI masking does not remove the raw values.
2. **Affected:** `prescriptionStore.ts:27-30,107-108`, `controlledRegisterStore.ts:94-125`, `customerStore.ts:23-26,65`, `salesStore.ts:93,233`, `pendingSyncStore.ts:65,98`, `rsdOutboxStore.ts:186-187,315-319`.
3. **Evidence:** `patientNationalId` in `types/prescriptions.ts:77`; `controlledRegisterStore.ts:110` copies it into persisted register; `pharmacy-prescriptions` / `pharmacy-controlled-register` persist keys.
4. **Impact:** Unbounded plaintext PHI archive on shared pharmacy terminals; likely PDPL/SFDA record-keeping issue and high-value XSS target.
5. **Reproduction (authorized, descriptive):** On a staging terminal inspect the listed localStorage keys; confirm unmasked national IDs are present even where UI masks them.
6. **Remediation:** Make server authoritative for PHI; keep only minimal short-lived cache; if offline storage is required, encrypt at rest with a key outside the origin, bound retention, wipe on logout/user switch, and enforce OS account separation.
7. **Verification:** Inventory all `persist(` stores; confirm no unmasked national ID/prescription note after a normal sale; confirm logout clears PHI keys and server audit holds the record.

### SEC-13 — HIGH — Frontend auth gates are not a security boundary; 4300 calls send no credentials
1. **Description:** `RequireAuth`/`DrawerGate` only react to local session state, and the E2E fixture proves an arbitrary `isAdmin: true` session can be injected. All `src/api/**` helpers for port 4300 send no authentication header.
2. **Affected:** `RequireAuth.tsx:4-12`, `DrawerGate.tsx:10-45`, `e2e/fixtures.ts:13-19,34-37`, `src/api/branchApi.ts:8-15`, `masterRequest.ts:13-21`, `salesApi.ts:9-14`, `rsdApi.ts:32-62,139-169`, `zatcaApi.ts:43-52,217-229`.
3. **Evidence:**
   ```ts
   if (!session) return <Navigate to="/login" ... />;
   TEST_SESSION = { token: 'e2e-token', ..., isAdmin: true };
   localStorage.setItem('pharmacy-auth', JSON.stringify({ state: { session }, version: 0 }));
   ```
   `App.tsx:47-193` starts sync effects outside the auth route wrapper.
4. **Impact:** Gated screens render for forged local sessions; privileged APIs accept unauthenticated calls. Frontend permissions are wrongly treated as the boundary.
5. **Reproduction (authorized, descriptive):** Inject a benign forged session in a staging browser and reload; observe UI access. Separately `curl` a 4300 endpoint with no credentials.
6. **Remediation:** Keep gates as UX only; enforce auth/role/branch on every server endpoint; derive roles from validated tokens; move boot-time sync behind an authenticated session; add a shared authenticated fetch wrapper.
7. **Verification:** Forged session still renders UI but every read/write returns 401/403; grep production code for `isAdmin` decision branches (should be none).

### SEC-14 — MEDIUM — SSRF via operator-configured RSD endpoints
1. **Description:** RSD settings accept arbitrary URLs; production requires `https://` but no host allow-list or private-IP blocking exists, and Basic credentials are attached to those URLs.
2. **Affected:** `server/src/rsd/settings.ts:190-250`, `rsd/config.ts:77-116`, `rsd/service.ts:569-602`, `rsd/soapClient.ts:54-120`.
3. **Evidence:** `saleUrl: clean(raw.saleUrl, ...)`, `cancelUrl: clean(raw.cancelUrl, ...)`; `Authorization: basicAuth(creds)` at `soapClient.ts:70`.
4. **Impact:** Credential leakage and internal network probing from the POS server.
5. **Reproduction (authorized, descriptive):** In isolated staging with an authorized admin account, point a test URL at a controlled listener and call `POST /api/rsd/test`.
6. **Remediation:** Allow-list SFDA hosts/domains; resolve and reject private/link-local/loopback addresses; never attach credentials to non-allow-listed hosts; log changes.
7. **Verification:** Attempt `127.0.0.1`, `169.254.169.254` and arbitrary hosts; all must be rejected; valid SFDA URL accepted.

### SEC-15 — MEDIUM — Excessive data exposure
1. **Description:** Responses include cost price, branch VAT/CR/GLN identifiers, complete signed invoice XML/QR/raw responses, ERP service identity and all cashiers' commission data.
2. **Affected:** `routes/items.ts:143-169`, `branches.ts:44-51`, `invoices.ts:16-23`, `store/invoiceArchive.ts:98-105`, `erp.ts:20-27`, `incentives.ts:378-447`, `context.ts:35-40`, `stock.ts:37-53`.
3. **Evidence:** `costPrice: row.costPrice?.toNumber()` in every item response; branch `findMany` returns whole rows; archived invoice endpoint returns `signedXml`/`qrBase64`/raw response.
4. **Impact:** Leakage of purchase-cost strategy, tax identifiers, legally significant document contents and staff performance/pay data.
5. **Reproduction (authorized, descriptive):** With a cashier-role staging token, call the listed read endpoints and record restricted fields present.
6. **Remediation:** Role-based response projections; remove cost price for cashier role; invoice summaries by default with audited full-document permission; scope commission reports by branch/role.
7. **Verification:** Schema-driven response tests assert absent fields for low-privilege roles and presence for authorized roles.

### SEC-16 — MEDIUM — Raw internal error strings returned to clients
1. **Description:** Many handlers return `String(err)` in JSON and use misleading 502 status codes for client-side failures.
2. **Affected:** `branches.ts:50,68,92`, `sales.ts:170,268`, `receiving.ts:88,109`, `stock.ts:55`, `items.ts:189,465-466`, `onboarding.ts:16,26,38,51,64,78,86,99`, `invoices.ts:39`, `masterHelpers.ts:69-83`.
3. **Evidence:** `branches.ts:50` → `{ error: String(err) }`; `sales.ts:268` → `res.status(502).json({ error: String(err) })`.
4. **Impact:** Prisma/SQL error strings reveal schema, constraints, paths and upstream details; incorrect status codes impair monitoring.
5. **Reproduction (authorized, descriptive):** Send malformed staging requests and inspect response bodies for SQL/Prisma/path fragments.
6. **Remediation:** Log full errors server-side with correlation IDs; return generic stable codes/messages; use correct 400/401/403/404/409/422/500/502/503 mapping.
7. **Verification:** Fuzz malformed requests; assert no internal detail in responses and correct status codes.

### SEC-17 — MEDIUM — Wildcard CORS, no security headers, no rate limiting
1. **Description:** `cors()` defaults to any origin; no `helmet`, CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, or request throttling exists.
2. **Affected:** `server/src/index.ts:28-29`; `server/package.json:19-25` (no security middleware dependencies).
3. **Evidence:** `app.use(cors())`; `app.use(express.json({ limit: '2mb' }))`; no `helmet` or rate-limit import.
4. **Impact:** Cross-origin driving of the API once cookies are introduced; increased XSS/clickjacking/MIME-sniffing exposure; brute force and resource exhaustion.
5. **Reproduction (authorized, descriptive):** From staging, inspect `Access-Control-Allow-Origin` on a cross-origin preflight and response header set.
6. **Remediation:** Explicit origin allow-list; `helmet` with CSP/HSTS; per-IP and per-account rate limits with tighter limits on auth/config/submission; size and timeout limits per route.
7. **Verification:** Disallowed origin rejected; expected headers present; 429 after threshold.

### SEC-18 — MEDIUM — Unrestricted resource consumption
1. **Description:** A 2 MB body can contain up to 1000 items × 10 alias barcodes, triggering many per-row writes across two databases; some list endpoints accept unbounded `limit` or no pagination.
2. **Affected:** `server/src/items/import.ts:14,61-80,158-179`, `routes/items.ts:66-115,193-467`, `rsd/service.ts:497-511`, `incentives.ts:404`, `wasfaty/service.ts:205-270`.
3. **Evidence:** `MAX_ROWS = 1000`; chunked `Prisma.join` plus individual `DELETE`/`INSERT` loops; `limit = filter.limit && filter.limit > 0 ? filter.limit : matching.length`.
4. **Impact:** Event-loop and database saturation on the cashier hot path; sync delays.
5. **Reproduction (authorized, descriptive):** In isolated staging compare timings/memory of a maximum import and an unbounded `GET /api/rsd/records` against small requests.
6. **Remediation:** Rate-limit imports; cap rows/aliases; bulk `createMany`/set-based SQL in transactions; maximum page sizes with defaults; timeouts and circuit breakers.
7. **Verification:** Load test with authorized credentials; confirm pagination caps and 429 behaviour.

### SEC-19 — MEDIUM — TLS encryption configured but certificate validation disabled
1. **Description:** Primary SQL connection uses `encrypt=true` together with `trustServerCertificate=true`; second connection also sets `trustServerCertificate=true` without explicit `encrypt`.
2. **Affected:** `server/.env:48,64` (values redacted), `server/.env.example:82`, `.mdfile/branch.md:91-92`, both Prisma datasources.
3. **Evidence (redacted):** Connection-string flags only: `encrypt=true;trustServerCertificate=true`.
4. **Impact:** On-path attacker can impersonate SQL Server, capture credentials and alter sales/inventory despite "encryption".
5. **Reproduction (authorized, descriptive):** Parse only flags from staging config; check SQL Server `Force Encryption` and certificate chain; do not print secret values.
6. **Remediation:** `encrypt=true;trustServerCertificate=false`; trust internal CA on every client; TLS 1.2+; `Force Encryption` on server; remove `trustServerCertificate=true` from docs/examples.
7. **Verification:** Connection fails against untrusted certificate; succeeds with pinned corporate CA; SQL protocol settings reviewed.

### SEC-20 — MEDIUM — Cleartext live credentials in local `.env`; incomplete ignore rules
1. **Description:** Gitignored `server/.env` contains real-looking SQL, ERP and RSD credentials in cleartext, including a commented connection string with an embedded admin-style login. Root `.gitignore` has no general `.env` rule.
2. **Affected:** `server/.env` (gitignored, never tracked), `server/.gitignore:3`, root `.gitignore:1-37`, `.env.development:1-2`.
3. **Evidence (redacted):** `git check-ignore -v server/.env` → `server/.gitignore:3:.env`; `git ls-files server/.env` → empty; `git check-ignore --no-index .env .env.production server/.env.production` → not ignored. Key names only were inspected; no values reproduced.
4. **Impact:** Laptop backup, support session or accidental copy exposes SQL and SFDA credentials. Future root/production env files can be committed unnoticed.
5. **Reproduction (authorized, descriptive):** Run the ignore commands above on staging; list key names only; compare hashes rather than displaying values.
6. **Remediation:** Rotate every credential in that file; delete the commented connection string; move secrets to a secret manager; restrict file ACLs; add `server/.env` pre-commit secret scanning.
7. **Verification:** No secret value in Git history or workspace files; secret scanner clean; rotation evidence recorded.

### SEC-21 — MEDIUM — No IaC/cloud/network/TLS termination configuration in repo
1. **Description:** No Dockerfile, compose, Terraform/BiceP/ARM, CI workflow, reverse-proxy config, Kubernetes/Helm manifest or deployment script exists.
2. **Affected:** Repository root and `server/` (absence).
3. **Evidence:** `git ls-files` contains no infrastructure manifests; only application-level HTTP in `index.ts:49-50` and `.env.development:1-2`.
4. **Impact:** Network exposure, TLS termination, WAF/DDoS, admin access and secret management cannot be reviewed or reproduced.
5. **Reproduction (authorized, descriptive):** File-presence checks; request platform config and firewall rules from infrastructure owner.
6. **Remediation:** Introduce IaC defining private subnets, restricted firewall rules, TLS with modern ciphers, WAF/DDoS where internet-facing, managed identities and audited JIT/bastion admin access.
7. **Verification:** IaC reviewed in CI; staging network scan from authorized segments; TLS scan passes.

### SEC-22 — MEDIUM — No encrypted backup / restore evidence
1. **Description:** SQL persistence is described as a "best-effort backup" of localStorage; no backup/restore scripts, encryption settings, retention policy or restore drill evidence exists in the repo.
2. **Affected:** `server/README.md:77-105`, `docs/multi-branch-setup.md:36-41`, tracked SQL files.
3. **Evidence:** Search for `BACKUP DATABASE` / `RESTORE DATABASE` found none; no `.bak` artifacts or job definitions.
4. **Impact:** Legally significant invoices may exist only in a browser profile until a best-effort write succeeds; workstation loss or ransomware can cause permanent loss.
5. **Reproduction (authorized, descriptive):** Search tracked files; request SQL Agent job history, backup encryption settings and last successful restore test from DBA.
6. **Remediation:** Automated encrypted backups (TDE + encrypted backups), off-site immutable copies, retention, RPO/RTO, scheduled restore drills and failure alerts; treat localStorage as cache only.
7. **Verification:** Restore drill succeeds from latest backup; encryption and retention settings documented.

### SEC-23 — MEDIUM — No monitoring, alerting, CI secret scan or dependency audit gate
1. **Description:** Only `console.log` at startup and raw errors on failure; no CI workflow, APM, secret scanning, SAST or dependency audit scripts.
2. **Affected:** `package.json:6-15`, `server/package.json:6-15`, `playwright.config.ts:13-14` (CI references but no workflow), repository (no `.github/workflows/`).
3. **Evidence:** No logging/APM packages; no workflow files; `npm audit` exists only as an ad-hoc command here.
4. **Impact:** Failed ZATCA/RSD submissions, DB outages and credential abuse may go unnoticed; secrets can be committed undetected.
5. **Reproduction (authorized, descriptive):** `git ls-files` and `npm run` inspection; check external CI system.
6. **Remediation:** CI pipeline with `npm ci`, both `npm audit` runs, secret scanning, lint/typecheck/unit/e2e, structured logging, metrics and alert rules; protect `main` with required checks.
7. **Verification:** Pipeline runs on every PR; alerts fire in a staging fault-injection test.

### SEC-24 — MEDIUM — No Content Security Policy
1. **Description:** No CSP meta tag or HTTP header configuration exists in app shell or server.
2. **Affected:** `index.html:1-13`, `vite.config.ts:8-30`, `server/src/**` (no CSP/helmet).
3. **Evidence:** Only `charset`, `icon`, `viewport`, `title` meta tags; no `Content-Security-Policy` string found.
4. **Impact:** No browser-side mitigation for injected script; combined with SEC-11/SEC-12, any XSS becomes full session and PHI compromise.
5. **Reproduction (authorized, descriptive):** Inspect response headers and `meta[http-equiv]`; inject a benign test script in staging DevTools and observe it executes.
6. **Remediation:** Strict CSP via HTTP header: `default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; connect-src 'self' https://<approved-api>; form-action 'self'`; relaxed dev policy for HMR.
7. **Verification:** Injected inline script blocked; no CSP violations during normal flows; `curl -I` shows header.

### SEC-25 — MEDIUM — Hardcoded plaintext `http://localhost` API defaults
1. **Description:** Production builds without `VITE_*` overrides silently target `http://localhost:4300` and `:5000`.
2. **Affected:** `.env.development:1-2`, `src/api/posApi.ts:9`, `branchApi.ts:6`, `catalogApi.ts:7`, `erpApi.ts:3`, `zatcaApi.ts:6`, `wasfatyApi.ts:22`, `rsdApi.ts:15`, `salesApi.ts:7`, `receivingApi.ts:5`, `incentiveApi.ts:3`, `itemImportApi.ts:6`, master APIs.
3. **Evidence:** `import.meta.env.VITE_POS_API_URL ?? 'http://localhost:5000'`; no `.env.production` in repo.
4. **Impact:** Broken production functionality or traffic to unintended local services; bearer tokens and PHI cross the network without TLS; mixed-content blocking on HTTPS hosting.
5. **Reproduction (authorized, descriptive):** Build without overrides and grep `dist/assets/*.js` for `http://localhost`; serve over HTTPS and observe mixed-content failures.
6. **Remediation:** Require both `VITE_*` URLs at production build time (fail build if absent); HTTPS only; TLS on both backends; HSTS at edge.
7. **Verification:** Production bundle contains only approved HTTPS origins; Network tab shows HTTPS for every API call.

### SEC-26 — MEDIUM — Frontend-supplied identity/branch/company fields in payloads
1. **Description:** `cashierName`, `updatedBy`, `createdBy`, `costCenterId`, pharmacist and RSD/ZATCA identity fields originate in editable client state and are posted to APIs.
2. **Affected:** `POSPage.tsx:480-484,489-503,562-577`, `CategoryMapPage.tsx:38,74-76`, `PrescriptionCaptureDialog.tsx:114,257`, `PurchaseInvoicePage.tsx:54,394`, `ReturnsPage.tsx:59,276`, `salesApi.ts:9-14`, `rsdApi.ts:77-86`, `zatcaApi.ts:158-172`.
3. **Evidence:** `cashierName: settings.cashierName`; `updatedBy: session?.fullName`; `createdBy: cashierName`.
4. **Impact:** Forged audit trails and, if servers trust these values, cross-branch authorization bypass.
5. **Reproduction (authorized, descriptive):** Change staging Settings → Cashier Name to another employee, complete a test sale, inspect `POST /api/sales` payload.
6. **Remediation:** Server derives user/company/branch/timestamp from authenticated principal and terminal configuration; ignore or override client values; audit with validated identity.
7. **Verification:** Replay captured requests with modified identity fields; server rejects or overwrites them and DB rows show authenticated identity.

### SEC-27 — HIGH — Server dependency vulnerabilities
1. **Description:** `npm audit --omit=dev` in `server/` reports 8 vulnerabilities: 6 high and 2 moderate.
2. **Affected:** `server/node_modules` via `body-parser <1.20.9`, `deepmerge-ts <8.0.0`, `effect <=3.22.0`, `js-yaml <=3.15.1`, `qs 6.7.0-6.16.0`, and transitive `prisma`/`xmlbuilder2` chains.
3. **Evidence:** Advisories `GHSA-27r3-jxmh-p828`, `GHSA-ggr8-5vv4-36mx`, `GHSA-7589-6fvf-x4pw`, `GHSA-mh29-5h37-fv8m`, `GHSA-6pq8-jhm2-2vcw` and related. Root `npm audit --omit=dev` reports 0.
4. **Impact:** DoS via compressed-body trailing bytes, ReDoS/stack exhaustion, prototype pollution and DoS in YAML/merge handling; some fixes require breaking upgrades (Prisma 7, xmlbuilder2 4).
5. **Reproduction (authorized, descriptive):** Run `npm audit --omit=dev` in `server/`; review advisory IDs; no exploitation attempted.
6. **Remediation:** Apply non-breaking fixes (`npm audit fix`) first; plan and test breaking upgrades (`deepmerge-ts`/`prisma`, `xmlbuilder2`) in a dedicated change with regression tests; add audit gate to CI.
7. **Verification:** Re-run audit in both workspaces; confirm 0 high/moderate outstanding or document time-bound exceptions with compensating controls.

### SEC-28 — LOW — Sandbox OTP constant shipped and auto-submitted
1. **Description:** A documented sandbox OTP value is hardcoded and prefilled into the ZATCA onboarding request.
2. **Affected:** `ZatcaOnboardingPanel.tsx:19-24,39,142-149`, `zatcaApi.ts:62-64`.
3. **Evidence:** `suggestedOtp: '123345'` and `POST .../compliance` with `{ otp }`.
4. **Impact:** Credential-shaped value in bundle; risk of reuse in simulation/production and false positives in secret scanning.
5. **Reproduction (authorized, descriptive):** Open `/zatca-setup` in sandbox mode and inspect the prefilled field; grep `dist` for the literal.
6. **Remediation:** Remove the constant; require manual entry; clear after use.
7. **Verification:** No OTP-like literal in built JS; field starts empty in all environments.

### SEC-29 — LOW — Raw error objects logged to browser console
1. **Description:** Several handlers `console.error(e)` objects built from raw API error bodies.
2. **Affected:** `IncentiveReportPage.tsx:33-35`, `POSPage.tsx:449,566,633`, `ReturnsPage.tsx:279,297`, `catalogStore.ts:355,418`, `salesStore.ts:135,167`, `posApi.ts:26-29`.
3. **Evidence:** `} catch (e) { console.error(e); }`.
4. **Impact:** If a backend echoes PII or SQL detail, it lands in consoles and retained Playwright traces.
5. **Reproduction (authorized, descriptive):** Force a staging mirror failure with a request containing a patient ID; inspect DevTools Console and trace output.
6. **Remediation:** Log stable codes/correlation IDs only; redact identifiers; gate verbose logging behind dev flag.
7. **Verification:** No PII or raw response bodies in console output or retained traces.

### SEC-30 — LOW — CSV formula injection in exports
1. **Description:** CSV quoting escapes `"` but not leading `=`, `+`, `-`, `@` or control characters.
2. **Affected:** `utils/controlledRegister.ts:87-90,118-134`, `utils/wasfaty.ts:341-344,375-376`, `IncentiveReportPage.tsx:42-62`, `WasfatyClaimsPage.tsx:144-152`, `ControlledRegisterPage.tsx:184-189`.
3. **Evidence:**
   ```ts
   return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
   ```
4. **Impact:** A malicious imported item/prescriber name beginning with `=HYPERLINK(...)` executes on CSV open in Excel. Requires victim action, hence LOW.
5. **Reproduction (authorized, descriptive):** Import an item named `=1+1` in isolated staging, sell it, export controlled-register CSV, open in Excel.
6. **Remediation:** Shared `csvCell` prefixes dangerous first characters with `'` and strips control characters; consider XLSX string-typed export.
7. **Verification:** Unit test `csvCell('=cmd|...')` returns non-executable string; spreadsheet opens without formula activation.

### SEC-31 — LOW — Client-side spreadsheet parsing with no size/type limits
1. **Description:** XLSX files are parsed in the renderer after `arrayBuffer()` with advisory `accept` only; no byte cap, MIME check, worker isolation or row cap.
2. **Affected:** `ItemImportDialog.tsx:115-129,193-200`, `WasfatyImportDialog.tsx:125-128`, `itemImportSample.ts:55-90`.
3. **Evidence:** `const XLSX = await import('xlsx'); XLSX.read(buffer, { type: 'array' })`.
4. **Impact:** Large/crafted workbook can freeze the till renderer. Installed `xlsx` is 0.20.3 from vendor CDN, above known prototype-pollution/ReDoS thresholds.
5. **Reproduction (authorized, descriptive):** Feed a large workbook to the staging file input and measure UI responsiveness.
6. **Remediation:** Enforce max size and MIME/extension validation before parsing; parse in a Web Worker with timeout; cap rows; prefer server-side parsing with limits.
7. **Verification:** Oversized/wrong-type files rejected before `arrayBuffer()`; UI responsive; row cap enforced.

### SEC-32 — LOW — Admin-style DB account and elevated setup path documented as normal
1. **Description:** DB creation instructions recommend a `sysadmin`/`dbcreator` account; docs name an administrator-style login and developer workstation; ERP uses one shared service account over plaintext HTTP.
2. **Affected:** `server/prisma/create-database.sql:1-4,14`, `.mdfile/branch.md:83,91,101,104,106,108,127`, `server/.env.example:51-55`, `server/src/erp/README.md:33-37`.
3. **Evidence (redacted):** "using an account with rights to create databases (e.g. sysadmin or dbcreator)"; demo numeric ERP login described as known-working.
4. **Impact:** Operators guided to high-privilege DB identity; no per-cashier ERP attribution; shared demo credential risk.
5. **Reproduction (authorized, descriptive):** Review cited lines with values redacted; inspect staging effective DB roles.
6. **Remediation:** Dedicated least-privilege SQL principal (`db_datareader`/`db_datawriter` + required execute); reserve `dbcreator` for one-time change-controlled migration; neutral placeholders in docs; named read-only ERP service account over HTTPS.
7. **Verification:** Staging role membership review; no `sysadmin` for app login; ERP account read-only and attributed.

### SEC-33 — LOW — Process-local invoice lock; best-effort dual-DB consistency
1. **Description:** ZATCA invoice-chain lock is a process-local promise; two-database import uses compensating writes with `rollbackErrors`.
2. **Affected:** `server/src/zatca/chain.ts:1-12`, `zatca/submitSaleInvoice.ts:112-116,166-187`, `routes/items.ts:377-434`.
3. **Evidence:** Comment states a multi-instance deployment must move the lock into the database.
4. **Impact:** Two instances can sign duplicate ICVs; failed compensation leaves catalogues inconsistent.
5. **Reproduction (authorized, descriptive):** Two-instance staging concurrency test with authorized credentials; describe duplicate ICV risk.
6. **Remediation:** DB-backed distributed lock / unique ICV constraint; single-writer signing service; transactional outbox or reconciliation job for dual-DB import.
7. **Verification:** Concurrent submissions produce unique ICVs; fault injection confirms eventual consistency.

### SEC-34 — LOW — Plaintext HTTP allowed for SFDA test credentials
1. **Description:** Test environment URLs may be plain HTTP; HTTPS is enforced only for production.
2. **Affected:** `server/src/rsd/README.md:80-85`, `rsd/service.ts:118-128`, `.mdfile/rsd.md:24-26`, `server/.env.example:112`.
3. **Evidence (redacted):** Guard requires `https://` only when `environment === 'production'`.
4. **Impact:** Basic-auth test password can be intercepted; risk amplified by password reuse.
5. **Reproduction (authorized, descriptive):** Review the guard and configured URLs on staging (URLs only).
6. **Remediation:** Enforce HTTPS for all environments or tunnel through trusted proxy/VPN; dedicated throwaway test password; block `http://` at settings-save time.
7. **Verification:** Saving an `http://` URL fails in every environment.

### SEC-35 — INFORMATIONAL — CDN-hosted `xlsx` dependency
1. **Description:** `xlsx` 0.20.3 is installed from `https://cdn.sheetjs.com/...tgz` with lockfile integrity rather than the npm registry.
2. **Affected:** `package.json:26`, `package-lock.json`.
3. **Evidence:** CDN tarball URL; version above known fixed thresholds; root `npm audit --omit=dev` reports 0.
4. **Impact:** Additional supply-chain/availability dependency; some scanners misreport it against obsolete npm ranges. No confirmed vulnerable version.
5. **Reproduction (authorized, descriptive):** Inspect manifest/lockfile resolved and integrity fields.
6. **Remediation:** Mirror tarball internally, record checksum, document scanner exception, generate SBOM.
7. **Verification:** Clean `npm ci` succeeds with expected integrity; SBOM reviewed.

---

## 4. OWASP Compliance Checklist (Deliverable 3)

| OWASP API Top 10 (2023) | Status | Evidence / note |
|---|---|---|
| API1 Broken Object Level Authorization | **FAIL** | SEC-03, SEC-08 |
| API2 Broken Authentication | **FAIL** | SEC-01, SEC-11, SEC-13 |
| API3 Broken Object Property Level Authorization | **FAIL** | SEC-04, SEC-05, SEC-15, SEC-26 (mass assignment / excessive exposure) |
| API4 Unrestricted Resource Consumption | **FAIL** | SEC-18, SEC-17, SEC-27 |
| API5 Broken Function Level Authorization | **FAIL** | SEC-02, SEC-10 |
| API6 Unrestricted Access to Sensitive Business Flows | **FAIL** | SEC-01, SEC-02, SEC-10 |
| API7 Server Side Request Forgery | **FAIL** | SEC-14 |
| API8 Security Misconfiguration | **FAIL** | SEC-17, SEC-19, SEC-20, SEC-21, SEC-24, SEC-25 |
| API9 Improper Inventory Management | **PARTIAL** | No API inventory/versioning/IaC found; endpoints enumerated from `index.ts:32-47` |
| API10 Unsafe Consumption of APIs | **PARTIAL** | ERP/RSD/ZATCA upstream calls exist; destination allow-listing and response validation not evidenced |

Positive: no SQL injection found in Prisma raw queries (see section 12).

---

## 5. API Security Report (Deliverable 4)

- **Endpoint inventory (from `server/src/index.ts:32-47`):** `/api/zatca/onboarding`, `/api/zatca/invoices`, `/api/incentives`, `/api/erp`, `/api/sales`, `/api/receiving`, `/api/wasfaty`, `/api/rsd`, `/api/branches`, `/api/context`, `/api/stock`, `/api/items`, `/api/item-categories`, `/api/units`, `/api/locations`, `/api/brands`, plus `/health`.
- **Authentication:** none on any of them (SEC-01).
- **Authorization:** none; admin and cashier functions indistinguishable (SEC-02).
- **SQL injection:** no `queryRawUnsafe`/`executeRawUnsafe`; raw queries use tagged templates and `Prisma.join` (`routes/items.ts:66-107,368-372`) — positive control.
- **Mass assignment:** sales, receiving, commission and master writes accept client bodies verbatim (SEC-04, SEC-05, SEC-08, SEC-26).
- **Error handling:** raw `String(err)` responses (SEC-16).
- **CORS/headers/rate limits:** wildcard CORS, no headers, no throttling (SEC-17).
- **Sensitive endpoints:** ZATCA/RSD configuration and submission must be treated as privileged; currently anonymous (SEC-10).

---

## 6. SQL Server Security Report (Deliverable 5)

| Check | Result |
|---|---|
| Connection string in source | Uses `env("DATABASE_URL")` / `env("DOTNET_POS_DATABASE_URL")` — correct (no literal secret in tracked code). |
| Local `.env` secrets | Real-looking credentials in cleartext, gitignored; rotate (SEC-20). |
| Encryption in transit | `encrypt=true` but `trustServerCertificate=true`; second connection lacks explicit `encrypt` (SEC-19). |
| Encryption at rest / TDE | Not evidenced in repo; staging verification required. |
| SQL injection | No unsafe raw SQL found (positive). |
| DB user least privilege | Not demonstrated; docs recommend admin-style setup account (SEC-32). |
| Network exposure | Cannot be determined from repo; must verify SQL Server is not publicly reachable. |
| Backup encryption/restore | No evidence (SEC-22). |
| Audit logging | Application-level audit fields exist (e.g. `updatedBy`) but are client-supplied (SEC-26); no DB audit spec found. |

**Mandatory staging checks:** effective SQL principal roles, firewall/NSG rules, `Force Encryption`, certificate chain, TDE/backups, and successful restore drill.

---

## 7. Cloud Infrastructure Security Checklist (Deliverable 6)

| Item | Status | Note |
|---|---|---|
| HTTPS enforcement | **FAIL / UNKNOWN** | App hardcodes HTTP localhost defaults (SEC-25); no proxy/TLS config in repo. |
| TLS configuration | **UNKNOWN** | No IaC or server TLS config; verify in staging. |
| Firewall rules / public ports | **UNKNOWN** | Express binds all interfaces (SEC-01); no firewall definition. |
| Database network access | **UNKNOWN** | Must confirm private-only access. |
| Cloud storage permissions | **UNKNOWN** | No cloud config in repo. |
| Secret management | **FAIL** | Plaintext `.env` and JSON secret files (SEC-09, SEC-20). |
| Environment variables | **PARTIAL** | Server secrets env-based (good); client `VITE_*` only URLs (positive). |
| Backup policies | **FAIL** | No evidence (SEC-22). |
| Monitoring/alerts | **FAIL** | No evidence (SEC-23). |
| DDoS protection | **UNKNOWN** | No config; rate limiting absent (SEC-17). |
| Administrative access | **UNKNOWN** | No JIT/bastion/MFA definition. |
| Deployment security | **FAIL** | No CI/CD or IaC (SEC-21, SEC-23). |
| Production debug settings | **PARTIAL** | No source maps (positive); `/health` leaks env and logs are verbose (SEC-16). |

---

## 8. Authentication and Authorization Test Results (Deliverable 7)

| Test | Static result | Required staging verification |
|---|---|---|
| Password storage/hashing | **Not in repo** (external .NET service) | Confirm algorithm/salt from external source or black-box policy tests. |
| Login security / lockout / rate limiting | No implementation in Express; external service unverified | Test failed-login backoff and lockout with authorized accounts. |
| JWT signature validation | Not performed by Express (SEC-01) | Verify signature, `iss`, `aud`, `exp`, `nbf`, algorithm allow-list. |
| Token expiration | Not enforced by Express | Decode staging token and test expired token rejection. |
| Refresh rotation/revocation | Not evidenced; logout only clears localStorage (SEC-11) | Test reuse detection and post-logout rejection. |
| MFA for privileged accounts | Not evidenced | Confirm at identity provider / external API. |
| RBAC | Absent in Express (SEC-02) | Role/endpoint matrix tests. |
| Function-level authorization | Absent (SEC-02, SEC-10) | Anonymous/cashier must receive 403 on admin routes. |
| Object-level authorization | Broken (SEC-03, SEC-08) | Cross-branch/cross-invoice negative tests. |
| Privilege escalation | Possible by direct API call (SEC-01/02) | Verify no client flag grants authority. |
| Password reset | Not in repo | Verify in external service. |
| Frontend as boundary | Explicitly not a boundary in design; must remain UX only (SEC-13) | Forged localStorage session test against deployed API. |

---

## 9. Company and Branch Isolation Test Results (Deliverable 8)

| Requirement | Static result | Required staging test |
|---|---|---|
| No access to another company's records | **FAIL** — no company key exists (SEC-07) | Two-tenant dataset, every endpoint scoped by token. |
| No unauthorized branch access | **FAIL** — branch from local file (SEC-07), sales updates unscoped (SEC-03) | Two branch configs; cross-branch IDs must be rejected. |
| Cannot read others' invoices | **FAIL** — no auth and no ownership filter (SEC-01, SEC-03) | Try reading another branch's sale/return; expect 403/404. |
| Cannot modify unauthorized inventory | **FAIL** — receiving unauthenticated (SEC-05) | Cross-branch batch update attempt must leave rows unchanged. |
| Cannot access financial transactions outside permissions | **FAIL** — commission/incentive data open (SEC-08, SEC-15) | Role-scoped report tests. |
| API bypass of frontend restrictions | **FAIL** (SEC-01, SEC-13) | Direct `curl` with no token must return 401. |
| Never trust client CompanyId/BranchId/UserId/permissions | **PARTIAL** — branch for new rows is server-derived, but updates and identity fields are not (SEC-03, SEC-26) | Replay modified payloads; server must override/reject. |

**Conclusion:** Company/branch isolation **cannot currently be asserted**. This is a production blocker.

---

## 10. Remediation Plan (Deliverable 9)

### Phase 0 — Immediate containment (before any further staging use)
- Restrict port 4300 to localhost/VPN only; disable all mock/config/submission endpoints in non-dev profiles.
- Rotate SQL, ERP, RSD and any ZATCA credentials that have existed in plaintext files.
- Remove the commented admin connection string from local `.env`; restrict file ACLs.

### Phase 1 — CRITICAL (fix first)
- SEC-01: deny-by-default authentication for every `/api/*` route.
- SEC-02: claim-based RBAC and admin-only privileged routes with audit.

### Phase 2 — HIGH
- SEC-03/04/05: object-level scoping, server-side recomputation and validation for sales, returns and receiving.
- SEC-06/07: tenant keys, token-derived company/branch, scoped queries or RLS.
- SEC-08: stop trusting client record IDs in commission ledger.
- SEC-09/10: KMS/HSM secret storage; authenticate and lock down ZATCA/RSD endpoints.
- SEC-11/12: remove persisted token/PHI from localStorage; secure cookie or in-memory session; server-authoritative PHI.
- SEC-13: server-side enforcement for every frontend-gated action; authenticated API wrapper.
- SEC-27: patch server dependencies with regression tests.

### Phase 3 — MEDIUM
- SEC-14–18: SSRF allow-list, response projections, error sanitization, security headers/CORS/rate limiting, pagination and resource caps.
- SEC-19–25: TLS certificate validation, secret manager, general `.env` ignore rules, IaC, backups, monitoring/CI, CSP, HTTPS-only URLs.
- SEC-26: derive identity fields server-side.

### Phase 4 — LOW / hardening
- SEC-28–34: remove OTP literal, redact logs, neutralize CSV formulas, bound imports, least-privilege docs, distributed lock, HTTPS for SFDA test.

### Automation to add with each fix
- Security regression tests for the specific vulnerability (negative authz, forged identity, invalid quantities, SSRF URLs, restricted fields).
- CI gates: `npm audit` in both workspaces, secret scan, lint/typecheck/unit/e2e.
- Retest and document evidence before closing each item.

---

## 11. Final Production Readiness Report (Deliverable 10)

| Acceptance criterion | Status |
|---|---|
| Critical vulnerabilities unresolved | **FAIL** — SEC-01, SEC-02 |
| High-risk vulnerabilities without approved mitigation | **FAIL** — SEC-03–SEC-13, SEC-27 |
| Company or branch isolation bypassable | **FAIL** — SEC-03, SEC-07 |
| Unauthorized users can execute privileged operations | **FAIL** — SEC-01, SEC-02, SEC-10 |
| Database credentials exposed | **FAIL** — SEC-20 (cleartext local file), SEC-19 (TLS trust disabled) |
| SQL Server publicly exposed without approved architecture | **UNKNOWN** — no infra config; must verify in staging |
| Backups cannot be successfully restored | **UNKNOWN / FAIL** — no evidence (SEC-22) |
| Security testing results verified | **FAIL** — static assessment only; no dynamic verification |

**Decision:** **DO NOT DEPLOY TO PRODUCTION.** Reassess after Phase 1–2 remediation and staging verification. Continuous monitoring and periodic reassessment remain mandatory; no system can be declared 100% secure.

---

## 12. Positive controls and limitations

### Verified positive controls
- **No SQL injection** found in Prisma raw queries; all use tagged templates and `Prisma.join` (`routes/items.ts:66-107,368-372`).
- **No dangerous HTML sinks** (`dangerouslySetInnerHTML`, `innerHTML`, `eval`, `document.write`, `iframe`) found in `src/**` or `e2e/**`.
- **No production source maps** configured (`vite.config.ts:8-30`, tsconfigs `noEmit: true`).
- **No secrets committed to Git**: `server/.env` is ignored and never tracked; `.env.example` uses placeholders; tracked `.env.development` contains only two localhost URLs.
- **Server-side secrets not returned to client**: RSD returns only `credentialsConfigured`; ZATCA returns CSID summaries, not private keys.
- **Root dependency audit clean**: `npm audit --omit=dev` at repository root → 0 vulnerabilities.
- **Branch binding for new sales/batches** is server-derived (`sales.ts:100,236`, `receiving.ts:74`); the defect is in updates/scoping, not initial creation.
- **ERP integration headers** are server-derived from `getErpSession()` (`erpClient.ts:17-31`), not client-overridable.

### Not verified / requires staging
- External ASP.NET Core source: password hashing, lockout, JWT signing/expiry, refresh rotation, MFA, password reset.
- Live network exposure, firewall rules, TLS termination, SQL Server public reachability.
- Actual SQL principal privileges, TDE, backup encryption and successful restore.
- Runtime dependency CVEs beyond `npm audit` output; SBOM/SCA not available here.
- Browser-side exploitability of XSS/CSP and CSV formula behaviour.
- Physical/kiosk controls, OS account separation and auto-logout.

### Tools used
`npm audit --omit=dev` (root and server), `git check-ignore`, `git ls-files`, targeted `grep`, source line inspection. `OWASP ZAP`, `Burp Suite`, `SonarQube`, `Trivy` were unavailable; no active scanning or penetration testing was performed.

---

**End of initial assessment. No application code was modified during that assessment.**

---

## 13. Remediation status — Phase 0 + CRITICAL (2026-11-27)

Owner approval was given for **Phase 0 containment + CRITICAL findings only**, with JWT identity
sourced from the external dotnet-pos token (env-driven validation) and tenant columns deferred.

### 13.1 Implemented

| Finding | Change | Evidence |
|---|---|---|
| SEC-01 | Deny-by-default `requireAuth` mounted on `/api/*` before every router; `/health` remains public. | `server/src/index.ts:27-47`, `server/src/auth/middleware.ts` |
| SEC-02 | `requireAdmin` function-level guard on branch/ZATCA/RSD/commission/masters writes and item import. Sale reporting mirrors stay authenticated only so ERP sale flow is unchanged. | `server/src/routes/{branches,onboarding,rsd,incentives,items,brands,units,locations,itemCategories}.ts` |
| SEC-01 (clients) | All 15 `:4300` API modules now attach `Authorization: Bearer <token>` via one helper. | `src/api/authHeaders.ts`, `src/api/*.ts` |
| SEC-13 | Boot-time sync effects wait for an authenticated session instead of issuing anonymous requests. | `src/App.tsx:38-206` |
| Phase 0 | Loopback bind by default (`BIND_HOST`), mock-only RSD routes return 404 when `NODE_ENV=production`, fail-closed startup when auth config is absent. | `server/src/index.ts`, `server/.env.example` |
| Verification | New security regression tests for missing/tampered/expired/wrong-issuer/wrong-audience tokens, invalid claims and admin denial. | `server/tests/auth/auth.test.ts`, `src/api/authHeaders.test.ts` |

JWT verification uses `jose` with an algorithm allow-list (HS256 or RS256), required issuer/audience,
`exp`/`nbf` checks and claim mapping via `AUTH_JWT_*` variables. No key material is stored in the repo
and there is no development bypass.

### 13.2 Verification evidence

- `npm run build` (root): pass, no chunk-size warning.
- `npm run build` (server, `tsc -b`): pass.
- `npm run lint`: pass (only pre-existing warnings).
- `npm test`: **583 passed** (48 files; was 574/46 before — 9 new auth tests).
- `npm run test:e2e`: **47 passed**.
- Fail-closed startup: `node dist/index.js` with no `AUTH_JWT_*` config exits 1 with
  `AUTH_JWT_ISSUER is required to validate POS JWTs`.
- Auth verification cost (2,000 authenticated middleware calls, HS256): **927.83 ms total,
  0.4639 ms/request mean**. This is the new cost of deny-by-default; there is no pre-auth baseline
  because the endpoint was previously unauthenticated. No database query or index change was made.

### 13.3 Remaining risks / next steps

- **Production configuration is still required:** set `AUTH_JWT_ALGORITHM`, the signing key or JWKS,
  `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE` and, if the dotnet-pos claim names differ from the defaults,
  the `AUTH_JWT_*_CLAIM` variables. Until then the server intentionally refuses to start.
- **SEC-06/07/09/10/11/12 (HIGH) are still open.** Branch disclosure policy, tenant/company columns,
  key/certificate storage, live submission endpoints, browser token storage and localStorage PHI
  need an owner decision before code changes; tenant columns remain explicitly deferred.
- Staging verification of the exact dotnet-pos token shape and the role/endpoint matrix is still
  mandatory; static tests cannot prove the external issuer's claims match the configured mapping.

---

## 14. Remediation status — HIGH Phase A (stock/financial integrity, 2026-11-27)

Scope: the four HIGH findings that can corrupt stock or money through the `:4300` SQL mirror were
fixed first. Architectural findings (SEC-06/07/09/10/11/12) were **not** changed: they need an owner
decision on disclosure policy, tenant columns and secret/browser storage.

### 14.1 Implemented

| Finding | Change | Evidence |
|---|---|---|
| SEC-03 | Returns now require the original invoice to belong to `terminalBranch`; return lines must belong to that invoice; cumulative `returnedQty` is checked against each line's qty and written back; no client-supplied `updatedLineReturnedQtys` is trusted; status is re-derived. Replays are deduped by return id/number. | `server/src/routes/sales.ts` |
| SEC-04 | Sale line/header arithmetic is re-derived (`qty × price − discount`, VAT, totals, payments); qty must be a positive integer, VAT rate a 0–1 fraction, invoice type/status allow-listed; cashier identity comes from the verified JWT, never the body. Replays are deduped by sale id/invoice number. | `server/src/validation/sales.ts`, `server/src/validation/common.ts`, `server/src/routes/sales.ts` |
| SEC-05 | Receiving/reversal quantities, dates, prices and discounts are validated; all batch reads/writes are branch-scoped; conditional `updateMany` prevents negative stock; a new idempotency ledger makes queued retries no-ops. | `server/src/validation/receiving.ts`, `server/src/routes/receiving.ts`, `server/prisma/schema.prisma` |
| SEC-08 | `posSaleId`/`posItemId` are only hints: they are re-resolved against the verified invoice and item; rates/types/qty are bounded; all commission writes run in one transaction; duplicate return clawbacks are skipped once the local return has been backed up. | `server/src/routes/incentives.ts` |
| Clients | `receivingId` (browser receiving event id) and deterministic `reversalId` are sent with the best-effort mirrors so retries are safe. Local-first behavior is unchanged: a rejected/failed mirror is queued by `pendingSyncStore` and never blocks a sale. | `src/api/receivingApi.ts`, `src/store/catalogStore.ts` |
| Database | Migration `20261128100000_add_receiving_backup_events` (idempotency ledger, PK + branch/item/batch composite index) generated clients and applied. `prisma migrate status` now reports 21/21 applied. | `server/prisma/migrations/20261128100000_add_receiving_backup_events/migration.sql` |
| Tests | Boundary unit tests plus HTTP route regressions with an in-memory Prisma double: cross-branch returns rejected, excess return qty rejected, second partial return accumulates, negative stock writes rejected, sale/return/receiving replays are no-ops, commission IDs verified. | `server/tests/validation/mirror.test.ts`, `server/tests/routes/mirrorIntegrity.test.ts` |

### 14.2 Verification evidence

- `npm run db:generate`: pass (both Prisma clients). `npx prisma migrate deploy`: migration applied;
  `npx prisma migrate status`: 21/21 applied.
- `npm run build` (server `tsc -b` and root `tsc -b && vite build`): pass; no chunk-size warning.
- `npm run lint`: pass, only previously-known warnings (no new warnings in changed files).
- `npm test`: **602 passed / 50 files** (was 583/48 after Phase 0; 19 new tests).
- `npm run test:e2e`: **47 passed** (unchanged local-first flows; backend was intentionally down, so
  mirrors failed and queued exactly as designed).
- Validation overhead measured over 2,000 calls each after 200 warm-ups: sale **0.0110 ms/request**,
  return **0.0038 ms/request**, receiving **0.0040 ms/request**. There is no pre-fix baseline because
  these boundaries previously performed no checks at all.
- SQL Server plan (`SET SHOWPLAN_ALL ON`) on the new table: id lookup uses **Clustered Index Seek**
  (`receiving_backup_events_pkey`, cost 0.0032831); branch+item+batch lookup uses **Index Seek**
  (`receiving_backup_events_branch_item_batch_idx`, cost 0.0032831). No table scan introduced.

### 14.3 Remaining HIGH risks / decisions required

- SEC-06 cross-branch stock disclosure: currently an authenticated cashier can ask what other
  branches hold. Decide whether that is an allowed business feature or must be role-scoped.
- SEC-07 tenant/company dimension and branch-from-local-file: deferred by owner decision; needs
  schema and dotnet-pos changes.
- SEC-09 plaintext CSID key / RSD password, SEC-10 live submission endpoints, SEC-11 token in
  localStorage, SEC-12 PHI in localStorage: no change in Phase A.
- SEC-08 duplicate-clawback suppression relies on the local return being backed up before the
  incentive mirror; a permanent hard dedupe key should be added if the two queues can diverge.
- Replayed sale/return/receiving mirrors are rejected or acknowledged as duplicates; monitor 409/200
  `duplicate: true` responses to detect genuine client id collisions.

---

## 15. Remediation status — SEC-10 live ZATCA/RSD endpoints (2026-11-27)

Scope decision: the Phase 0 deny-by-default `requireAuth` on `/api/*` and the existing `requireAdmin`
guards were kept. Cashier sale/ZATCA submission and RSD sale reporting stay **authenticated only** so
the local-first till can keep selling; the irreversible switches gain an admin-only second key and an
immutable audit record. No live fiscal movement was sent while testing.

### 15.1 Implemented

| Finding | Change | Evidence |
|---|---|---|
| SEC-10 | `server/src/audit.ts`: append-only JSONL trail (`attempt`/`success`/`failure`/`denied`) with verified-JWT actor, timestamp, action and a key-name denylist for secrets/confirmations/PHI. Default `server/data/security-audit.jsonl`; `SECURITY_AUDIT_FILE` overrides it for tests. The attempt is written **before** the fiscal action; a failed audit append aborts it. | `server/src/audit.ts`, `server/src/auth/confirmation.ts` |
| SEC-10 | ZATCA: admin + exact confirmation phrases `PRODUCTION ENVIRONMENT` (env→production), `ENABLE LIVE` (mode→live), `PRODUCTION CSID` (production CSID). Compliance CSID/check requests are audited; the OTP is never logged. | `server/src/routes/onboarding.ts`, `src/api/zatcaApi.ts`, `src/components/Zatca/ZatcaOnboardingPanel.tsx` |
| SEC-10 | RSD: admin + `ENABLE LIVE RSD` when settings move mock→live or test→production; `ALLOW MOCK RSD` for the dev-only mock accept/reset helpers. Sale/cancel/reopen/connection-test/settings changes are audited. Mock routes still return 404 in a `NODE_ENV=production` process (`src/index.ts`). | `server/src/routes/rsd.ts`, `src/api/rsdApi.ts`, `src/components/Settings/RsdSettingsPanel.tsx` |
| SEC-10 | ZATCA invoice submission is audited (attempt + outcome) with invoice number/type/document type/environment/mode only — never customer name, line items, QR, key or OTP. | `server/src/routes/invoices.ts` |
| SEC-10 | Human `window.confirm` dialogs gate the ZATCA production env/CSID and RSD live/production UI actions; cancelling sends no request. `server/data/` is now gitignored so audit/config files cannot be committed. | `src/components/Zatca/ZatcaOnboardingPanel.tsx`, `src/components/Settings/RsdSettingsPanel.tsx`, `.gitignore` |
| Tests | 9 HTTP regressions with signed HS256 tokens and local service mocks: anonymous 401, cashier 403, missing/incorrect phrase 400 `confirmation_required` + `denied` audit, valid phrase 200 + attempt/success audit, submission failure 502 + `failure` audit, and byte-level checks that OTP/password/confirmation phrases/GTIN/serial/prescription/customer name never reach the audit file. | `server/tests/routes/securityControls.test.ts` |

### 15.2 Verification evidence

- `npm run build` (server `tsc -b`, root `tsc -b && vite build`): pass. `npm run lint`: pass with only
  pre-existing warnings (no new warning in changed files).
- `npm test`: **611 passed / 51 files** (was 602/50; 9 new SEC-10 tests).
  `npm run test:e2e`: **47 passed** — local-first sale/return/RSD flows unchanged with the backend down.
- Audit overhead measured over 2,000 iterations after 200 warm-ups (2 appends per action):
  single append **2.0914 ms/action**, full `audited` wrapper **4.1458 ms/action**. A correct
  confirmation phrase adds **0.0015 ms** (no write); a denied one writes one record (**2.1163 ms**).
  These are local file-append costs on this Windows host; admin switches are infrequent and the
  ZATCA/SFDA network round trip dominates the per-sale audit cost.
- Destination allow-listing is structural: ZATCA hosts are hard-coded per environment in
  `server/src/config.ts`, and production RSD endpoints are rejected unless `https://`
  (`server/src/rsd/settings.ts`). No live endpoint was contacted during verification.

### 15.3 Remaining risks / decisions required

- **Rate limiting is not implemented.** The confirmation key and audit trail limit accidental or
  single-actor misuse, but a compromised admin token can still retry live actions; add a per-actor
  limiter before exposing port 4300 beyond the LAN.
- The audit file is append-only **within the app**, not WORM storage: an attacker with filesystem
  access can still edit/delete it. Ship it to central logging (or a signed/WORM store) in production.
- SEC-09 is remediated in §16; SEC-11 JWT in localStorage and SEC-12 PHI in localStorage remain
  unchanged. The JWT config (`AUTH_JWT_*`) is still required before the server will start.
- Staging verification with the real dotnet-pos token, an authorized admin account and a live but
  non-production ZATCA/SFDA environment is mandatory before enabling either live switch.

---

## 16. Remediation status — SEC-09 secrets at rest (2026-11-27)

Owner-approved design: AES-256-GCM with a 32-byte `SECURE_STORE_KEY`, encrypting the **whole**
`zatca-state.json` and `rsd-settings.json`. A real HSM/KMS was explicitly out of scope; this closes
the "filesystem/backup copy reveals the private key or password" exposure, not "compromised running
process can still use the key".

### 16.1 Implemented

| Finding | Change | Evidence |
|---|---|---|
| SEC-09 | `server/src/store/secretFile.ts`: envelope `{v:1, alg:'aes-256-gcm', iv, tag, data}` with a fresh 12-byte random IV per write, 16-byte GCM tag, fixed AAD, strict base64/hex key parsing, atomic temp-file + rename, `0600` mode on POSIX, and errors that never echo the key or plaintext. `SECURE_STORE_KEY` accepts base64 of exactly 32 bytes or 64 hex characters. | `secretFile.ts` |
| SEC-09 | Production fails closed when the key is missing/malformed: `assertSecretStoreConfigured()` runs before any listener, `config.ready()` surfaces state-file errors, and `loadStoredSettings()` no longer swallows decryption/read failures into a silent `.env` fallback. Outside production, plaintext dev workflow remains available. | `server/src/index.ts`, `server/src/config.ts`, `server/src/rsd/settings.ts` |
| SEC-09 | Legacy plaintext files are accepted and atomically rewritten as encrypted envelopes on first read with a key; no onboarding/credential state is changed by the migration. `ZATCA_STATE_FILE` and `RSD_SETTINGS_FILE` remain overridable for tests/relocation. | `secretFile.ts`, `secureStore.ts`, `rsd/settings.ts` |
| SEC-09 | Both CSID material (`secret`, `binarySecurityToken`, `certificatePem`, `privateKeyPem`) and both RSD credential blocks are encrypted; the browser still receives only `hasPassword`/`credentialsConfigured`, blank password still preserves the stored password, and restart re-applies saved RSD settings. | `server/tests/store/secureStore.test.ts`, `server/tests/rsd/settings.test.ts` |
| Tests | 11 new SEC-09 regressions: no plaintext private key/secret/password on disk, AES envelope shape, fresh IV per write, no leftover temp files, base64 + hex keys, round-trip reload, CSID clearing/ICV reset after encryption, wrong key/tampered ciphertext/unsupported envelope rejection, missing/malformed key fail-closed, legacy plaintext migration, and dev plaintext fallback. | `server/tests/store/secretFile.test.ts`, `server/tests/store/secureStore.test.ts`, updated `server/tests/rsd/settings.test.ts` |

### 16.2 Verification evidence

- Targeted SEC-09 tests: **15 passed / 3 files**. Full `npm test`: **622 passed / 53 files**
  (was 611/51 before SEC-09; 11 new tests). `npm run test:e2e`: **47 passed** — local-first
  sale/return/RSD flows still work with the backend down.
- Server `npm run build` and root `npm run build`: pass. `npm run lint`: pass with only pre-existing
  warnings; none in the new/changed secret-storage files.
- Encryption overhead measured over 2,000 iterations after 200 warm-ups on a representative CSID
  state (2 appends per write): plaintext write **4.4904 ms**, AES write **4.9529 ms** (+0.4625 ms);
  plaintext read **2.4918 ms**, AES read **2.5881 ms** (+0.0963 ms); full encrypted round trip
  **7.5682 ms**. This is local Windows file-I/O cost; encryption is not on the cashier checkout path
  because the browser sale remains authoritative and ZATCA signing is already network-bound.
- Fail-closed startup verified on the built server with `NODE_ENV=production` and no key:
  `[startup] refusing to start: SECURE_STORE_KEY is required in production.` and exit code **1**,
  before any listener opened. No live ZATCA/SFDA call, real key rotation or destructive staging
  test was performed.

### 16.3 Remaining risks / decisions required

- `SECURE_STORE_KEY` must be generated outside the repo and stored in the service secret store/OS
  keyring; `.env` is gitignored but a copied `.env` still grants decryption to whoever holds it.
- There is no HSM/KMS and no per-decryption audit: a compromised Express process can still call the
  key. Key rotation currently means decrypt with the old key and re-save with the new one; a dedicated
  rotation CLI and central/WORM secret-access logging should be added before production rollout.
- `data/zatca-invoices.json` (signed UBL retention) and the RSD/Wasfaty ledgers are still plaintext
  JSON. They are not the CSID private key, but they do contain invoice/customer data and need their
  own retention/access-control decision.
- SEC-11 (JWT in localStorage), SEC-12 (PHI in localStorage), SEC-06 (cross-branch stock policy),
  SEC-07 (tenant/company columns), rate limiting and WORM/central audit shipping remain open.
