-- Item Categories master: a shared lookup for the Item Master and Excel importer. Items keep their
-- existing free-text `category` label for POS/cost-center rules and gain a stable `categoryId` FK.
-- The 28 seeded rows are the owner's approved bilingual list; all are top-level (ParentCategoryID NULL).

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[ItemCategories]', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[ItemCategories] (
        [CategoryID] INT IDENTITY(1, 1) NOT NULL
            CONSTRAINT [ItemCategories_pkey] PRIMARY KEY CLUSTERED,
        [CategoryCode] NVARCHAR(50) NOT NULL
            CONSTRAINT [ItemCategories_CategoryCode_key] UNIQUE NONCLUSTERED,
        [CategoryNameAr] NVARCHAR(150) NOT NULL,
        [CategoryNameEn] NVARCHAR(150) NOT NULL,
        [ParentCategoryID] INT NULL,
        [IsActive] BIT NOT NULL CONSTRAINT [DF_ItemCategories_IsActive] DEFAULT 1,
        CONSTRAINT [ItemCategories_ParentCategoryID_fkey]
            FOREIGN KEY ([ParentCategoryID]) REFERENCES [dbo].[ItemCategories]([CategoryID])
            ON DELETE NO ACTION ON UPDATE NO ACTION
    );
END;

-- Explicit ids keep the seed deterministic across every branch database. The NOT EXISTS guard makes
-- the migration safe if the table already existed with some of these codes.
SET IDENTITY_INSERT [dbo].[ItemCategories] ON;

;WITH [seed] ([CategoryID], [CategoryCode], [CategoryNameAr], [CategoryNameEn]) AS (
    SELECT * FROM (VALUES
        (1,  N'CAT-001', N'أدوية', N'Medicines'),
        (2,  N'CAT-002', N'مستلزمات طبية', N'Medical Supplies'),
        (3,  N'CAT-003', N'حفائض', N'Diapers'),
        (4,  N'CAT-004', N'مستحضرات تجميل', N'Cosmetics'),
        (5,  N'CAT-005', N'منتجات العناية بالبشرة', N'Skin Care Products'),
        (6,  N'CAT-006', N'منتجات العناية بالشعر', N'Hair Care Products'),
        (7,  N'CAT-007', N'منتجات العناية بالفم والأسنان', N'Oral & Dental Care'),
        (8,  N'CAT-008', N'الفيتامينات والمكملات الغذائية', N'Vitamins & Supplements'),
        (9,  N'CAT-009', N'منتجات الأطفال والرضع', N'Baby Care Products'),
        (10, N'CAT-010', N'منتجات الأمومة', N'Maternity Products'),
        (11, N'CAT-011', N'منتجات النظافة الشخصية', N'Personal Hygiene Products'),
        (12, N'CAT-012', N'المطهرات والمعقمات', N'Disinfectants & Sanitizers'),
        (13, N'CAT-013', N'الإسعافات الأولية', N'First Aid Products'),
        (14, N'CAT-014', N'الأجهزة والمعدات الطبية', N'Medical Devices & Equipment'),
        (15, N'CAT-015', N'أجهزة قياس السكر والضغط', N'Glucose & Blood Pressure Monitors'),
        (16, N'CAT-016', N'مستلزمات مرضى السكري', N'Diabetic Supplies'),
        (17, N'CAT-017', N'مستلزمات العظام والمفاصل', N'Orthopedic Supplies'),
        (18, N'CAT-018', N'مستلزمات الجروح والضمادات', N'Wound Care & Dressings'),
        (19, N'CAT-019', N'منتجات العناية بالعيون', N'Eye Care Products'),
        (20, N'CAT-020', N'منتجات العناية بالأذن', N'Ear Care Products'),
        (21, N'CAT-021', N'منتجات التخسيس والتغذية', N'Weight Management & Nutrition'),
        (22, N'CAT-022', N'منتجات العناية بالقدم', N'Foot Care Products'),
        (23, N'CAT-023', N'منتجات الحماية والوقاية', N'Protective Products'),
        (24, N'CAT-024', N'مستلزمات كبار السن', N'Elderly Care Products'),
        (25, N'CAT-025', N'مستلزمات طبية استهلاكية', N'Disposable Medical Supplies'),
        (26, N'CAT-026', N'أغذية ومشروبات صحية', N'Health Foods & Beverages'),
        (27, N'CAT-027', N'منتجات طبيعية وعشبية', N'Herbal & Natural Products'),
        (28, N'CAT-028', N'منتجات موسمية', N'Seasonal Products')
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

IF COL_LENGTH(N'[dbo].[items]', N'categoryId') IS NULL
BEGIN
    ALTER TABLE [dbo].[items] ADD [categoryId] INT NULL;
END;

IF NOT EXISTS (
    SELECT 1 FROM [sys].[indexes]
    WHERE [name] = N'items_categoryId_idx' AND [object_id] = OBJECT_ID(N'[dbo].[items]')
)
BEGIN
    CREATE INDEX [items_categoryId_idx] ON [dbo].[items]([categoryId]);
END;

IF NOT EXISTS (SELECT 1 FROM [sys].[foreign_keys] WHERE [name] = N'items_categoryId_fkey')
BEGIN
    ALTER TABLE [dbo].[items] WITH CHECK ADD CONSTRAINT [items_categoryId_fkey]
        FOREIGN KEY ([categoryId]) REFERENCES [dbo].[ItemCategories]([CategoryID])
        ON DELETE NO ACTION ON UPDATE NO ACTION;
END;

COMMIT TRAN;

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
