// Computes the transitive relative-import closure of the scoped screens, so the copy into
// OpenMind's src/pharmacy includes every file those screens actually need.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, extname } from 'node:path';

const ROOT = 'F:/SOURCE/React/Pharmacy-App/src';
const ENTRIES = [
  'components/Purchasing/VendorsPage.tsx',
  'components/Purchasing/VendorFormDialog.tsx',
  'components/Inventory/ManufacturersPage.tsx',
  'components/Inventory/ManufacturerFormDialog.tsx',
  'components/Inventory/ItemMasterPage.tsx',
  'components/Inventory/ItemMasterFormDialog.tsx',
  'components/Purchasing/PurchaseInvoicePage.tsx',
  'components/Offers/OffersPage.tsx',
  'components/Offers/OfferFormDialog.tsx',
  'components/Inventory/InventoryPage.tsx',
  'components/Inventory/DosagesPage.tsx',
  'components/Inventory/DosageFormDialog.tsx',
  'components/Inventory/DosageLinkEditor.tsx',
  'components/Inventory/WasfatyMappingPage.tsx',
];

const exts = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];
const seen = new Map(); // rel path -> Set(imports)
const externals = new Set();
const missing = new Set();

function resolveRel(fromFile, spec) {
  const base = resolve(dirname(resolve(ROOT, fromFile)), spec);
  for (const e of exts) {
    const p = base + e;
    if (existsSync(p) && !p.endsWith('/')) {
      try {
        if (!p.match(/\.(ts|tsx)$/)) continue;
      } catch { continue; }
      return relative(ROOT, p).replaceAll('\\', '/');
    }
  }
  return null;
}

function visit(rel) {
  if (seen.has(rel)) return;
  const src = readFileSync(resolve(ROOT, rel), 'utf8');
  const imports = new Set();
  const re = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[1];
    if (spec.startsWith('.')) {
      const target = resolveRel(rel, spec);
      if (target) imports.add(target);
      else missing.add(`${rel} -> ${spec}`);
    } else {
      externals.add(spec);
    }
  }
  seen.set(rel, imports);
  for (const i of imports) visit(i);
}

for (const e of ENTRIES) {
  if (!existsSync(resolve(ROOT, e))) {
    console.error(`MISSING ENTRY ${e}`);
    process.exitCode = 1;
    continue;
  }
  visit(e);
}

const files = [...seen.keys()].sort();
console.log(`FILES ${files.length}`);
for (const f of files) console.log(f);
console.log(`\nEXTERNALS ${externals.size}`);
for (const e of [...externals].sort()) console.log(e);
console.log(`\nMISSING ${missing.size}`);
for (const m of missing) console.log(m);
