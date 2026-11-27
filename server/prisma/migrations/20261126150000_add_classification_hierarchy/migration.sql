-- Three-level classification: Main Category -> Subcategory -> Item.
-- Reuses the owner's 28 top-level categories (migration 20261126140000) instead of adding
-- near-duplicate mains: only the three requested labels that differed are renamed, keeping their
-- CategoryID / CategoryCode and every existing item link intact. Subcategories 32-42 are children
-- of those mains. items.subCategoryId gets the FK and is backfilled from the existing free-text
-- category label where it matches a seeded subcategory exactly.

BEGIN TRY

BEGIN TRAN;

-- Relabel only the three near-matching mains to the owner's requested bilingual names. The guards
-- on the old English names make a rerun a no-op and preserve any later manual rename.
UPDATE [dbo].[ItemCategories]
SET [CategoryNameAr] = N'منتجات الأطفال', [CategoryNameEn] = N'Baby Products'
WHERE [CategoryCode] = N'CAT-009' AND [CategoryNameEn] = N'Baby Care Products';

UPDATE [dbo].[ItemCategories]
SET [CategoryNameAr] = N'عناية شخصية', [CategoryNameEn] = N'Personal Care'
WHERE [CategoryCode] = N'CAT-011' AND [CategoryNameEn] = N'Personal Hygiene Products';

UPDATE [dbo].[ItemCategories]
SET [CategoryNameAr] = N'أجهزة طبية', [CategoryNameEn] = N'Medical Devices'
WHERE [CategoryCode] = N'CAT-014' AND [CategoryNameEn] = N'Medical Devices & Equipment';

SET IDENTITY_INSERT [dbo].[ItemCategories] ON;

;WITH [seed] ([CategoryID], [CategoryCode], [CategoryNameAr], [CategoryNameEn], [ParentCategoryID]) AS (
    SELECT * FROM (VALUES
        -- Subcategories under Medicines (CAT-001).
        (32, N'CAT-032', N'مضادات حيوية', N'Antibiotics', 1),
        (33, N'CAT-033', N'مسكنات', N'Painkillers', 1),
        (34, N'CAT-034', N'فيتامينات', N'Vitamins', 1),
        -- Subcategories under Medical Supplies (CAT-002).
        (35, N'CAT-035', N'محاقن', N'Syringes', 2),
        (36, N'CAT-036', N'ضمادات', N'Bandages', 2),
        -- Subcategories under Diapers (CAT-003).
        (37, N'CAT-037', N'حفائض أطفال', N'Baby Diapers', 3),
        (38, N'CAT-038', N'حفائض كبار السن', N'Adult Diapers', 3),
        -- Subcategory under Cosmetics (CAT-004).
        (39, N'CAT-039', N'كريمات الوجه', N'Facial Cream', 4),
        -- Subcategories under the relabelled existing mains: 011 Personal Care, 009 Baby Products,
        -- 014 Medical Devices. No duplicate main rows are created.
        (40, N'CAT-040', N'شامبو', N'Shampoo', 11),
        (41, N'CAT-041', N'حليب أطفال', N'Baby Formula', 9),
        (42, N'CAT-042', N'جهاز ضغط', N'Blood Pressure Monitor', 14)
    ) AS [v] ([CategoryID], [CategoryCode], [CategoryNameAr], [CategoryNameEn], [ParentCategoryID])
)
INSERT INTO [dbo].[ItemCategories]
    ([CategoryID], [CategoryCode], [CategoryNameAr], [CategoryNameEn], [ParentCategoryID], [IsActive])
SELECT
    [s].[CategoryID], [s].[CategoryCode], [s].[CategoryNameAr], [s].[CategoryNameEn], [s].[ParentCategoryID], 1
FROM [seed] AS [s]
WHERE NOT EXISTS (
    SELECT 1 FROM [dbo].[ItemCategories] AS [c]
    WHERE [c].[CategoryID] = [s].[CategoryID] OR [c].[CategoryCode] = [s].[CategoryCode]
);

SET IDENTITY_INSERT [dbo].[ItemCategories] OFF;

IF COL_LENGTH(N'[dbo].[items]', N'subCategoryId') IS NULL
    ALTER TABLE [dbo].[items] ADD [subCategoryId] INT NULL;

-- Only exact English/Arabic label matches are linked; anything else stays NULL rather than being
-- guessed. When a subcategory matches, its main category is set too, so the hierarchy is coherent.
-- sp_executesql defers compilation until after subCategoryId is added above (else error 207).
EXEC sp_executesql N'
UPDATE [i]
SET [subCategoryId] = [c].[CategoryID],
    [categoryId] = [c].[ParentCategoryID]
FROM [dbo].[items] AS [i]
JOIN [dbo].[ItemCategories] AS [c]
    ON [c].[ParentCategoryID] IS NOT NULL
    AND (
        [c].[CategoryNameEn] = LTRIM(RTRIM([i].[category]))
        OR [c].[CategoryNameAr] = LTRIM(RTRIM([i].[category]))
    )
WHERE [i].[subCategoryId] IS NULL OR [i].[categoryId] IS NULL;
';

IF NOT EXISTS (SELECT 1 FROM [sys].[indexes] WHERE [name] = N'items_subCategoryId_idx' AND [object_id] = OBJECT_ID(N'[dbo].[items]'))
    EXEC sp_executesql N'CREATE INDEX [items_subCategoryId_idx] ON [dbo].[items]([subCategoryId]);';

IF NOT EXISTS (SELECT 1 FROM [sys].[foreign_keys] WHERE [name] = N'items_subCategoryId_fkey')
    EXEC sp_executesql N'
    ALTER TABLE [dbo].[items] WITH CHECK ADD CONSTRAINT [items_subCategoryId_fkey]
        FOREIGN KEY ([subCategoryId]) REFERENCES [dbo].[ItemCategories]([CategoryID])
        ON DELETE NO ACTION ON UPDATE NO ACTION;
    ';

COMMIT TRAN;

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
