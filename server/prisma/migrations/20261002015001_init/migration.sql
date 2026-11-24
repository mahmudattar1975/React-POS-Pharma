BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[sales] (
    [id] NVARCHAR(1000) NOT NULL,
    [invoiceNo] NVARCHAR(1000) NOT NULL,
    [invoiceType] NVARCHAR(1000) NOT NULL,
    [date] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [sales_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [customerId] NVARCHAR(1000),
    [customerNameAr] NVARCHAR(1000),
    [customerNameEn] NVARCHAR(1000),
    [subtotalExclVat] DECIMAL(12,3) NOT NULL,
    [totalDiscount] DECIMAL(12,3) NOT NULL,
    [totalVatAmount] DECIMAL(12,3) NOT NULL,
    [totalInclVat] DECIMAL(12,3) NOT NULL,
    [zatcaQrBase64] NVARCHAR(max) NOT NULL,
    [zatcaStatus] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL,
    [cashierName] NVARCHAR(1000) NOT NULL,
    [pointsEarned] INT,
    [pointsRedeemed] INT,
    [pointsEarnedClawedBack] INT,
    [pointsRedeemedRefunded] INT,
    [prescriptionSource] NVARCHAR(1000),
    [prescriptionWasfatyRefNo] NVARCHAR(1000),
    [prescriberName] NVARCHAR(1000),
    [prescriberId] NVARCHAR(1000),
    [prescriptionId] NVARCHAR(1000),
    [prescriptionDate] DATETIME2,
    [patientNationalId] NVARCHAR(1000),
    CONSTRAINT [sales_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [sales_invoiceNo_key] UNIQUE NONCLUSTERED ([invoiceNo])
);

-- CreateTable
CREATE TABLE [dbo].[sale_lines] (
    [id] NVARCHAR(1000) NOT NULL,
    [saleId] NVARCHAR(1000) NOT NULL,
    [itemId] NVARCHAR(1000) NOT NULL,
    [itemNameAr] NVARCHAR(1000) NOT NULL,
    [itemNameEn] NVARCHAR(1000) NOT NULL,
    [batchId] NVARCHAR(1000) NOT NULL,
    [batchNo] NVARCHAR(1000) NOT NULL,
    [expiryDate] DATETIME2 NOT NULL,
    [qty] INT NOT NULL,
    [unitPrice] DECIMAL(12,3) NOT NULL,
    [vatRate] DECIMAL(6,4) NOT NULL,
    [offerLabel] NVARCHAR(1000),
    [manualDiscountType] NVARCHAR(1000),
    [manualDiscountValue] DECIMAL(12,3),
    [discountAmount] DECIMAL(12,3) NOT NULL,
    [netExclVat] DECIMAL(12,3) NOT NULL,
    [vatAmount] DECIMAL(12,3) NOT NULL,
    [totalInclVat] DECIMAL(12,3) NOT NULL,
    [returnedQty] INT NOT NULL CONSTRAINT [sale_lines_returnedQty_df] DEFAULT 0,
    [controlledStatus] NVARCHAR(1000),
    CONSTRAINT [sale_lines_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[payments] (
    [id] NVARCHAR(1000) NOT NULL,
    [saleId] NVARCHAR(1000) NOT NULL,
    [method] NVARCHAR(1000) NOT NULL,
    [amount] DECIMAL(12,3) NOT NULL,
    [cardNetwork] NVARCHAR(1000),
    [insuranceCompany] NVARCHAR(1000),
    [insuranceApprovalCode] NVARCHAR(1000),
    CONSTRAINT [payments_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[return_records] (
    [id] NVARCHAR(1000) NOT NULL,
    [returnNo] NVARCHAR(1000) NOT NULL,
    [date] DATETIME2 NOT NULL,
    [originalInvoiceId] NVARCHAR(1000) NOT NULL,
    [originalInvoiceNo] NVARCHAR(1000) NOT NULL,
    [totalRefund] DECIMAL(12,3) NOT NULL,
    [reason] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [return_records_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [return_records_returnNo_key] UNIQUE NONCLUSTERED ([returnNo])
);

-- CreateTable
CREATE TABLE [dbo].[return_lines] (
    [id] NVARCHAR(1000) NOT NULL,
    [returnRecordId] NVARCHAR(1000) NOT NULL,
    [saleLineId] NVARCHAR(1000) NOT NULL,
    [itemNameEn] NVARCHAR(1000) NOT NULL,
    [qty] INT NOT NULL,
    [refundAmount] DECIMAL(12,3) NOT NULL,
    CONSTRAINT [return_lines_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- AddForeignKey
ALTER TABLE [dbo].[sale_lines] ADD CONSTRAINT [sale_lines_saleId_fkey] FOREIGN KEY ([saleId]) REFERENCES [dbo].[sales]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[payments] ADD CONSTRAINT [payments_saleId_fkey] FOREIGN KEY ([saleId]) REFERENCES [dbo].[sales]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[return_records] ADD CONSTRAINT [return_records_originalInvoiceId_fkey] FOREIGN KEY ([originalInvoiceId]) REFERENCES [dbo].[sales]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[return_lines] ADD CONSTRAINT [return_lines_returnRecordId_fkey] FOREIGN KEY ([returnRecordId]) REFERENCES [dbo].[return_records]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
