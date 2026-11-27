-- Manufacturer / company and purchasing-party masters for the Item Master.
-- Seeds mirror src/utils/seedData.ts so the DB uses the same stable numbers the app UI already
-- stores in Item.manufacturerNo / Item.vendorNo. Existing item rows are backfilled by those keys;
-- unmatched rows stay NULL and keep selling. All new item columns are nullable.

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[Manufacturers]', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[Manufacturers] (
        [ManufacturerID] INT IDENTITY(1, 1) NOT NULL
            CONSTRAINT [Manufacturers_pkey] PRIMARY KEY CLUSTERED,
        [CompanyNo] INT NOT NULL
            CONSTRAINT [Manufacturers_CompanyNo_key] UNIQUE NONCLUSTERED,
        [ManufacturerNameAr] NVARCHAR(150) NOT NULL,
        [ManufacturerNameEn] NVARCHAR(150) NOT NULL,
        [Details] NVARCHAR(2000) NULL,
        [IsActive] BIT NOT NULL CONSTRAINT [DF_Manufacturers_IsActive] DEFAULT 1,
        [UpdatedAt] DATETIME2 NULL
    );
END;

IF OBJECT_ID(N'[dbo].[Vendors]', N'U') IS NULL
BEGIN
    -- Like the app's purchasingStore.vendors: suppliers (1) and business customers (2) share
    -- one FCODCSVN-style party table. Item.vendorNo may reference either row.
    CREATE TABLE [dbo].[Vendors] (
        [VendorID] INT IDENTITY(1, 1) NOT NULL
            CONSTRAINT [Vendors_pkey] PRIMARY KEY CLUSTERED,
        [VendorNo] NVARCHAR(50) NOT NULL
            CONSTRAINT [Vendors_VendorNo_key] UNIQUE NONCLUSTERED,
        [TypeFlag] INT NOT NULL,
        [VendorNameAr] NVARCHAR(150) NOT NULL,
        [VendorNameEn] NVARCHAR(150) NOT NULL,
        [Phone] NVARCHAR(50) NOT NULL,
        [VatNumber] NVARCHAR(50) NULL,
        [Category] NVARCHAR(100) NULL,
        [CreditLimit] DECIMAL(12, 2) NULL,
        [SettlementDays] INT NULL,
        [VatType] INT NULL,
        [GlnNo] NVARCHAR(50) NULL,
        [BonusDiscountSetNo] INT NULL,
        [LimitationSetNo] INT NULL,
        [Notes] NVARCHAR(2000) NULL,
        [IsActive] BIT NOT NULL CONSTRAINT [DF_Vendors_IsActive] DEFAULT 1,
        [UpdatedAt] DATETIME2 NULL,
        CONSTRAINT [Vendors_TypeFlag_chk] CHECK ([TypeFlag] IN (1, 2))
    );
END;

IF NOT EXISTS (SELECT 1 FROM [sys].[check_constraints] WHERE [name] = N'Vendors_TypeFlag_chk')
    ALTER TABLE [dbo].[Vendors] WITH CHECK ADD CONSTRAINT [Vendors_TypeFlag_chk]
        CHECK ([TypeFlag] IN (1, 2));

-- ManufacturerID intentionally equals CompanyNo for the seeded rows: it keeps backfill from the
-- frontend's numeric manufacturerNo a simple, deterministic conversion.
SET IDENTITY_INSERT [dbo].[Manufacturers] ON;

;WITH [seed] ([ManufacturerID], [CompanyNo], [ManufacturerNameAr], [ManufacturerNameEn], [Details]) AS (
    SELECT * FROM (VALUES
        (1, 1, N'شركة تبوك للصناعات الدوائية', N'Tabuk Pharmaceuticals', N'Tabuk plant · SFDA licence 1024 · 011 000 0001'),
        (2, 2, N'شركة جمجوم فارما', N'Jamjoom Pharma', N'Jeddah plant · SFDA licence 1188 · 012 000 0002'),
        (3, 3, N'الشركة السعودية للصناعات الدوائية (سبيماكو)', N'SPIMACO', N'Qassim plant · SFDA licence 1007 · 016 000 0003'),
        (4, 4, N'شركة الرياض فارما', N'Riyadh Pharma', N'Riyadh plant · SFDA licence 1212 · 011 000 0004'),
        (5, 5, N'شركة سجا للصناعات الدوائية', N'SAJA Pharmaceuticals', N'Jeddah plant · SFDA licence 1305 · 012 000 0005')
    ) AS [v] ([ManufacturerID], [CompanyNo], [ManufacturerNameAr], [ManufacturerNameEn], [Details])
)
INSERT INTO [dbo].[Manufacturers]
    ([ManufacturerID], [CompanyNo], [ManufacturerNameAr], [ManufacturerNameEn], [Details], [IsActive])
