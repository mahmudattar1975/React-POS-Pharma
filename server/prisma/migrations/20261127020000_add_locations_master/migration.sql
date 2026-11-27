-- Shelf/store location master for the Item Master. Item.location is an app-level text label, so
-- this table only supplies canonical choices and does not add a column or FK to dbo.items. Existing
-- local catalogues keep their old text until an owner picks a row in the form. The seed mirrors
-- src/utils/seedData.ts's seedLocations so offline and SQL terminals show the same shelf names.

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[Locations]', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[Locations] (
        [LocationID] INT IDENTITY(1, 1) NOT NULL
            CONSTRAINT [Locations_pkey] PRIMARY KEY CLUSTERED,
        [LocationCode] NVARCHAR(50) NOT NULL
            CONSTRAINT [Locations_LocationCode_key] UNIQUE NONCLUSTERED,
        [LocationNameAr] NVARCHAR(150) NOT NULL,
        [LocationNameEn] NVARCHAR(150) NOT NULL,
        [IsActive] BIT NOT NULL CONSTRAINT [DF_Locations_IsActive] DEFAULT 1
    );
END;

IF NOT EXISTS (SELECT 1 FROM [sys].[indexes] WHERE [name] = N'Locations_IsActive_idx' AND [object_id] = OBJECT_ID(N'[dbo].[Locations]'))
    CREATE INDEX [Locations_IsActive_idx] ON [dbo].[Locations]([IsActive]);

-- Deterministic ids keep the seed stable across every branch database.
SET IDENTITY_INSERT [dbo].[Locations] ON;

;WITH [seed] ([LocationID], [LocationCode], [LocationNameAr], [LocationNameEn]) AS (
    SELECT * FROM (VALUES
        (1,  N'LOC-A-01', N'الرف A-01',  N'A-01'),
        (2,  N'LOC-A-02', N'الرف A-02',  N'A-02'),
        (3,  N'LOC-A-03', N'الرف A-03',  N'A-03'),
        (4,  N'LOC-A-04', N'الرف A-04',  N'A-04'),
        (5,  N'LOC-A-05', N'الرف A-05',  N'A-05'),
        (6,  N'LOC-A-06', N'الرف A-06',  N'A-06'),
        (7,  N'LOC-A-07', N'الرف A-07',  N'A-07'),
        (8,  N'LOC-A-08', N'الرف A-08',  N'A-08'),
        (9,  N'LOC-A-09', N'الرف A-09',  N'A-09'),
        (10, N'LOC-A-10', N'الرف A-10',  N'A-10'),
        (11, N'LOC-A-11', N'الرف A-11',  N'A-11'),
        (12, N'LOC-A-12', N'الرف A-12',  N'A-12'),
        (13, N'LOC-B-01', N'الرف B-01',  N'B-01'),
        (14, N'LOC-B-02', N'الرف B-02',  N'B-02'),
        (15, N'LOC-B-03', N'الرف B-03',  N'B-03'),
        (16, N'LOC-B-04', N'الرف B-04',  N'B-04'),
        (17, N'LOC-MAIN', N'الرف الرئيسي', N'Main Shelf')
    ) AS [v] ([LocationID], [LocationCode], [LocationNameAr], [LocationNameEn])
)
INSERT INTO [dbo].[Locations]
    ([LocationID], [LocationCode], [LocationNameAr], [LocationNameEn], [IsActive])
SELECT
    [s].[LocationID], [s].[LocationCode], [s].[LocationNameAr], [s].[LocationNameEn], 1
FROM [seed] AS [s]
WHERE NOT EXISTS (
    SELECT 1 FROM [dbo].[Locations] AS [l]
    WHERE [l].[LocationID] = [s].[LocationID] OR [l].[LocationCode] = [s].[LocationCode]
);

SET IDENTITY_INSERT [dbo].[Locations] OFF;

COMMIT TRAN;

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
