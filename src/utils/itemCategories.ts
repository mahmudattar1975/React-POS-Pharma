// Lookup helpers for the shared ItemCategories master. The master is SQL-backed but these helpers
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
  return categories.find((category) =>
    [category.categoryCode, category.nameEn, category.nameAr].some((candidate) => {
      if (key(candidate) === exact) return true;
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
