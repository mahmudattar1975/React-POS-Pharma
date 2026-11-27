-- Reorder dbo.items into ERP domain groups without changing any value, type, nullability, default,
-- key, index, FK or trigger. SQL Server has no in-place column move, so the table is rebuilt inside
-- one transaction from an explicit backup of all 44 columns.
--
-- Target order: identity/scan -> bilingual description -> classification & master links ->
-- unit/pack -> regulatory -> pricing/tax -> stock policy -> boolean flags (last).
-- Column order is a maintainability decision, not a performance claim; the existing barcode exact
-- match still uses items_barcode_key (Index Seek / 4 logical reads on the current single-row table).

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'tempdb..#items_reorder_backup', N'U') IS NOT NULL
    DROP TABLE #items_reorder_backup;

SELECT
    [id], [itemNo], [barcode], [gtin],
    [nameAr], [nameEn], [genericName], [activeIngredient], [strength], [dosageForm], [routeOfAdministration],
    [categoryId], [subCategoryId], [category], [brandId], [itemType],
    [manufacturerId], [manufacturerNo], [vendorId], [vendorNo],
    [unitId], [unit], [packSize],
    [controlledStatus], [drugClass], [atcCode], [sfdaRegistrationNo], [countryOfOrigin], [storageCondition],
    [basePrice], [costPrice], [vatRate],
    [reorderLevel], [minimumStock], [maximumStock],
    [isActive], [requiresBatchTracking], [requiresExpiryDate], [requiresSerialNumber],
    [requiresPrescription], [isControlledDrug], [isNarcotic], [isTaxable], [isTemperatureSensitive]
INTO #items_reorder_backup
FROM [dbo].[items];

-- Keep the saved trigger body; sp_rename/drop does not keep it for us. It references [dbo].[items]
-- by name, so it can be executed unchanged after the new table is in place.
DECLARE @triggerSql NVARCHAR(MAX) = OBJECT_DEFINITION(OBJECT_ID(N'dbo.items_sync_master_keys', N'TR'));

-- Inbound FKs must go before the table can be dropped. Outbound FKs, indexes and defaults are
-- removed with the table itself and are recreated below exactly as they were.
IF EXISTS (SELECT 1 FROM [sys].[foreign_keys] WHERE [name] = N'batches_itemId_fkey')
    ALTER TABLE [dbo].[batches] DROP CONSTRAINT [batches_itemId_fkey];
IF EXISTS (SELECT 1 FROM [sys].[foreign_keys] WHERE [name] = N'ItemBarcodes_ItemId_fkey')
    ALTER TABLE [dbo].[ItemBarcodes] DROP CONSTRAINT [ItemBarcodes_ItemId_fkey];
IF EXISTS (SELECT 1 FROM [sys].[foreign_keys] WHERE [name] = N'offers_itemId_fkey')
    ALTER TABLE [dbo].[offers] DROP CONSTRAINT [offers_itemId_fkey];

IF OBJECT_ID(N'dbo.items_sync_master_keys', N'TR') IS NOT NULL
    DROP TRIGGER [dbo].[items_sync_master_keys];

DROP TABLE [dbo].[items];

