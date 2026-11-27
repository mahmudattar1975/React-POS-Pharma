-- Recommended Item Master fields mapped onto [dbo].[items] (the Pharmacy-App item master).
-- All new columns are additive: nullable, except the Yes/No flags which get safe defaults.
-- brandId / subCategoryId / manufacturerId are ids only - those master tables do not exist yet,
-- so no foreign keys are created here. Apply with: cd server; npx prisma migrate deploy

BEGIN TRY

BEGIN TRAN;

IF COL_LENGTH(N'[dbo].[items]', N'itemNo') IS NULL
    ALTER TABLE [dbo].[items] ADD [itemNo] INT NULL;

IF COL_LENGTH(N'[dbo].[items]', N'gtin') IS NULL
    ALTER TABLE [dbo].[items] ADD [gtin] NVARCHAR(32) NULL;

IF COL_LENGTH(N'[dbo].[items]', N'brandId') IS NULL
    ALTER TABLE [dbo].[items] ADD [brandId] INT NULL;

IF COL_LENGTH(N'[dbo].[items]', N'subCategoryId') IS NULL
    ALTER TABLE [dbo].[items] ADD [subCategoryId] INT NULL;

IF COL_LENGTH(N'[dbo].[items]', N'itemType') IS NULL
    ALTER TABLE [dbo].[items] ADD [itemType] NVARCHAR(50) NULL;

IF COL_LENGTH(N'[dbo].[items]', N'genericName') IS NULL
    ALTER TABLE [dbo].[items] ADD [genericName] NVARCHAR(200) NULL;

IF COL_LENGTH(N'[dbo].[items]', N'activeIngredient') IS NULL
    ALTER TABLE [dbo].[items] ADD [activeIngredient] NVARCHAR(200) NULL;

IF COL_LENGTH(N'[dbo].[items]', N'strength') IS NULL
    ALTER TABLE [dbo].[items] ADD [strength] NVARCHAR(50) NULL;

IF COL_LENGTH(N'[dbo].[items]', N'dosageForm') IS NULL
    ALTER TABLE [dbo].[items] ADD [dosageForm] NVARCHAR(100) NULL;

IF COL_LENGTH(N'[dbo].[items]', N'routeOfAdministration') IS NULL
    ALTER TABLE [dbo].[items] ADD [routeOfAdministration] NVARCHAR(100) NULL;

IF COL_LENGTH(N'[dbo].[items]', N'manufacturerId') IS NULL
    ALTER TABLE [dbo].[items] ADD [manufacturerId] INT NULL;

IF COL_LENGTH(N'[dbo].[items]', N'countryOfOrigin') IS NULL
    ALTER TABLE [dbo].[items] ADD [countryOfOrigin] NVARCHAR(100) NULL;

IF COL_LENGTH(N'[dbo].[items]', N'packSize') IS NULL
    ALTER TABLE [dbo].[items] ADD [packSize] INT NULL;

IF COL_LENGTH(N'[dbo].[items]', N'storageCondition') IS NULL
    ALTER TABLE [dbo].[items] ADD [storageCondition] NVARCHAR(100) NULL;

IF COL_LENGTH(N'[dbo].[items]', N'requiresPrescription') IS NULL
    ALTER TABLE [dbo].[items] ADD [requiresPrescription] BIT NOT NULL
        CONSTRAINT [DF_items_requiresPrescription] DEFAULT 0;

IF COL_LENGTH(N'[dbo].[items]', N'isControlledDrug') IS NULL
    ALTER TABLE [dbo].[items] ADD [isControlledDrug] BIT NOT NULL
        CONSTRAINT [DF_items_isControlledDrug] DEFAULT 0;

IF COL_LENGTH(N'[dbo].[items]', N'isTaxable') IS NULL
    ALTER TABLE [dbo].[items] ADD [isTaxable] BIT NOT NULL
        CONSTRAINT [DF_items_isTaxable] DEFAULT 1;

IF COL_LENGTH(N'[dbo].[items]', N'minimumStock') IS NULL
    ALTER TABLE [dbo].[items] ADD [minimumStock] INT NULL;

IF COL_LENGTH(N'[dbo].[items]', N'maximumStock') IS NULL
    ALTER TABLE [dbo].[items] ADD [maximumStock] INT NULL;

IF COL_LENGTH(N'[dbo].[items]', N'isActive') IS NULL
    ALTER TABLE [dbo].[items] ADD [isActive] BIT NOT NULL
        CONSTRAINT [DF_items_isActive] DEFAULT 1;

-- controlledStatus is the detailed source (prescription / schedule_a..e). Backfill the two new
-- convenience flags so existing rows answer the same questions as newly imported rows.
-- Executed through sp_executesql so SQL Server compiles these statements AFTER the ALTER TABLE
-- statements above have added the columns. A direct UPDATE in the same batch fails with 207.
-- Only fills values that are still at their safe defaults; a rerun never clears a manual edit.
EXEC sp_executesql N'
UPDATE [dbo].[items]
SET [requiresPrescription] = 1
WHERE [controlledStatus] IS NOT NULL AND [controlledStatus] <> N'''' AND [requiresPrescription] = 0;

UPDATE [dbo].[items]
SET [isControlledDrug] = 1
WHERE [controlledStatus] LIKE N''schedule_%'' AND [isControlledDrug] = 0;
';

IF NOT EXISTS (SELECT 1 FROM [sys].[indexes] WHERE [name] = N'items_itemNo_idx' AND [object_id] = OBJECT_ID(N'[dbo].[items]'))
    EXEC sp_executesql N'CREATE INDEX [items_itemNo_idx] ON [dbo].[items]([itemNo]);';

IF NOT EXISTS (SELECT 1 FROM [sys].[indexes] WHERE [name] = N'items_gtin_idx' AND [object_id] = OBJECT_ID(N'[dbo].[items]'))
    EXEC sp_executesql N'CREATE INDEX [items_gtin_idx] ON [dbo].[items]([gtin]);';

IF NOT EXISTS (SELECT 1 FROM [sys].[indexes] WHERE [name] = N'items_brandId_idx' AND [object_id] = OBJECT_ID(N'[dbo].[items]'))
    EXEC sp_executesql N'CREATE INDEX [items_brandId_idx] ON [dbo].[items]([brandId]);';

IF NOT EXISTS (SELECT 1 FROM [sys].[indexes] WHERE [name] = N'items_subCategoryId_idx' AND [object_id] = OBJECT_ID(N'[dbo].[items]'))
    EXEC sp_executesql N'CREATE INDEX [items_subCategoryId_idx] ON [dbo].[items]([subCategoryId]);';

IF NOT EXISTS (SELECT 1 FROM [sys].[indexes] WHERE [name] = N'items_manufacturerId_idx' AND [object_id] = OBJECT_ID(N'[dbo].[items]'))
    EXEC sp_executesql N'CREATE INDEX [items_manufacturerId_idx] ON [dbo].[items]([manufacturerId]);';

IF NOT EXISTS (SELECT 1 FROM [sys].[indexes] WHERE [name] = N'items_isActive_idx' AND [object_id] = OBJECT_ID(N'[dbo].[items]'))
    EXEC sp_executesql N'CREATE INDEX [items_isActive_idx] ON [dbo].[items]([isActive]);';

COMMIT TRAN;

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
