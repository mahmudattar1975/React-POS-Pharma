-- dbo.items stores each master link twice: a text key (vendorNo / manufacturerNo) that the app,
-- importer and UI already use, and a numeric FK (vendorId / manufacturerId) for reports. They are
-- the SAME link, so this migration normalises any existing drift and installs a trigger that keeps
-- the two sides in agreement on every INSERT/UPDATE. The text key is authoritative when both are
-- supplied; an unmatched text key leaves the FK NULL rather than pointing at a different master.
-- Re-running the migration drops and recreates the trigger, so it is idempotent.

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[items_sync_master_keys]', N'TR') IS NOT NULL
    DROP TRIGGER [dbo].[items_sync_master_keys];

-- Normalise existing rows with the same rules the trigger will enforce.
UPDATE i
   SET [vendorId] = v.[VendorID]
  FROM [dbo].[items] AS i
  JOIN [dbo].[Vendors] AS v
    ON v.[VendorNo] = LTRIM(RTRIM(i.[vendorNo]))
 WHERE COALESCE(LEN(LTRIM(RTRIM(i.[vendorNo]))), 0) > 0
   AND (i.[vendorId] IS NULL OR i.[vendorId] <> v.[VendorID]);

UPDATE i
   SET [vendorId] = NULL
  FROM [dbo].[items] AS i
 WHERE COALESCE(LEN(LTRIM(RTRIM(i.[vendorNo]))), 0) > 0
   AND i.[vendorId] IS NOT NULL
   AND NOT EXISTS (
           SELECT 1 FROM [dbo].[Vendors] AS v
            WHERE v.[VendorNo] = LTRIM(RTRIM(i.[vendorNo]))
              AND v.[VendorID] = i.[vendorId]
       );

UPDATE i
   SET [vendorNo] = v.[VendorNo]
  FROM [dbo].[items] AS i
  JOIN [dbo].[Vendors] AS v ON v.[VendorID] = i.[vendorId]
 WHERE COALESCE(LEN(LTRIM(RTRIM(i.[vendorNo]))), 0) = 0
   AND (i.[vendorNo] IS NULL OR i.[vendorNo] <> v.[VendorNo]);

UPDATE i
   SET [vendorNo] = LTRIM(RTRIM(i.[vendorNo]))
  FROM [dbo].[items] AS i
 WHERE i.[vendorNo] IS NOT NULL
   AND i.[vendorNo] <> LTRIM(RTRIM(i.[vendorNo]));

UPDATE i
   SET [manufacturerId] = m.[ManufacturerID]
  FROM [dbo].[items] AS i
  JOIN [dbo].[Manufacturers] AS m
    ON m.[CompanyNo] = TRY_CONVERT(INT, LTRIM(RTRIM(i.[manufacturerNo])))
 WHERE COALESCE(LEN(LTRIM(RTRIM(i.[manufacturerNo]))), 0) > 0
   AND (i.[manufacturerId] IS NULL OR i.[manufacturerId] <> m.[ManufacturerID]);

UPDATE i
   SET [manufacturerId] = NULL
  FROM [dbo].[items] AS i
 WHERE COALESCE(LEN(LTRIM(RTRIM(i.[manufacturerNo]))), 0) > 0
   AND i.[manufacturerId] IS NOT NULL
   AND NOT EXISTS (
           SELECT 1 FROM [dbo].[Manufacturers] AS m
            WHERE m.[CompanyNo] = TRY_CONVERT(INT, LTRIM(RTRIM(i.[manufacturerNo])))
              AND m.[ManufacturerID] = i.[manufacturerId]
       );

UPDATE i
   SET [manufacturerNo] = CONVERT(NVARCHAR(50), m.[CompanyNo])
  FROM [dbo].[items] AS i
  JOIN [dbo].[Manufacturers] AS m ON m.[ManufacturerID] = i.[manufacturerId]
 WHERE COALESCE(LEN(LTRIM(RTRIM(i.[manufacturerNo]))), 0) = 0
   AND (i.[manufacturerNo] IS NULL OR i.[manufacturerNo] <> CONVERT(NVARCHAR(50), m.[CompanyNo]));

UPDATE i
   SET [manufacturerNo] = LTRIM(RTRIM(i.[manufacturerNo]))
  FROM [dbo].[items] AS i
 WHERE i.[manufacturerNo] IS NOT NULL
   AND i.[manufacturerNo] <> LTRIM(RTRIM(i.[manufacturerNo]));

