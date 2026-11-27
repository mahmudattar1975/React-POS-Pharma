-- SQL Server has no "move column" operation. Re-add the nine BIT columns on dbo.items so they are
-- physically the last columns in the table, preserving every value, default and the isActive index.
-- All other columns, constraints, FKs and the items_sync_master_keys trigger are left in place.
-- The transaction makes this all-or-nothing; rerunning is safe because the columns are rebuilt from
-- a backup of their current values.

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'tempdb..#items_bool_backup', N'U') IS NOT NULL
    DROP TABLE #items_bool_backup;

SELECT
    [id],
    [isTemperatureSensitive],
    [requiresPrescription],
    [isControlledDrug],
    [isNarcotic],
    [isTaxable],
    [isActive],
    [requiresBatchTracking],
    [requiresExpiryDate],
    [requiresSerialNumber]
INTO #items_bool_backup
FROM [dbo].[items];

-- Drop the defaults before dropping the columns, and remember the existing isActive index name so
-- it can be recreated unchanged.
IF EXISTS (SELECT 1 FROM [sys].[default_constraints]
           WHERE [parent_object_id] = OBJECT_ID(N'[dbo].[items]') AND [name] = N'DF_items_isTemperatureSensitive')
    ALTER TABLE [dbo].[items] DROP CONSTRAINT [DF_items_isTemperatureSensitive];
IF EXISTS (SELECT 1 FROM [sys].[default_constraints]
           WHERE [parent_object_id] = OBJECT_ID(N'[dbo].[items]') AND [name] = N'DF_items_requiresPrescription')
    ALTER TABLE [dbo].[items] DROP CONSTRAINT [DF_items_requiresPrescription];
IF EXISTS (SELECT 1 FROM [sys].[default_constraints]
           WHERE [parent_object_id] = OBJECT_ID(N'[dbo].[items]') AND [name] = N'DF_items_isControlledDrug')
    ALTER TABLE [dbo].[items] DROP CONSTRAINT [DF_items_isControlledDrug];
IF EXISTS (SELECT 1 FROM [sys].[default_constraints]
           WHERE [parent_object_id] = OBJECT_ID(N'[dbo].[items]') AND [name] = N'DF_items_isNarcotic')
    ALTER TABLE [dbo].[items] DROP CONSTRAINT [DF_items_isNarcotic];
IF EXISTS (SELECT 1 FROM [sys].[default_constraints]
           WHERE [parent_object_id] = OBJECT_ID(N'[dbo].[items]') AND [name] = N'DF_items_isTaxable')
    ALTER TABLE [dbo].[items] DROP CONSTRAINT [DF_items_isTaxable];
IF EXISTS (SELECT 1 FROM [sys].[default_constraints]
           WHERE [parent_object_id] = OBJECT_ID(N'[dbo].[items]') AND [name] = N'DF_items_isActive')
    ALTER TABLE [dbo].[items] DROP CONSTRAINT [DF_items_isActive];
IF EXISTS (SELECT 1 FROM [sys].[default_constraints]
           WHERE [parent_object_id] = OBJECT_ID(N'[dbo].[items]') AND [name] = N'DF_items_requiresExpiryDate')
    ALTER TABLE [dbo].[items] DROP CONSTRAINT [DF_items_requiresExpiryDate];
IF EXISTS (SELECT 1 FROM [sys].[default_constraints]
           WHERE [parent_object_id] = OBJECT_ID(N'[dbo].[items]') AND [name] = N'DF_items_requiresSerialNumber')
    ALTER TABLE [dbo].[items] DROP CONSTRAINT [DF_items_requiresSerialNumber];

DECLARE @isActiveIndexName sysname = NULL;
DECLARE @indexSql NVARCHAR(MAX);

SELECT @isActiveIndexName = i.[name]
FROM [sys].[indexes] AS i
JOIN [sys].[index_columns] AS ic
    ON ic.[object_id] = i.[object_id] AND ic.[index_id] = i.[index_id]
JOIN [sys].[columns] AS c
    ON c.[object_id] = ic.[object_id] AND c.[column_id] = ic.[column_id]
WHERE i.[object_id] = OBJECT_ID(N'[dbo].[items]')
  AND c.[name] = N'isActive'
  AND i.[name] IS NOT NULL;

IF @isActiveIndexName IS NOT NULL
BEGIN
    SET @indexSql = N'DROP INDEX ' + QUOTENAME(@isActiveIndexName) + N' ON [dbo].[items];';
    EXEC sp_executesql @indexSql;
END;

ALTER TABLE [dbo].[items] DROP COLUMN
    [isTemperatureSensitive],
    [requiresPrescription],
    [isControlledDrug],
    [isNarcotic],
    [isTaxable],
    [isActive],
    [requiresBatchTracking],
    [requiresExpiryDate],
    [requiresSerialNumber];

-- Re-add in the desired order. requiresBatchTracking had no default originally, so it gets a
-- temporary one for the NOT NULL add and that default is dropped once the values are restored.
-- sp_executesql defers compilation until after the DROP COLUMN above has committed in this batch.
EXEC sp_executesql N'
ALTER TABLE [dbo].[items] ADD
    [isTemperatureSensitive] BIT NOT NULL CONSTRAINT [DF_items_isTemperatureSensitive] DEFAULT (0),
    [requiresPrescription] BIT NOT NULL CONSTRAINT [DF_items_requiresPrescription] DEFAULT (0),
    [isControlledDrug] BIT NOT NULL CONSTRAINT [DF_items_isControlledDrug] DEFAULT (0),
    [isNarcotic] BIT NOT NULL CONSTRAINT [DF_items_isNarcotic] DEFAULT (0),
    [isTaxable] BIT NOT NULL CONSTRAINT [DF_items_isTaxable] DEFAULT (1),
    [isActive] BIT NOT NULL CONSTRAINT [DF_items_isActive] DEFAULT (1),
    [requiresBatchTracking] BIT NOT NULL CONSTRAINT [DF_items_requiresBatchTracking_tmp] DEFAULT (0),
    [requiresExpiryDate] BIT NOT NULL CONSTRAINT [DF_items_requiresExpiryDate] DEFAULT (1),
    [requiresSerialNumber] BIT NOT NULL CONSTRAINT [DF_items_requiresSerialNumber] DEFAULT (0);
';

EXEC sp_executesql N'
UPDATE i
   SET [isTemperatureSensitive] = b.[isTemperatureSensitive],
       [requiresPrescription] = b.[requiresPrescription],
       [isControlledDrug] = b.[isControlledDrug],
       [isNarcotic] = b.[isNarcotic],
       [isTaxable] = b.[isTaxable],
       [isActive] = b.[isActive],
       [requiresBatchTracking] = b.[requiresBatchTracking],
       [requiresExpiryDate] = b.[requiresExpiryDate],
       [requiresSerialNumber] = b.[requiresSerialNumber]
  FROM [dbo].[items] AS i
  JOIN #items_bool_backup AS b ON b.[id] = i.[id];

ALTER TABLE [dbo].[items] DROP CONSTRAINT [DF_items_requiresBatchTracking_tmp];
';

IF @isActiveIndexName IS NOT NULL
BEGIN
    SET @indexSql = N'CREATE INDEX ' + QUOTENAME(@isActiveIndexName) + N' ON [dbo].[items]([isActive]);';
    EXEC sp_executesql @indexSql;
END;

COMMIT TRAN;

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