SELECT
    [s].[ManufacturerID], [s].[CompanyNo], [s].[ManufacturerNameAr], [s].[ManufacturerNameEn], [s].[Details], 1
FROM [seed] AS [s]
WHERE NOT EXISTS (
    SELECT 1 FROM [dbo].[Manufacturers] AS [m]
    WHERE [m].[ManufacturerID] = [s].[ManufacturerID] OR [m].[CompanyNo] = [s].[CompanyNo]
);

SET IDENTITY_INSERT [dbo].[Manufacturers] OFF;

SET IDENTITY_INSERT [dbo].[Vendors] ON;

;WITH [seed] (
    [VendorID], [VendorNo], [TypeFlag], [VendorNameAr], [VendorNameEn], [Phone], [VatNumber],
    [Category], [CreditLimit], [SettlementDays], [VatType], [GlnNo], [BonusDiscountSetNo],
    [LimitationSetNo], [Notes]
) AS (
    SELECT * FROM (VALUES
        (1, N'VEN-000001', 1, N'شركة الحياة لتوزيع الأدوية', N'Al-Hayat Drug Distribution Co.',
            N'0114445566', N'310555123400003', N'National distributor', CAST(50000.00 AS DECIMAL(12, 2)), 30, 1, N'6281000010001', 2, 1, N'Riyadh HQ · nationwide cold-chain delivery'),
        (2, N'VEN-000002', 1, N'مؤسسة جدة للامداد الطبي', N'Jeddah Medical Supply Est.',
            N'0126667788', N'312666987600003', N'Regional distributor', CAST(25000.00 AS DECIMAL(12, 2)), 45, 1, N'6281000020002', 1, 1, N'Jeddah · western-region deliveries'),
        (3, N'VEN-000003', 1, N'مستوردات الرياض للسوبر فود', N'Riyadh Superfood Imports',
            N'0117778899', N'300777456700003', N'Importer', CAST(15000.00 AS DECIMAL(12, 2)), 30, 1, N'6281000030003', NULL, NULL, N'Specialist food and consumer-goods importer'),
        (4, N'CUS-000001', 2, N'مركز النور الطبي', N'Al-Noor Medical Center',
            N'0114567890', N'311234567800003', N'Medical center', CAST(20000.00 AS DECIMAL(12, 2)), 30, 1, NULL, NULL, NULL, N'Outpatient clinic - monthly institutional purchases'),
        (5, N'CUS-000002', 2, N'مستشفى رعاية الرياض', N'Riyadh Care Hospital',
            N'0112345678', N'312345678900003', N'Hospital', CAST(100000.00 AS DECIMAL(12, 2)), 45, 1, NULL, NULL, NULL, N'Hospital pharmacy account - purchase orders and batch deliveries'),
        (6, N'CUS-000003', 2, N'مجمع دار الشفاء الطبي', N'Dar Al-Shifa Polyclinic',
            N'0126789012', N'313456789000003', N'Polyclinic', CAST(30000.00 AS DECIMAL(12, 2)), 30, 1, NULL, NULL, NULL, N'Jeddah polyclinic - recurring supply account')
    ) AS [v] (
        [VendorID], [VendorNo], [TypeFlag], [VendorNameAr], [VendorNameEn], [Phone], [VatNumber],
        [Category], [CreditLimit], [SettlementDays], [VatType], [GlnNo], [BonusDiscountSetNo],
        [LimitationSetNo], [Notes]
    )
)
INSERT INTO [dbo].[Vendors] (
    [VendorID], [VendorNo], [TypeFlag], [VendorNameAr], [VendorNameEn], [Phone], [VatNumber],
    [Category], [CreditLimit], [SettlementDays], [VatType], [GlnNo], [BonusDiscountSetNo],
    [LimitationSetNo], [Notes], [IsActive]
)
SELECT
    [s].[VendorID], [s].[VendorNo], [s].[TypeFlag], [s].[VendorNameAr], [s].[VendorNameEn],
    [s].[Phone], [s].[VatNumber], [s].[Category], [s].[CreditLimit], [s].[SettlementDays],
    [s].[VatType], [s].[GlnNo], [s].[BonusDiscountSetNo], [s].[LimitationSetNo], [s].[Notes], 1
FROM [seed] AS [s]
WHERE NOT EXISTS (
    SELECT 1 FROM [dbo].[Vendors] AS [v]
    WHERE [v].[VendorID] = [s].[VendorID] OR [v].[VendorNo] = [s].[VendorNo]
);

