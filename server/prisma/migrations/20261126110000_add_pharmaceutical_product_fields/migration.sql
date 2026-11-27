-- Pharmacy-specific product fields recommended after the generic Item Master mapping.
-- Additive only: nullable text fields and booleans with safe defaults. Existing rows keep selling:
-- requiresExpiryDate defaults to 1 (normal pharmacy practice), the other flags default to 0.
-- Apply with: cd server; npx prisma migrate deploy

BEGIN TRY

BEGIN TRAN;

IF COL_LENGTH(N'[dbo].[items]', N'drugClass') IS NULL
    ALTER TABLE [dbo].[items] ADD [drugClass] NVARCHAR(100) NULL;

IF COL_LENGTH(N'[dbo].[items]', N'atcCode') IS NULL
    ALTER TABLE [dbo].[items] ADD [atcCode] NVARCHAR(20) NULL;

-- Frontend alias: Item.registrationNo ("رقم التسجيل").
IF COL_LENGTH(N'[dbo].[items]', N'sfdaRegistrationNo') IS NULL
    ALTER TABLE [dbo].[items] ADD [sfdaRegistrationNo] NVARCHAR(50) NULL;

IF COL_LENGTH(N'[dbo].[items]', N'isTemperatureSensitive') IS NULL
    ALTER TABLE [dbo].[items] ADD [isTemperatureSensitive] BIT NOT NULL
        CONSTRAINT [DF_items_isTemperatureSensitive] DEFAULT 0;

IF COL_LENGTH(N'[dbo].[items]', N'isNarcotic') IS NULL
    ALTER TABLE [dbo].[items] ADD [isNarcotic] BIT NOT NULL
        CONSTRAINT [DF_items_isNarcotic] DEFAULT 0;

IF COL_LENGTH(N'[dbo].[items]', N'requiresExpiryDate') IS NULL
    ALTER TABLE [dbo].[items] ADD [requiresExpiryDate] BIT NOT NULL
        CONSTRAINT [DF_items_requiresExpiryDate] DEFAULT 1;

IF COL_LENGTH(N'[dbo].[items]', N'requiresSerialNumber') IS NULL
    ALTER TABLE [dbo].[items] ADD [requiresSerialNumber] BIT NOT NULL
        CONSTRAINT [DF_items_requiresSerialNumber] DEFAULT 0;

-- Best-effort backfill from the existing free-text storage condition. Only sets 1 where the text
-- matches; a rerun never clears a value someone corrected by hand. Nothing is guessed for
-- isNarcotic: controlledStatus includes psychotropics too, so it cannot prove a narcotic.
-- sp_executesql defers compilation until after the new columns exist in this batch.
EXEC sp_executesql N'
UPDATE [dbo].[items]
SET [isTemperatureSensitive] = 1
WHERE [storageCondition] IS NOT NULL AND (
    [storageCondition] LIKE N''%refriger%''
    OR [storageCondition] LIKE N''%cold%''
    OR [storageCondition] LIKE N''%مبر%''
    OR [storageCondition] LIKE N''%بارد%''
);
';

IF NOT EXISTS (SELECT 1 FROM [sys].[indexes] WHERE [name] = N'items_atcCode_idx' AND [object_id] = OBJECT_ID(N'[dbo].[items]'))
    EXEC sp_executesql N'CREATE INDEX [items_atcCode_idx] ON [dbo].[items]([atcCode]);';

IF NOT EXISTS (SELECT 1 FROM [sys].[indexes] WHERE [name] = N'items_sfdaRegistrationNo_idx' AND [object_id] = OBJECT_ID(N'[dbo].[items]'))
    EXEC sp_executesql N'CREATE INDEX [items_sfdaRegistrationNo_idx] ON [dbo].[items]([sfdaRegistrationNo]);';

COMMIT TRAN;

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
