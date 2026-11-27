-- Rename the category master table from [dbo].[ItemCategories] to [dbo].[Categories].
-- SQL Server keeps FK references intact on a table rename; only the object names themselves are
-- updated here. The guards make the migration safe to rerun and harmless if Categories already
-- exists. Earlier migrations are left untouched: they created the table under its old name.

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[ItemCategories]', N'U') IS NOT NULL
   AND OBJECT_ID(N'[dbo].[Categories]', N'U') IS NULL
BEGIN
    EXEC sp_rename N'[dbo].[ItemCategories]', N'Categories', N'OBJECT';
END;

IF OBJECT_ID(N'[dbo].[Categories]', N'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM [sys].[key_constraints]
               WHERE [name] = N'ItemCategories_pkey' AND [parent_object_id] = OBJECT_ID(N'[dbo].[Categories]'))
        EXEC sp_rename N'[dbo].[ItemCategories_pkey]', N'Categories_pkey', N'OBJECT';

    IF EXISTS (SELECT 1 FROM [sys].[key_constraints]
               WHERE [name] = N'ItemCategories_CategoryCode_key' AND [parent_object_id] = OBJECT_ID(N'[dbo].[Categories]'))
        EXEC sp_rename N'[dbo].[ItemCategories_CategoryCode_key]', N'Categories_CategoryCode_key', N'OBJECT';

    IF EXISTS (SELECT 1 FROM [sys].[foreign_keys]
               WHERE [name] = N'ItemCategories_ParentCategoryID_fkey' AND [parent_object_id] = OBJECT_ID(N'[dbo].[Categories]'))
        EXEC sp_rename N'[dbo].[ItemCategories_ParentCategoryID_fkey]', N'Categories_ParentCategoryID_fkey', N'OBJECT';

    IF EXISTS (SELECT 1 FROM [sys].[default_constraints]
               WHERE [name] = N'DF_ItemCategories_IsActive' AND [parent_object_id] = OBJECT_ID(N'[dbo].[Categories]'))
        EXEC sp_rename N'[dbo].[DF_ItemCategories_IsActive]', N'DF_Categories_IsActive', N'OBJECT';
END;

COMMIT TRAN;

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
