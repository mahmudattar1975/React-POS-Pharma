# Four pharmacies, one PharmaDB

## Model
- **One shared `PharmaDB`** holds the branch master, sales, returns and stock batches.
- **One shared item catalogue and price list.** Stock is owned per branch: the same item/batchNo
  can exist in several branches with different quantities.
- **Each PC declares its own branch** in `server/config/branch.json` (gitignored). A cashier cannot
  switch branch at the till.
- **Invoice numbers are branch-prefixed**: `RIY-SIM-000001`, `JED-PUR-000001`. Purchase invoices
  still live in that terminal's browser storage; only sales/returns/stock are mirrored to SQL.

## One-time setup
1. Apply the migration (review it first — it adds columns and seeds four branches):
   ```powershell
   cd server
   npx prisma migrate deploy
   npx prisma generate
   ```
   Existing rows are assigned to `cc-br-001` by the migration defaults. Nothing is deleted.
2. On **each** pharmacy PC, copy `server/config/branch.example.json` to `server/config/branch.json`
   and set that PC's branch id:
   ```json
   { "branchId": "cc-br-002" }
   ```
3. Restart the server. The startup line prints the selected branch.
4. Open **Settings → Branches** to add/edit branches and review codes, VAT/GLN and cost-center links.

### Seeded branches
| ID | Code | Branch |
| --- | --- | --- |
| `cc-br-001` | RIY | Riyadh |
| `cc-br-002` | JED | Jeddah |
| `cc-br-003` | DAM | Dammam |
| `cc-br-004` | MKK | Makkah |

## Offline behaviour
Sales never wait on the database. The browser records the sale first; the SQL backup is
best-effort and queued for retry (`pendingSyncStore`). If the server or network is down:
- the till keeps selling with the last known branch code;
- "Check other branches" shows a warning instead of blocking checkout;
- Settings → Branches shows the built-in fallback list and refuses edits until the DB is back.

## Changing a branch code
Codes appear on issued invoice numbers. The API refuses a code change once documents exist for
that branch — deactivate it and add a new branch instead.

## Still global (not per branch yet)
ZATCA identity, RSD GLN/credentials and Wasfaty credentials are read from the server .env/state
files. Branch rows store optional VAT/CR/GLN values for future wiring, but the compliance panels
do not consume them yet.
