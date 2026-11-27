# Item Master field mapping → `dbo.items`

Target: the Pharmacy-App item master table `[dbo].[items]` (Prisma model `Item` in
`server/prisma/schema.prisma`). The legacy .NET commission master `[dbo].[item]` and its
`commission_item` / `pos_item` tables are **not** changed.

> Before applying, confirm which database `DATABASE_URL` points to. This table is reached through the
> main Prisma client; the code comments describe it as being in `dotnet_pos`, while `server/README.md`
> describes `DATABASE_URL` as `PharmaDB`. The migrations are additive and **not applied automatically**.

## Mapping

| Recommended / requested field | Arabic name | `dbo.items` column | State | Notes |
| --- | --- | --- | --- | --- |
| ItemID | رقم الصنف | `id` | existing | Internal unique ID (string PK). |
| ItemCode | كود الصنف | `itemNo` | **new** | Internal numeric code; mirrors frontend `Item.itemNo`. Nullable for old/ERP rows. |
| ItemNameEn | اسم الصنف بالإنجليزية | `nameEn` | existing | |
| ItemNameAr | اسم الصنف بالعربية | `nameAr` | existing | |
| BrandID | الماركة | `brandId` | **new** | FK → `BrandMaster(BrandID)`. The Item Master now picks this from the 131-row brand master. |
| CategoryID (main) | فئة الصنف | `categoryId` | existing | FK → `Categories(CategoryID)`; `category` remains the free-text POS label. |
| SubCategoryID | الفئة الفرعية | `subCategoryId` | **new** | FK → `Categories(CategoryID)`; rows there have `ParentCategoryID` set. |
| ItemType | نوع الصنف | `itemType` | **new** | Medicine / Device / Consumable / … |
| GenericName | الاسم العلمي | `genericName` | **new** | Generic drug name. |
| ActiveIngredient | المادة الفعالة | `activeIngredient` | **new** | Frontend alias: `Item.scientificName`. |
| Strength | التركيز | `strength` | **new** | e.g. `500 mg`. |
| DosageForm | الشكل الدوائي | `dosageForm` | **new** | Tablet / Capsule / Syrup / … (distinct from `dosageIds` links). |
| RouteOfAdministration | طريقة الاستخدام | `routeOfAdministration` | **new** | Oral / Topical / Injection. |
| ManufacturerID | الشركة المصنعة | `manufacturerId` | **new** | FK → `Manufacturers(ManufacturerID)`. Same link as `manufacturerNo`; kept in sync by a DB trigger. |
| — (frontend key) | رقم الشركة المصنعة | `manufacturerNo` | **new** | Stable `Manufacturer.CompanyNo` text key used by the existing UI/form. Authoritative when the pair disagrees. |
| — (requested master) | المورد المفضل | `vendorId` | **new** | FK → `CustVendor(VendorID)` (renamed from `Vendors`). Same link as `vendorNo`; kept in sync by a DB trigger. |
| — (frontend key) | رقم المورد | `vendorNo` | **new** | Stable `Vendor.vendorNo` text key used by the existing UI/form. Authoritative when the pair disagrees. |
| CountryOfOrigin | بلد المنشأ | `countryOfOrigin` | **new** | |
| Barcode | الباركود | `barcode` | existing | Unique primary scannable code. |
| GTIN | الرقم التجاري العالمي | `gtin` | **new** | Frontend alias: `Item.gtin`. |
| UnitID | وحدة القياس | `unitId` | **new** | FK → `Units(UnitID)`; the Item Master Unit dropdown selects `Units.NameEn` into the old free-text `unit` that POS/receipts still read. |
| PackSize | حجم العبوة | `packSize` | **new** | Units per pack; complements the frontend `pack` ladder. |
| StorageCondition | ظروف التخزين | `storageCondition` | **new** | Room temperature / Refrigerated / … |
| RequiresPrescription / IsPrescriptionOnly | يتطلب وصفة طبية / يصرف بوصفة طبية | `requiresPrescription` | **new** | One column for both names (same meaning); backfilled from `controlledStatus IS NOT NULL`. |
| IsControlledDrug | دواء خاضع للرقابة | `isControlledDrug` | **new** | Backfilled from `controlledStatus LIKE 'schedule_%'`; includes psychotropics. |
| IsTaxable | خاضع للضريبة | `isTaxable` | **new** | Defaults to `1`; zero-rated drugs still carry a VAT rate of `0`. |
| VATRate | نسبة الضريبة | `vatRate` | existing | Per item, decimal fraction. |
| CostPrice | سعر التكلفة | `costPrice` | **new** | Optional item-level master/default cost entered beside `basePrice`; each receipt still writes the authoritative `Batch.costPrice`. |
| MinimumStock | الحد الأدنى للمخزون | `minimumStock` | **new** | Lower bound; kept separate from the reorder trigger. |
| MaximumStock | الحد الأقصى للمخزون | `maximumStock` | **new** | Frontend alias: `Item.maxLevel`. |
| ReorderLevel | نقطة إعادة الطلب | `reorderLevel` | existing | Existing trigger point used by the POS logic. |
| IsActive | حالة الصنف | `isActive` | **new** | Defaults to `1`, so existing rows keep selling. |
| DrugClass | التصنيف العلاجي | `drugClass` | **new** | e.g. Antibiotic. |
| ATCCode | كود التصنيف العلاجي | `atcCode` | **new** | WHO ATC code (`NVARCHAR(20)`; real codes are ≤ 7 chars). |
| SFDARegistrationNo | رقم تسجيل هيئة الغذاء والدواء | `sfdaRegistrationNo` | **new** | Frontend alias: `Item.registrationNo`. |
| IsTemperatureSensitive | حساس لدرجة الحرارة | `isTemperatureSensitive` | **new** | Defaults to `0`; backfilled only when `storageCondition` mentions cold/refrigerated. |
| RequiresBatchTracking | يتطلب تتبع التشغيلة | `requiresBatchTracking` | existing | Already required by the POS stock logic. |
| RequiresExpiryDate | يتطلب تاريخ صلاحية | `requiresExpiryDate` | **new** | Defaults to `1` (normal pharmacy practice). |
| RequiresSerialNumber | يتطلب رقم تسلسلي | `requiresSerialNumber` | **new** | Defaults to `0`; only SFDA-serialized packs need it. |
| IsNarcotic | مخدر | `isNarcotic` | **new** | Defaults to `0`; deliberately NOT derived from `controlledStatus`, which also covers psychotropics. |