-- Deferred compilation: create the ordered table, copy every row, then restore all constraints and
-- indexes in one batch after the old object names have been released.
EXEC sp_executesql N'
CREATE TABLE [dbo].[items] (
    -- 1. Identity and scannable codes. Barcode stays NVARCHAR(100) text to preserve leading zeros.
    [id] NVARCHAR(100) NOT NULL,
    [itemNo] INT NULL,
    [barcode] NVARCHAR(100) NOT NULL,
    [gtin] NVARCHAR(32) NULL,

    -- 2. Bilingual and pharmaceutical description.
    [nameAr] NVARCHAR(100) NOT NULL,
    [nameEn] NVARCHAR(100) NOT NULL,
    [genericName] NVARCHAR(200) NULL,
    [activeIngredient] NVARCHAR(200) NULL,
    [strength] NVARCHAR(50) NULL,
    [dosageForm] NVARCHAR(100) NULL,
    [routeOfAdministration] NVARCHAR(100) NULL,

    -- 3. Classification and master links. Text keys sit beside the FKs they mirror.
    [categoryId] INT NULL,
    [subCategoryId] INT NULL,
    [category] NVARCHAR(100) NOT NULL,
    [brandId] INT NULL,
    [itemType] NVARCHAR(50) NULL,
    [manufacturerId] INT NULL,
    [manufacturerNo] NVARCHAR(50) NULL,
    [vendorId] INT NULL,
    [vendorNo] NVARCHAR(50) NULL,

    -- 4. Unit of measure and pack ladder.
    [unitId] INT NULL,
    [unit] NVARCHAR(100) NOT NULL,
    [packSize] INT NULL,

    -- 5. Regulatory / pharmaceutical metadata.
    [controlledStatus] NVARCHAR(100) NULL,
    [drugClass] NVARCHAR(100) NULL,
    [atcCode] NVARCHAR(20) NULL,
    [sfdaRegistrationNo] NVARCHAR(50) NULL,
    [countryOfOrigin] NVARCHAR(100) NULL,
    [storageCondition] NVARCHAR(100) NULL,

    -- 6. Pricing and tax. Decimal money columns, never float.
    [basePrice] DECIMAL(12, 3) NOT NULL,
    [costPrice] DECIMAL(12, 3) NULL,
    [vatRate] DECIMAL(6, 4) NOT NULL,

    -- 7. Stock policy thresholds.
    [reorderLevel] INT NOT NULL,
    [minimumStock] INT NULL,
    [maximumStock] INT NULL,

    -- 8. Boolean flags, always last. Operational flags first, then clinical/financial flags.
    [isActive] BIT NOT NULL CONSTRAINT [DF_items_isActive] DEFAULT (1),
    [requiresBatchTracking] BIT NOT NULL,
    [requiresExpiryDate] BIT NOT NULL CONSTRAINT [DF_items_requiresExpiryDate] DEFAULT (1),
    [requiresSerialNumber] BIT NOT NULL CONSTRAINT [DF_items_requiresSerialNumber] DEFAULT (0),
    [requiresPrescription] BIT NOT NULL CONSTRAINT [DF_items_requiresPrescription] DEFAULT (0),
    [isControlledDrug] BIT NOT NULL CONSTRAINT [DF_items_isControlledDrug] DEFAULT (0),
    [isNarcotic] BIT NOT NULL CONSTRAINT [DF_items_isNarcotic] DEFAULT (0),
    [isTaxable] BIT NOT NULL CONSTRAINT [DF_items_isTaxable] DEFAULT (1),
    [isTemperatureSensitive] BIT NOT NULL CONSTRAINT [DF_items_isTemperatureSensitive] DEFAULT (0),

    CONSTRAINT [items_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [items_barcode_key] UNIQUE NONCLUSTERED ([barcode])
);

INSERT INTO [dbo].[items] (
    [id], [itemNo], [barcode], [gtin],
    [nameAr], [nameEn], [genericName], [activeIngredient], [strength], [dosageForm], [routeOfAdministration],
    [categoryId], [subCategoryId], [category], [brandId], [itemType],
    [manufacturerId], [manufacturerNo], [vendorId], [vendorNo],
    [unitId], [unit], [packSize],
    [controlledStatus], [drugClass], [atcCode], [sfdaRegistrationNo], [countryOfOrigin], [storageCondition],
    [basePrice], [costPrice], [vatRate],
    [reorderLevel], [minimumStock], [maximumStock],
    [isActive], [requiresBatchTracking], [requiresExpiryDate], [requiresSerialNumber],
    [requiresPrescription], [isControlledDrug], [isNarcotic], [isTaxable], [isTemperatureSensitive]
)
SELECT
    [id], [itemNo], [barcode], [gtin],
    [nameAr], [nameEn], [genericName], [activeIngredient], [strength], [dosageForm], [routeOfAdministration],
    [categoryId], [subCategoryId], [category], [brandId], [itemType],
    [manufacturerId], [manufacturerNo], [vendorId], [vendorNo],
    [unitId], [unit], [packSize],
    [controlledStatus], [drugClass], [atcCode], [sfdaRegistrationNo], [countryOfOrigin], [storageCondition],
    [basePrice], [costPrice], [vatRate],
    [reorderLevel], [minimumStock], [maximumStock],
    [isActive], [requiresBatchTracking], [requiresExpiryDate], [requiresSerialNumber],
    [requiresPrescription], [isControlledDrug], [isNarcotic], [isTaxable], [isTemperatureSensitive]
FROM #items_reorder_backup;

-- Outbound FKs (NO ACTION both sides).
ALTER TABLE [dbo].[items] WITH CHECK ADD CONSTRAINT [items_brandId_fkey]
    FOREIGN KEY ([brandId]) REFERENCES [dbo].[BrandMaster]([BrandID]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[items] WITH CHECK ADD CONSTRAINT [items_categoryId_fkey]
    FOREIGN KEY ([categoryId]) REFERENCES [dbo].[Categories]([CategoryID]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[items] WITH CHECK ADD CONSTRAINT [items_subCategoryId_fkey]
    FOREIGN KEY ([subCategoryId]) REFERENCES [dbo].[Categories]([CategoryID]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[items] WITH CHECK ADD CONSTRAINT [items_manufacturerId_fkey]
    FOREIGN KEY ([manufacturerId]) REFERENCES [dbo].[Manufacturers]([ManufacturerID]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[items] WITH CHECK ADD CONSTRAINT [items_unitId_fkey]
    FOREIGN KEY ([unitId]) REFERENCES [dbo].[Units]([UnitID]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[items] WITH CHECK ADD CONSTRAINT [items_vendorId_fkey]
    FOREIGN KEY ([vendorId]) REFERENCES [dbo].[CustVendor]([VendorID]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Inbound FKs: preserve their original cascade behaviour exactly.
ALTER TABLE [dbo].[batches] WITH CHECK ADD CONSTRAINT [batches_itemId_fkey]
    FOREIGN KEY ([itemId]) REFERENCES [dbo].[items]([id]) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE [dbo].[ItemBarcodes] WITH CHECK ADD CONSTRAINT [ItemBarcodes_ItemId_fkey]
    FOREIGN KEY ([ItemId]) REFERENCES [dbo].[items]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE [dbo].[offers] WITH CHECK ADD CONSTRAINT [offers_itemId_fkey]
    FOREIGN KEY ([itemId]) REFERENCES [dbo].[items]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- Nonclustered indexes. items_pkey and items_barcode_key are already in CREATE TABLE.
CREATE INDEX [items_atcCode_idx] ON [dbo].[items]([atcCode]);
CREATE INDEX [items_brandId_idx] ON [dbo].[items]([brandId]);
CREATE INDEX [items_categoryId_idx] ON [dbo].[items]([categoryId]);
CREATE INDEX [items_gtin_idx] ON [dbo].[items]([gtin]);
CREATE INDEX [items_isActive_idx] ON [dbo].[items]([isActive]);
CREATE INDEX [items_itemNo_idx] ON [dbo].[items]([itemNo]);
CREATE INDEX [items_manufacturerId_idx] ON [dbo].[items]([manufacturerId]);
CREATE INDEX [items_manufacturerNo_idx] ON [dbo].[items]([manufacturerNo]);
CREATE INDEX [items_sfdaRegistrationNo_idx] ON [dbo].[items]([sfdaRegistrationNo]);
CREATE INDEX [items_subCategoryId_idx] ON [dbo].[items]([subCategoryId]);
CREATE INDEX [items_unitId_idx] ON [dbo].[items]([unitId]);
CREATE INDEX [items_vendorId_idx] ON [dbo].[items]([vendorId]);
CREATE INDEX [items_vendorNo_idx] ON [dbo].[items]([vendorNo]);
';

IF @triggerSql IS NOT NULL
    EXEC sp_executesql @triggerSql;

COMMIT TRAN;

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
