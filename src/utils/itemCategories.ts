// Lookup helpers for the shared Categories master. The master is SQL-backed but these helpers
// are pure so the Item Master form and Excel planner can resolve a typed ID, code or bilingual
// name the same way, including while the till is offline.
import type { ItemCategory } from '../types/catalog';

function arabicDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

function key(value: string): string {
  return arabicDigits(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

// Codes may be typed with or without separators ("CAT-001", "cat 001", "CAT001").
function looseKey(value: string): string {
  return key(value).replace(/[^a-z0-9]/g, '');
}

// Legacy Excel descriptions that belong to an existing master row but do not match its canonical
// English/Arabic name. Keyed by CategoryCode so the mapping survives a rename of the display name.
// These are value aliases only - the importer still writes the canonical NameEn into Item.category.
const LEGACY_CATEGORY_ALIASES: Record<string, string[]> = {
  'CAT-001': ['RX', 'RX - riadh'],
  'CAT-003': ['DIAPPERS'],
  'CAT-004': ['COSMOTICS'],
  'CAT-005': ['SKIN', 'SKIN CARE'],
  'CAT-006': ['HAIR CARE'],
  'CAT-007': ['DENTAL CARE'],
  'CAT-008': ['DIETARY SUPPLEMENTS'],
  'CAT-009': ['BABY CARE'],
  'CAT-011': ['PERSONAL HYGIENE', 'PERSONAL HYGIENE PRODUCTS', 'BODY CARE'],
  'CAT-013': ['FIRST AID'],
  'CAT-014': ['MEDICAL DEVICES'],
  'CAT-026': ['FOOD'],
  'CAT-044': ['MEDICATED COSMOTICS'],
};

// These legacy columns are flags/scope markers, not product categories. Treat them as "no link"
// instead of rejecting the whole import file for an unknown category.
const IGNORED_CATEGORY_VALUES = new Set([
  'all',
  'saleable / pos',
  'saleable/pos',
]);

export function isIgnoredItemCategoryValue(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  return IGNORED_CATEGORY_VALUES.has(key(String(value)));
}

export function activeItemCategories(categories: ItemCategory[]): ItemCategory[] {
  return categories.filter((category) => category.isActive !== false)
    .sort((a, b) => a.categoryId - b.categoryId);
}

// Accepts the stable CategoryID, the unique CategoryCode, or either bilingual name. That matches
// how owners actually fill the Excel column and keeps old free-text labels resolvable.
export function resolveItemCategory(
  value: string | number | null | undefined,
  categories: ItemCategory[],
): ItemCategory | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;

  if (/^\d+$/.test(text)) {
    const id = Number(text);
    return categories.find((category) => category.categoryId === id);
  }

  const exact = key(text);
  const loose = looseKey(text);

  const direct = categories.find((category) =>
    [category.categoryCode, category.nameEn, category.nameAr].some((candidate) => key(candidate) === exact)
  );
  if (direct) return direct;

  // Legacy labels are matched before loose ASCII matching: "BODY CARE" must resolve to CAT-011,
  // not to a coincidental partial match on some other English category name.
  const alias = categories.find((category) =>
    (LEGACY_CATEGORY_ALIASES[category.categoryCode] ?? []).some((candidate) => key(candidate) === exact)
  );
  if (alias) return alias;

  return categories.find((category) =>
    [category.categoryCode, category.nameEn, category.nameAr].some((candidate) => {
      // Loose matching is only for ASCII codes/names such as CAT-008 vs CAT008. Arabic names have
      // no ASCII characters, so an empty loose key must never match every Arabic category.
      const candidateLoose = looseKey(candidate);
      return loose.length > 0 && candidateLoose.length > 0 && candidateLoose === loose;
    })
  );
}

// The selected category writes this canonical English label into Item.category. Cost-center rules,
// POS line stamping and reports already key off that text, so it must stay stable even when the
// owner selected the category by its Arabic name.
export function itemCategoryLabel(category: ItemCategory): string {
  return category.nameEn.trim();
}

export function itemCategoryOptionLabel(category: ItemCategory): string {
  return category.nameEn.trim() ? `${category.nameEn} — ${category.nameAr}` : category.nameAr;
}