`Item.location` ("Shelf / store location") is an app-only text field: `dbo.items` has no location
column. The Item Master now chooses its value from `dbo.Locations`, storing `Locations.NameEn`; an
old unmatched label stays visible as a legacy option until the owner replaces it.

**32 new columns** across the staged migrations (20 generic + `unitId` + `manufacturerNo`,
`vendorNo`, `vendorId` + 7 pharmaceutical fields + `costPrice`). `basePrice` and
`requiresBatchTracking` are
existing app-specific fields that are not in the recommended list and were deliberately kept.
`manufacturerId`/`manufacturerNo` and `vendorId`/`vendorNo` are two representations of one link;
they are counted as four columns but never hold contradictory values.

## Master tables (staged)

| Table | Purpose | Seed |
| --- | --- | --- |
| `BrandMaster` | Brand lookup for `brandId` | 131 approved brands (`BR-0001..BR-0131`); fields `BrandID`, `BrandCode`, `BrandNameEn`, `BrandNameAr`, `ManufacturerID`, `CountryOfOrigin`, `IsActive` |
| `Units` | Unit of measure for `unitId` and the Item Master dropdown | 14 deterministic rows, including ERP code `BUTTL` |
| `Locations` | Shelf/store location for the Item Master dropdown | 17 deterministic rows (`A-01..A-12`, `B-01..B-04`, `Main Shelf`) |
| `Manufacturers` | Company master; `CompanyNo` is `Item.manufacturerNo` | 5 rows from `seedData.ts`'s `seedManufacturers` |
| `CustVendor` (renamed from `Vendors` in migration 12) | FCODCSVN-style party master; `VendorNo` is `Item.vendorNo` | 6 rows (3 suppliers + 3 business customers) from `seedData.ts`'s `seedVendors` |
| `Categories` (renamed from `ItemCategories` in migration 7) | Three-level hierarchy | 28 mains (3 relabelled to the requested names, IDs/codes unchanged) + 11 subcategories (32-42) |

`BrandMaster` carries exactly the seven requested fields: `BrandID`, `BrandCode`, `BrandNameEn`,
`BrandNameAr`, `ManufacturerID`, `CountryOfOrigin`, `IsActive`. `ManufacturerID` is nullable, with a
`NO ACTION` FK to `Manufacturers` created in migration 4 (after that master exists); brands without a
known maker stay unlinked. Its `CountryOfOrigin` is brand-level metadata, separate from the item-level
`items.countryOfOrigin`.

The four lookup masters above are maintained on the **Masters** tab inside `/items`: add, edit and
activate/disable rows, but never delete them, because existing items refer to the rows by id or
label. Codes are assigned once by the SQL master APIs and stay read-only on edit.

`Manufacturers.ManufacturerID` equals `CompanyNo` for the seeded rows so backfill from the frontend
numeric key is deterministic. `CustVendor.TypeFlag` follows the existing party convention: `1`
supplier, `2` business customer; both can be referenced by `Item.vendorNo`, matching the current
form's list.

