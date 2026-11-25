# Arabic / English interface and RTL layout

The whole UI can switch between English (LTR, the default) and Arabic (RTL). The same choice drives
the words on screen, MUI's `direction`, and `<html dir/lang>`; it is saved on the device in
`localStorage` under `pharmacy-locale` and restored on the next visit.

## For cashiers

- **Sidebar:** the language icon next to the store name toggles Arabic ↔ English.
- **Settings:** *Interface language* offers explicit `English` / `العربية` buttons.
- The choice persists per browser profile. Printed invoice layouts keep their established
  bilingual document order; the rest of the app mirrors.

## For developers

- `src/i18n/localeStore.ts` is the single source of truth (`en` | `ar`).
- `src/i18n/I18nProvider.tsx` owns `ThemeProvider`, `CssBaseline`, document `dir/lang`, and the
  `t(source)` lookup. `src/main.tsx` mounts it around `<App />`; no page owns the theme anymore.
- Use `<T>English text</T>` for JSX text and `const tr = useT()` for string props/templates. The
  hook is deliberately named `tr` because several screens already use `t` for totals.
- **Source strings are the dictionary keys.** Missing Arabic keys fall back to English, so a new
  label never breaks a screen. `t()` trims the key for lookup but restores the source's leading and
  trailing whitespace: codemod-generated fragments such as `` `${tr('Save changes to ')}${no}` ``
  depend on that space. Keep the space in the source string.
- Arabic entries live in `src/i18n/translations.ts`. Preserve technical tokens (SAR, GLN, GTIN,
  RSD, ZATCA, NUPCO, Wasfaty, card networks) and domain terms (e.g. *Controlled* = الأدوية
  الخاضعة للرقابة, *RSD Reporting* = الإبلاغ عن RSD). Do not translate identifiers, statuses,
  keyboard keys, or CSS: compare against literals such as `'phase2_cleared'`, never `tr(...)`.
- The sidebar icon and the Settings selector both call the same store action; adding another
  switcher should do the same rather than mutating `document.dir` directly.

## Layout rules

- Prefer MUI's logical props: `borderInlineStart`, `insetInlineStart`/`insetInlineEnd`,
  `justifyContent: 'start'|'end'` for controls that should mirror. Keep physical values only for
  fixed artwork (card-network circles), bilingual print documents, and numbers that must stay
  right-aligned in both languages.
- Arabic captions inside an otherwise Latin line keep `dir="rtl"` and an explicit `textAlign`.
- Standalone codes and numbers (invoice no, prescription no, barcode, NUPCO code) use
  `dir="ltr"` plus `unicodeBidi: 'isolate'` so neighbouring Arabic text cannot reorder them.
- `src/index.css` contains `.flip-rtl` for custom directional glyphs. MUI flips its own icons via
  the theme; do not add `flip-rtl` to medication or logo icons.

## Verification

```powershell
npx tsc -b --force --pretty false
npm run build
npm run lint
npm test
npm run test:e2e
```

English remains the default so existing E2E text selectors stay valid. Browser QA should check
that toggling flips `document.documentElement.dir/lang` together with the visible text, and that
axe reports no violations on both directions of the key routes (POS, Inventory, Settings,
Dashboard, Purchases).
