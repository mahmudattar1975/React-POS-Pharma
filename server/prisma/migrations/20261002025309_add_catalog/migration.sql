BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[items] (
    [id] NVARCHAR(1000) NOT NULL,
    [barcode] NVARCHAR(1000) NOT NULL,
    [nameAr] NVARCHAR(1000) NOT NULL,
    [nameEn] NVARCHAR(1000) NOT NULL,
    [unit] NVARCHAR(1000) NOT NULL,
    [category] NVARCHAR(1000) NOT NULL,
    [basePrice] DECIMAL(12,3) NOT NULL,
    [controlledStatus] NVARCHAR(1000),
    [vatRate] DECIMAL(6,4) NOT NULL,
    [requiresBatchTracking] BIT NOT NULL,
    [reorderLevel] INT NOT NULL,
    CONSTRAINT [items_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [items_barcode_key] UNIQUE NONCLUSTERED ([barcode])
);

-- CreateTable
CREATE TABLE [dbo].[batches] (
    [id] NVARCHAR(1000) NOT NULL,
    [itemId] NVARCHAR(1000) NOT NULL,
    [batchNo] NVARCHAR(1000) NOT NULL,
    [expiryDate] DATETIME2 NOT NULL,
    [receivedDate] DATETIME2 NOT NULL,
    [qtyOnHand] INT NOT NULL,
    [purchasePrice] DECIMAL(12,3) NOT NULL,
    [purchaseDiscountPercent] DECIMAL(6,4) NOT NULL,
    [costPrice] DECIMAL(12,3) NOT NULL,
    [gtin] NVARCHAR(1000),
    [salePriceOverride] DECIMAL(12,3),
    CONSTRAINT [batches_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[offers] (
    [id] NVARCHAR(1000) NOT NULL,
    [itemId] NVARCHAR(1000) NOT NULL,
    [type] NVARCHAR(1000) NOT NULL,
    [percent] DECIMAL(6,4),
    [value] DECIMAL(12,3),
    [buyQty] INT,
    [freeQty] INT,
    [activeFrom] DATETIME2 NOT NULL,
    [activeTo] DATETIME2 NOT NULL,
    [label] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [offers_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- AddForeignKey
ALTER TABLE [dbo].[batches] ADD CONSTRAINT [batches_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[items]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[offers] ADD CONSTRAINT [offers_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[items]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