An `AFTER INSERT, UPDATE` trigger on `dbo.items` (`items_sync_master_keys`) keeps the two
representations of each link together. It matches `vendorNo` against `CustVendor.VendorNo` and
`manufacturerNo` against `Manufacturers.CompanyNo`; the text key wins when both sides are present
but disagree, an unmatched/non-numeric text key clears the numeric FK, and a numeric-only write is
filled from the master table. Text keys are trimmed. A legacy text value with no master row keeps
working exactly as before, with a `NULL` FK.

The requested hierarchy reuses exact matches `CAT-001..004` (Medicines, Medical Supplies, Diapers,
Cosmetics). To avoid duplicate concepts, the three near-matching approved mains are **relabelled, not
duplicated**: `CAT-009` → Baby Products / منتجات الأطفال, `CAT-011` → Personal Care / عناية شخصية,
`CAT-014` → Medical Devices / أجهزة طبية. Their IDs, codes and existing item links stay unchanged;
the rename is guarded by the old English label so a rerun is a no-op. Subcategories `CAT-032..042`
have `ParentCategoryID` pointing at their main, so the chain Main → Subcategory → Item is complete
without a second set of near-identical mains.

## Migration order (applied to `dotnet_pos` on 2026-11-26)

1. `20261126090000_add_item_master_fields` — 20 nullable/defaulted item columns + indexes; backfills
   the two prescription flags from `controlledStatus`.
2. `20261126100000_add_brands_units_masters` — `BrandMaster` (7 fields), `Units`, `unitId`,
   seed/backfill, FKs.
3. `20261126110000_add_pharmaceutical_product_fields` — 7 pharmacy-specific columns + indexes;
   best-effort temperature backfill.
4. `20261126120000_add_manufacturers_vendors_masters` — `Manufacturers`, `Vendors` (now `CustVendor`), `manufacturerNo`,
   `vendorNo`, `vendorId`, seed/backfill, FKs, plus `BrandMaster.ManufacturerID` FK/index.
5. `20261126140000_add_item_categories` — owner's 28 top-level categories + `categoryId` FK.
6. `20261126150000_add_classification_hierarchy` — relabels the 3 near-matching mains, seeds 11
   subcategories, backfills `subCategoryId` from the free-text label + FK.
7. `20261126160000_rename_item_categories_to_categories` — renames the table to `Categories` and
   aligns its PK/unique/self-FK/default constraint names; existing item FKs follow the rename.
8. `20261127010000_sync_item_vendor_manufacturer_keys` — normalises any drift in the two key/FK
   pairs and adds the `items_sync_master_keys` trigger described above. Applied to `dotnet_pos` on
   2026-11-27; the pre-migration audit found zero mismatches in either pair.
9. `20261127020000_add_locations_master` — creates `dbo.Locations` with the 17 shelf labels above.
   No item column or FK is added; the Item Master dropdown stores `LocationNameEn` in the existing
   app-level `Item.location` text.
10. `20261127030000_seed_brand_master` — seeds the 131 approved brands with stable
    `BR-0001..BR-0131` codes and Arabic-script transliterations; guarded by id and code.
11. `20261127100000_add_item_cost_price` — adds the optional `costPrice` column beside `basePrice`.
12. `20261127110000_rename_vendors_to_custvendor` — renames `dbo.Vendors` to `dbo.CustVendor` and
    aligns its constraint names. The `items_sync_master_keys` trigger is recreated so its saved body
    resolves the new table name.
13. `20261127120000_reorder_item_boolean_columns` — re-adds all nine `BIT` columns on `dbo.items` so
    they are physically last, restoring values/defaults and the `isActive` index. No data is lost.

Each migration is idempotent (`COL_LENGTH`, `OBJECT_ID`, `sys.indexes`, `sys.foreign_keys` guards),
wrapped in a transaction, and uses `NO ACTION` referential actions. No data is deleted; unmatched
legacy values stay `NULL` and continue to work as before.

## Not included yet

The Excel importer (`server/src/routes/items.ts`) and the Item Master form write the text keys
`vendorNo` and `manufacturerNo`; the `items_sync_master_keys` trigger fills/clears the matching FKs.
The Item Master form now picks Brand, Unit and Location from `dbo.BrandMaster` / `dbo.Units` /
`dbo.Locations` and exposes all six remaining SQL booleans as independent switches
(`requiresPrescription`, `isControlledDrug`, `isTaxable`, `isTemperatureSensitive`,
`requiresSerialNumber`, `isNarcotic`) plus the existing batch/expiry/active toggles. Boot sync reads
those flags and `brandId` from `/api/items` so every branch sees the same master values. The Excel
importer still writes free text and does not resolve those masters; editing the other new columns
from spreadsheets remains a separate change, so they stay `NULL` until set through the form.
