-- Rename the purchasing party master table from [dbo].[Vendors] to [dbo].[CustVendor].
-- SQL Server keeps FK references intact on a table rename; only the object names themselves are
-- updated here. Stored trigger bodies are NOT rewritten by sp_rename, so the item/vendor key-sync
-- trigger is recreated below. Earlier migrations are left untouched: they created the table under
-- its old name. The guards make this migration safe to rerun and harmless if CustVendor already
-- exists.

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[Vendors]', N'U') IS NOT NULL
   AND OBJECT_ID(N'[dbo].[CustVendor]', N'U') IS NULL
BEGIN
    EXEC sp_rename N'[dbo].[Vendors]', N'CustVendor', N'OBJECT';
END;

IF OBJECT_ID(N'[dbo].[CustVendor]', N'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM [sys].[key_constraints]
               WHERE [name] = N'Vendors_pkey' AND [parent_object_id] = OBJECT_ID(N'[dbo].[CustVendor]'))
        EXEC sp_rename N'[dbo].[Vendors_pkey]', N'CustVendor_pkey', N'OBJECT';

    IF EXISTS (SELECT 1 FROM [sys].[key_constraints]
               WHERE [name] = N'Vendors_VendorNo_key' AND [parent_object_id] = OBJECT_ID(N'[dbo].[CustVendor]'))
        EXEC sp_rename N'[dbo].[Vendors_VendorNo_key]', N'CustVendor_VendorNo_key', N'OBJECT';

    IF EXISTS (SELECT 1 FROM [sys].[default_constraints]
               WHERE [name] = N'DF_Vendors_IsActive' AND [parent_object_id] = OBJECT_ID(N'[dbo].[CustVendor]'))
        EXEC sp_rename N'[dbo].[DF_Vendors_IsActive]', N'DF_CustVendor_IsActive', N'OBJECT';

    IF EXISTS (SELECT 1 FROM [sys].[check_constraints]
               WHERE [name] = N'Vendors_TypeFlag_chk' AND [parent_object_id] = OBJECT_ID(N'[dbo].[CustVendor]'))
        EXEC sp_rename N'[dbo].[Vendors_TypeFlag_chk]', N'CustVendor_TypeFlag_chk', N'OBJECT';
END;

-- sp_rename does not update references saved in sys.sql_modules. Recreate the key-sync trigger with
-- the new table name so INSERT/UPDATE of dbo.items keeps resolving vendorNo -> VendorID.
IF OBJECT_ID(N'[dbo].[items_sync_master_keys]', N'TR') IS NOT NULL
BEGIN
    DECLARE @triggerSql NVARCHAR(MAX) = OBJECT_DEFINITION(OBJECT_ID(N'[dbo].[items_sync_master_keys]', N'TR'));

    IF @triggerSql IS NOT NULL AND CHARINDEX(N'[dbo].[Vendors]', @triggerSql) > 0
    BEGIN
        SET @triggerSql = REPLACE(@triggerSql, N'[dbo].[Vendors]', N'[dbo].[CustVendor]');
        DROP TRIGGER [dbo].[items_sync_master_keys];
        EXEC sp_executesql @triggerSql;
    END;
END;

COMMIT TRAN;

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
