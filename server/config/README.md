# Per-terminal branch selection

Copy `branch.example.json` to `branch.json` in this folder and set the branch of **this PC**:

```json
{ "branchId": "cc-br-002" }
```

`branch.json` is gitignored — each of the four pharmacy machines carries its own value. Use the
**Branch ID** shown in Settings → Branches. Adding/renaming branches is done in that screen; this
file only selects which one this terminal is.

If the file is missing or invalid the server warns and falls back to `cc-br-001` (Riyadh) so the
till can still open offline. Sales are always recorded in the browser first; the SQL backup and the
cross-branch stock lookup are the only things that need the server.
