-- One item can carry several printed barcodes. The main code stays in dbo.items.Barcode (and the
-- legacy dbo.item.Code is untouched); aliases live in this child table so the count is not fixed by
-- the schema. UNIQUE(Barcode) makes the database enforce "one code -> one item".

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[ItemBarcodes]', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[ItemBarcodes] (
        [Id] INT IDENTITY(1, 1) NOT NULL,
        [ItemId] NVARCHAR(1000) NOT NULL,
        [Barcode] NVARCHAR(1000) NOT NULL,
        CONSTRAINT [ItemBarcodes_pkey] PRIMARY KEY CLUSTERED ([Id]),
        CONSTRAINT [ItemBarcodes_Barcode_key] UNIQUE NONCLUSTERED ([Barcode]),
        CONSTRAINT [ItemBarcodes_ItemId_fkey] FOREIGN KEY ([ItemId])
            REFERENCES [dbo].[items]([Id]) ON DELETE CASCADE ON UPDATE NO ACTION
    );

    CREATE INDEX [ItemBarcodes_ItemId_idx] ON [dbo].[ItemBarcodes]([ItemId]);
END;

COMMIT TRAN;

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