SET IDENTITY_INSERT [dbo].[Vendors] OFF;

IF COL_LENGTH(N'[dbo].[items]', N'manufacturerNo') IS NULL
    ALTER TABLE [dbo].[items] ADD [manufacturerNo] NVARCHAR(50) NULL;

IF COL_LENGTH(N'[dbo].[items]', N'vendorNo') IS NULL
    ALTER TABLE [dbo].[items] ADD [vendorNo] NVARCHAR(50) NULL;

IF COL_LENGTH(N'[dbo].[items]', N'vendorId') IS NULL
    ALTER TABLE [dbo].[items] ADD [vendorId] INT NULL;

-- Backfill from the same stable keys the frontend uses. Unparseable / unmatched text is left NULL.
-- sp_executesql defers compilation until after manufacturerNo / vendorNo / vendorId are added.
EXEC sp_executesql N'
UPDATE [i]
SET [manufacturerId] = [m].[ManufacturerID]
FROM [dbo].[items] AS [i]
JOIN [dbo].[Manufacturers] AS [m]
    ON [m].[CompanyNo] = TRY_CONVERT(INT, NULLIF(LTRIM(RTRIM([i].[manufacturerNo])), N''''))
WHERE [i].[manufacturerId] IS NULL;

UPDATE [i]
SET [vendorId] = [v].[VendorID]
FROM [dbo].[items] AS [i]
JOIN [dbo].[Vendors] AS [v]
    ON [v].[VendorNo] = LTRIM(RTRIM([i].[vendorNo]))
WHERE [i].[vendorId] IS NULL;
';

IF NOT EXISTS (SELECT 1 FROM [sys].[indexes] WHERE [name] = N'items_manufacturerNo_idx' AND [object_id] = OBJECT_ID(N'[dbo].[items]'))
    EXEC sp_executesql N'CREATE INDEX [items_manufacturerNo_idx] ON [dbo].[items]([manufacturerNo]);';

IF NOT EXISTS (SELECT 1 FROM [sys].[indexes] WHERE [name] = N'items_vendorNo_idx' AND [object_id] = OBJECT_ID(N'[dbo].[items]'))
    EXEC sp_executesql N'CREATE INDEX [items_vendorNo_idx] ON [dbo].[items]([vendorNo]);';

IF NOT EXISTS (SELECT 1 FROM [sys].[indexes] WHERE [name] = N'items_vendorId_idx' AND [object_id] = OBJECT_ID(N'[dbo].[items]'))
    EXEC sp_executesql N'CREATE INDEX [items_vendorId_idx] ON [dbo].[items]([vendorId]);';

IF NOT EXISTS (SELECT 1 FROM [sys].[foreign_keys] WHERE [name] = N'items_manufacturerId_fkey')
    EXEC sp_executesql N'
    ALTER TABLE [dbo].[items] WITH CHECK ADD CONSTRAINT [items_manufacturerId_fkey]
        FOREIGN KEY ([manufacturerId]) REFERENCES [dbo].[Manufacturers]([ManufacturerID])
        ON DELETE NO ACTION ON UPDATE NO ACTION;
    ';

IF NOT EXISTS (SELECT 1 FROM [sys].[foreign_keys] WHERE [name] = N'items_vendorId_fkey')
    EXEC sp_executesql N'
    ALTER TABLE [dbo].[items] WITH CHECK ADD CONSTRAINT [items_vendorId_fkey]
        FOREIGN KEY ([vendorId]) REFERENCES [dbo].[Vendors]([VendorID])
        ON DELETE NO ACTION ON UPDATE NO ACTION;
    ';

-- BrandMaster.ManufacturerID can only get its FK once Manufacturers exists (this migration).
IF NOT EXISTS (SELECT 1 FROM [sys].[indexes] WHERE [name] = N'BrandMaster_ManufacturerID_idx' AND [object_id] = OBJECT_ID(N'[dbo].[BrandMaster]'))
    EXEC sp_executesql N'CREATE INDEX [BrandMaster_ManufacturerID_idx] ON [dbo].[BrandMaster]([ManufacturerID]);';

IF NOT EXISTS (SELECT 1 FROM [sys].[foreign_keys] WHERE [name] = N'BrandMaster_ManufacturerID_fkey')
    EXEC sp_executesql N'
    ALTER TABLE [dbo].[BrandMaster] WITH CHECK ADD CONSTRAINT [BrandMaster_ManufacturerID_fkey]
        FOREIGN KEY ([ManufacturerID]) REFERENCES [dbo].[Manufacturers]([ManufacturerID])
        ON DELETE NO ACTION ON UPDATE NO ACTION;
    ';

COMMIT TRAN;

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
