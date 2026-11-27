-- Master tables for the two first recommended lookups: BrandMaster and Units of measure.
-- The Items columns (brandId added earlier, unitId added here) stay nullable; existing free-text
-- items.unit is preserved and backfilled to unitId where the text matches a seeded unit.
-- No brand values exist in the current catalogue, so BrandMaster starts empty.
-- ManufacturerID has no FK here: Manufacturers is created in migration 20261126120000, which adds
-- the guarded BrandMaster_ManufacturerID_fkey constraint.

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[BrandMaster]', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[BrandMaster] (
        [BrandID] INT IDENTITY(1, 1) NOT NULL
            CONSTRAINT [BrandMaster_pkey] PRIMARY KEY CLUSTERED,
        [BrandCode] NVARCHAR(50) NOT NULL
            CONSTRAINT [BrandMaster_BrandCode_key] UNIQUE NONCLUSTERED,
        [BrandNameEn] NVARCHAR(150) NOT NULL,
        [BrandNameAr] NVARCHAR(150) NOT NULL,
        [ManufacturerID] INT NULL,
        [CountryOfOrigin] NVARCHAR(100) NULL,
        [IsActive] BIT NOT NULL CONSTRAINT [DF_BrandMaster_IsActive] DEFAULT 1
    );
END;

-- Additive guards for a database where [BrandMaster] already exists with the original four
-- columns (the column names match, only the two new fields and the FK are new).
IF OBJECT_ID(N'[dbo].[BrandMaster]', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'[dbo].[BrandMaster]', N'ManufacturerID') IS NULL
        ALTER TABLE [dbo].[BrandMaster] ADD [ManufacturerID] INT NULL;

    IF COL_LENGTH(N'[dbo].[BrandMaster]', N'CountryOfOrigin') IS NULL
        ALTER TABLE [dbo].[BrandMaster] ADD [CountryOfOrigin] NVARCHAR(100) NULL;
END;

IF OBJECT_ID(N'[dbo].[Units]', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[Units] (
        [UnitID] INT IDENTITY(1, 1) NOT NULL
            CONSTRAINT [Units_pkey] PRIMARY KEY CLUSTERED,
        [UnitCode] NVARCHAR(50) NOT NULL
            CONSTRAINT [Units_UnitCode_key] UNIQUE NONCLUSTERED,
        [UnitNameAr] NVARCHAR(150) NOT NULL,
        [UnitNameEn] NVARCHAR(150) NOT NULL,
        [IsActive] BIT NOT NULL CONSTRAINT [DF_Units_IsActive] DEFAULT 1
    );
END;

-- Deterministic ids keep the seed stable across every branch database.
SET IDENTITY_INSERT [dbo].[Units] ON;

;WITH [seed] ([UnitID], [UnitCode], [UnitNameAr], [UnitNameEn]) AS (
    SELECT * FROM (VALUES
        (1,  N'BOX',     N'علبة',            N'Box'),
        (2,  N'STRIP',   N'شريط',            N'Strip'),
        (3,  N'BOTTLE',  N'زجاجة',           N'Bottle'),
        (4,  N'VIAL',    N'أمبولة',          N'Vial'),
        (5,  N'TIN',     N'علبة معدنية',     N'Tin'),
        (6,  N'CARTON',  N'كرتونة',          N'Carton'),
        (7,  N'TABLET',  N'حبة',             N'Tablet'),
        (8,  N'CAPSULE', N'كبسولة',          N'Capsule'),
        (9,  N'PACK',    N'عبوة',            N'Pack'),
        (10, N'PIECE',   N'قطعة',            N'Piece'),
        (11, N'SACHET',  N'كيس',             N'Sachet'),
        (12, N'BUTTL',   N'زجاجة (نظام XPH)', N'Bottle (ERP)'),
        (13, N'UNIT',    N'وحدة',            N'Unit'),
        (14, N'ML',      N'مل',              N'ml')
    ) AS [v] ([UnitID], [UnitCode], [UnitNameAr], [UnitNameEn])
)
INSERT INTO [dbo].[Units]
    ([UnitID], [UnitCode], [UnitNameAr], [UnitNameEn], [IsActive])
SELECT
    [s].[UnitID], [s].[UnitCode], [s].[UnitNameAr], [s].[UnitNameEn], 1
FROM [seed] AS [s]
WHERE NOT EXISTS (
    SELECT 1 FROM [dbo].[Units] AS [u]
    WHERE [u].[UnitID] = [s].[UnitID] OR [u].[UnitCode] = [s].[UnitCode]
);

SET IDENTITY_INSERT [dbo].[Units] OFF;

IF COL_LENGTH(N'[dbo].[items]', N'unitId') IS NULL
    ALTER TABLE [dbo].[items] ADD [unitId] INT NULL;

-- Match on either the ERP-style code (BUTTL) or the human-readable label (Box, Strip, ...).
-- Unmatched free text is left NULL rather than guessed; it keeps selling as before.
-- sp_executesql defers compilation until after unitId has been added above (else error 207).
EXEC sp_executesql N'
UPDATE [i]
SET [unitId] = [u].[UnitID]
FROM [dbo].[items] AS [i]
JOIN [dbo].[Units] AS [u]
    ON [u].[UnitCode] = UPPER(LTRIM(RTRIM([i].[unit])))
    OR [u].[UnitNameEn] = LTRIM(RTRIM([i].[unit]));
';

IF NOT EXISTS (SELECT 1 FROM [sys].[indexes] WHERE [name] = N'items_unitId_idx' AND [object_id] = OBJECT_ID(N'[dbo].[items]'))
    EXEC sp_executesql N'CREATE INDEX [items_unitId_idx] ON [dbo].[items]([unitId]);';

IF NOT EXISTS (SELECT 1 FROM [sys].[foreign_keys] WHERE [name] = N'items_brandId_fkey')
    EXEC sp_executesql N'
    ALTER TABLE [dbo].[items] WITH CHECK ADD CONSTRAINT [items_brandId_fkey]
        FOREIGN KEY ([brandId]) REFERENCES [dbo].[BrandMaster]([BrandID])
        ON DELETE NO ACTION ON UPDATE NO ACTION;
    ';

IF NOT EXISTS (SELECT 1 FROM [sys].[foreign_keys] WHERE [name] = N'items_unitId_fkey')
    EXEC sp_executesql N'
    ALTER TABLE [dbo].[items] WITH CHECK ADD CONSTRAINT [items_unitId_fkey]
        FOREIGN KEY ([unitId]) REFERENCES [dbo].[Units]([UnitID])
        ON DELETE NO ACTION ON UPDATE NO ACTION;
    ';

COMMIT TRAN;

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