-- CREATE TRIGGER must be the first statement in its batch, so build it as dynamic SQL.
-- The body deliberately uses LEN(...) instead of string literals so no quote escaping is needed.
DECLARE @triggerSql NVARCHAR(MAX) = N'
CREATE TRIGGER [dbo].[items_sync_master_keys] ON [dbo].[items]
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF TRIGGER_NESTLEVEL() > 1 RETURN;

    UPDATE i
       SET [vendorId] = v.[VendorID]
      FROM [dbo].[items] AS i
      JOIN INSERTED AS ins ON ins.[id] = i.[id]
      JOIN [dbo].[Vendors] AS v ON v.[VendorNo] = LTRIM(RTRIM(ins.[vendorNo]))
     WHERE COALESCE(LEN(LTRIM(RTRIM(ins.[vendorNo]))), 0) > 0
       AND (i.[vendorId] IS NULL OR i.[vendorId] <> v.[VendorID]);

    UPDATE i
       SET [vendorId] = NULL
      FROM [dbo].[items] AS i
      JOIN INSERTED AS ins ON ins.[id] = i.[id]
     WHERE COALESCE(LEN(LTRIM(RTRIM(ins.[vendorNo]))), 0) > 0
       AND i.[vendorId] IS NOT NULL
       AND NOT EXISTS (
               SELECT 1 FROM [dbo].[Vendors] AS v
                WHERE v.[VendorNo] = LTRIM(RTRIM(ins.[vendorNo]))
                  AND v.[VendorID] = i.[vendorId]
           );

    UPDATE i
       SET [vendorNo] = v.[VendorNo]
      FROM [dbo].[items] AS i
      JOIN INSERTED AS ins ON ins.[id] = i.[id]
      JOIN [dbo].[Vendors] AS v ON v.[VendorID] = ins.[vendorId]
     WHERE COALESCE(LEN(LTRIM(RTRIM(ins.[vendorNo]))), 0) = 0
       AND (i.[vendorNo] IS NULL OR i.[vendorNo] <> v.[VendorNo]);

    UPDATE i
       SET [vendorNo] = LTRIM(RTRIM(i.[vendorNo]))
      FROM [dbo].[items] AS i
      JOIN INSERTED AS ins ON ins.[id] = i.[id]
     WHERE i.[vendorNo] IS NOT NULL
       AND i.[vendorNo] <> LTRIM(RTRIM(i.[vendorNo]));

    UPDATE i
       SET [manufacturerId] = m.[ManufacturerID]
      FROM [dbo].[items] AS i
      JOIN INSERTED AS ins ON ins.[id] = i.[id]
      JOIN [dbo].[Manufacturers] AS m
        ON m.[CompanyNo] = TRY_CONVERT(INT, LTRIM(RTRIM(ins.[manufacturerNo])))
     WHERE COALESCE(LEN(LTRIM(RTRIM(ins.[manufacturerNo]))), 0) > 0
       AND (i.[manufacturerId] IS NULL OR i.[manufacturerId] <> m.[ManufacturerID]);

    UPDATE i
       SET [manufacturerId] = NULL
      FROM [dbo].[items] AS i
      JOIN INSERTED AS ins ON ins.[id] = i.[id]
     WHERE COALESCE(LEN(LTRIM(RTRIM(ins.[manufacturerNo]))), 0) > 0
       AND i.[manufacturerId] IS NOT NULL
       AND NOT EXISTS (
               SELECT 1 FROM [dbo].[Manufacturers] AS m
                WHERE m.[CompanyNo] = TRY_CONVERT(INT, LTRIM(RTRIM(ins.[manufacturerNo])))
                  AND m.[ManufacturerID] = i.[manufacturerId]
           );

    UPDATE i
       SET [manufacturerNo] = CONVERT(NVARCHAR(50), m.[CompanyNo])
      FROM [dbo].[items] AS i
      JOIN INSERTED AS ins ON ins.[id] = i.[id]
      JOIN [dbo].[Manufacturers] AS m ON m.[ManufacturerID] = ins.[manufacturerId]
     WHERE COALESCE(LEN(LTRIM(RTRIM(ins.[manufacturerNo]))), 0) = 0
       AND (i.[manufacturerNo] IS NULL OR i.[manufacturerNo] <> CONVERT(NVARCHAR(50), m.[CompanyNo]));

    UPDATE i
       SET [manufacturerNo] = LTRIM(RTRIM(i.[manufacturerNo]))
      FROM [dbo].[items] AS i
      JOIN INSERTED AS ins ON ins.[id] = i.[id]
     WHERE i.[manufacturerNo] IS NOT NULL
       AND i.[manufacturerNo] <> LTRIM(RTRIM(i.[manufacturerNo]));
END;
';
EXEC sp_executesql @triggerSql;

COMMIT TRAN;

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
