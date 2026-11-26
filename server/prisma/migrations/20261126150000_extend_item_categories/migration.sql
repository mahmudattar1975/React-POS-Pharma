-- Owner's legacy Excel labels: add dedicated master rows instead of forcing unlike descriptions
-- into an existing category, and rename CAT-011 to include BODY CARE. Excel writes the numeric
-- CategoryID; CategoryNameEn is copied into dbo.items.category by the import route.
--
-- The table was renamed to [dbo].[Categories] in a later migration while this one was still pending.
-- Both names are handled so the migration applies to a fresh database and to one already renamed.
-- Ids 43-47 continue after the hierarchy's subcategories 32-42; codes 29-33 are already taken.

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[Categories]', N'U') IS NOT NULL
BEGIN
    UPDATE [dbo].[Categories]
    SET [CategoryNameEn] = N'Personal Hygiene, Body Care'
    WHERE [CategoryCode] = N'CAT-011';

    SET IDENTITY_INSERT [dbo].[Categories] ON;

    ;WITH [seed] ([CategoryID], [CategoryCode], [CategoryNameAr], [CategoryNameEn]) AS (
        SELECT * FROM (VALUES
            (43, N'CAT-043', N'حليب', N'Milk'),
            (44, N'CAT-044', N'مستحضرات تجميل طبية', N'Medicated Cosmetics'),
            (45, N'CAT-045', N'مكياج', N'Make Up'),
            (46, N'CAT-046', N'العناية النسائية', N'Feminine Care'),
            (47, N'CAT-047', N'منتج خدمة البيع بالتجزئة', N'Retail Service Product')
        ) AS [v] ([CategoryID], [CategoryCode], [CategoryNameAr], [CategoryNameEn])
    )
    INSERT INTO [dbo].[Categories]
        ([CategoryID], [CategoryCode], [CategoryNameAr], [CategoryNameEn], [ParentCategoryID], [IsActive])
    SELECT
        [s].[CategoryID], [s].[CategoryCode], [s].[CategoryNameAr], [s].[CategoryNameEn], NULL, 1
    FROM [seed] AS [s]
    WHERE NOT EXISTS (
        SELECT 1 FROM [dbo].[Categories] AS [c]
        WHERE [c].[CategoryID] = [s].[CategoryID] OR [c].[CategoryCode] = [s].[CategoryCode]
    );

    SET IDENTITY_INSERT [dbo].[Categories] OFF;
END
ELSE IF OBJECT_ID(N'[dbo].[ItemCategories]', N'U') IS NOT NULL
BEGIN
    UPDATE [dbo].[ItemCategories]
    SET [CategoryNameEn] = N'Personal Hygiene, Body Care'
    WHERE [CategoryCode] = N'CAT-011';

    SET IDENTITY_INSERT [dbo].[ItemCategories] ON;

    ;WITH [seed] ([CategoryID], [CategoryCode], [CategoryNameAr], [CategoryNameEn]) AS (
        SELECT * FROM (VALUES
            (43, N'CAT-043', N'حليب', N'Milk'),
            (44, N'CAT-044', N'مستحضرات تجميل طبية', N'Medicated Cosmetics'),
            (45, N'CAT-045', N'مكياج', N'Make Up'),
            (46, N'CAT-046', N'العناية النسائية', N'Feminine Care'),
            (47, N'CAT-047', N'منتج خدمة البيع بالتجزئة', N'Retail Service Product')
        ) AS [v] ([CategoryID], [CategoryCode], [CategoryNameAr], [CategoryNameEn])
    )
    INSERT INTO [dbo].[ItemCategories]
        ([CategoryID], [CategoryCode], [CategoryNameAr], [CategoryNameEn], [ParentCategoryID], [IsActive])
    SELECT
        [s].[CategoryID], [s].[CategoryCode], [s].[CategoryNameAr], [s].[CategoryNameEn], NULL, 1
    FROM [seed] AS [s]
    WHERE NOT EXISTS (
        SELECT 1 FROM [dbo].[ItemCategories] AS [c]
        WHERE [c].[CategoryID] = [s].[CategoryID] OR [c].[CategoryCode] = [s].[CategoryCode]
    );

    SET IDENTITY_INSERT [dbo].[ItemCategories] OFF;
END

COMMIT TRAN;

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
