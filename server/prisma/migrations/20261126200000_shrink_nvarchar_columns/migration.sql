-- Prisma maps a plain String field on SQL Server to NVARCHAR(1000). That exceeds the 900-byte
-- index key limit and produced "maximum key length" warnings. Shrink every such column to
-- NVARCHAR(100) (200 bytes). NVARCHAR(MAX) and deliberately longer columns are untouched.
-- Indexes and foreign keys that depend on those columns are dropped and recreated so SQL Server
-- allows the ALTER COLUMN statements; their definitions are read from the live database.

BEGIN TRAN;

-- Drop FKs that reference an affected column
ALTER TABLE [dbo].[batches] DROP CONSTRAINT [batches_itemId_fkey];
ALTER TABLE [dbo].[ItemBarcodes] DROP CONSTRAINT [ItemBarcodes_ItemId_fkey];
ALTER TABLE [dbo].[offers] DROP CONSTRAINT [offers_itemId_fkey];
ALTER TABLE [dbo].[payments] DROP CONSTRAINT [payments_saleId_fkey];
ALTER TABLE [dbo].[return_lines] DROP CONSTRAINT [return_lines_returnRecordId_fkey];
ALTER TABLE [dbo].[return_records] DROP CONSTRAINT [return_records_originalInvoiceId_fkey];
ALTER TABLE [dbo].[sale_lines] DROP CONSTRAINT [sale_lines_saleId_fkey];

-- Drop nonclustered indexes / unique constraints
DROP INDEX [batches_branchId_itemId_batchNo_idx] ON [dbo].[batches];
ALTER TABLE [dbo].[branches] DROP CONSTRAINT [branches_code_key];
ALTER TABLE [dbo].[ItemBarcodes] DROP CONSTRAINT [ItemBarcodes_Barcode_key];
DROP INDEX [ItemBarcodes_ItemId_idx] ON [dbo].[ItemBarcodes];
ALTER TABLE [dbo].[items] DROP CONSTRAINT [items_barcode_key];
DROP INDEX [return_records_branchId_idx] ON [dbo].[return_records];
ALTER TABLE [dbo].[return_records] DROP CONSTRAINT [return_records_returnNo_key];
DROP INDEX [sales_branchId_idx] ON [dbo].[sales];
ALTER TABLE [dbo].[sales] DROP CONSTRAINT [sales_invoiceNo_key];

-- Drop clustered primary keys
ALTER TABLE [dbo].[batches] DROP CONSTRAINT [batches_pkey];
ALTER TABLE [dbo].[branches] DROP CONSTRAINT [branches_pkey];
ALTER TABLE [dbo].[items] DROP CONSTRAINT [items_pkey];
ALTER TABLE [dbo].[offers] DROP CONSTRAINT [offers_pkey];
ALTER TABLE [dbo].[payments] DROP CONSTRAINT [payments_pkey];
ALTER TABLE [dbo].[return_lines] DROP CONSTRAINT [return_lines_pkey];
ALTER TABLE [dbo].[return_records] DROP CONSTRAINT [return_records_pkey];
ALTER TABLE [dbo].[sale_lines] DROP CONSTRAINT [sale_lines_pkey];
ALTER TABLE [dbo].[sales] DROP CONSTRAINT [sales_pkey];

-- Shrink the columns
ALTER TABLE [dbo].[batches] ALTER COLUMN [batchNo] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[batches] ALTER COLUMN [branchId] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[batches] ALTER COLUMN [gtin] NVARCHAR(100) NULL;
ALTER TABLE [dbo].[batches] ALTER COLUMN [id] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[batches] ALTER COLUMN [itemId] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[branches] ALTER COLUMN [address] NVARCHAR(100) NULL;
ALTER TABLE [dbo].[branches] ALTER COLUMN [code] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[branches] ALTER COLUMN [costCenterId] NVARCHAR(100) NULL;
ALTER TABLE [dbo].[branches] ALTER COLUMN [crNumber] NVARCHAR(100) NULL;
ALTER TABLE [dbo].[branches] ALTER COLUMN [glnNo] NVARCHAR(100) NULL;
ALTER TABLE [dbo].[branches] ALTER COLUMN [id] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[branches] ALTER COLUMN [nameAr] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[branches] ALTER COLUMN [nameEn] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[branches] ALTER COLUMN [phone] NVARCHAR(100) NULL;
ALTER TABLE [dbo].[branches] ALTER COLUMN [vatNumber] NVARCHAR(100) NULL;
ALTER TABLE [dbo].[ItemBarcodes] ALTER COLUMN [Barcode] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[ItemBarcodes] ALTER COLUMN [ItemId] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[items] ALTER COLUMN [barcode] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[items] ALTER COLUMN [category] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[items] ALTER COLUMN [controlledStatus] NVARCHAR(100) NULL;
ALTER TABLE [dbo].[items] ALTER COLUMN [id] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[items] ALTER COLUMN [nameAr] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[items] ALTER COLUMN [nameEn] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[items] ALTER COLUMN [unit] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[offers] ALTER COLUMN [id] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[offers] ALTER COLUMN [itemId] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[offers] ALTER COLUMN [label] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[offers] ALTER COLUMN [type] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[payments] ALTER COLUMN [cardNetwork] NVARCHAR(100) NULL;
ALTER TABLE [dbo].[payments] ALTER COLUMN [id] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[payments] ALTER COLUMN [insuranceApprovalCode] NVARCHAR(100) NULL;
ALTER TABLE [dbo].[payments] ALTER COLUMN [insuranceCompany] NVARCHAR(100) NULL;
ALTER TABLE [dbo].[payments] ALTER COLUMN [method] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[payments] ALTER COLUMN [saleId] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[return_lines] ALTER COLUMN [id] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[return_lines] ALTER COLUMN [itemNameEn] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[return_lines] ALTER COLUMN [returnRecordId] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[return_lines] ALTER COLUMN [saleLineId] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[return_records] ALTER COLUMN [branchId] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[return_records] ALTER COLUMN [id] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[return_records] ALTER COLUMN [originalInvoiceId] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[return_records] ALTER COLUMN [originalInvoiceNo] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[return_records] ALTER COLUMN [reason] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[return_records] ALTER COLUMN [returnNo] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[sale_lines] ALTER COLUMN [batchId] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[sale_lines] ALTER COLUMN [batchNo] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[sale_lines] ALTER COLUMN [controlledStatus] NVARCHAR(100) NULL;
ALTER TABLE [dbo].[sale_lines] ALTER COLUMN [id] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[sale_lines] ALTER COLUMN [itemId] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[sale_lines] ALTER COLUMN [itemNameAr] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[sale_lines] ALTER COLUMN [itemNameEn] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[sale_lines] ALTER COLUMN [manualDiscountType] NVARCHAR(100) NULL;
ALTER TABLE [dbo].[sale_lines] ALTER COLUMN [offerLabel] NVARCHAR(100) NULL;
ALTER TABLE [dbo].[sale_lines] ALTER COLUMN [saleId] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[sales] ALTER COLUMN [branchId] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[sales] ALTER COLUMN [cashierName] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[sales] ALTER COLUMN [customerId] NVARCHAR(100) NULL;
ALTER TABLE [dbo].[sales] ALTER COLUMN [customerNameAr] NVARCHAR(100) NULL;
ALTER TABLE [dbo].[sales] ALTER COLUMN [customerNameEn] NVARCHAR(100) NULL;
ALTER TABLE [dbo].[sales] ALTER COLUMN [id] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[sales] ALTER COLUMN [invoiceNo] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[sales] ALTER COLUMN [invoiceType] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[sales] ALTER COLUMN [patientNationalId] NVARCHAR(100) NULL;
ALTER TABLE [dbo].[sales] ALTER COLUMN [prescriberId] NVARCHAR(100) NULL;
ALTER TABLE [dbo].[sales] ALTER COLUMN [prescriberName] NVARCHAR(100) NULL;
ALTER TABLE [dbo].[sales] ALTER COLUMN [prescriptionId] NVARCHAR(100) NULL;
ALTER TABLE [dbo].[sales] ALTER COLUMN [prescriptionSource] NVARCHAR(100) NULL;
ALTER TABLE [dbo].[sales] ALTER COLUMN [prescriptionWasfatyRefNo] NVARCHAR(100) NULL;
ALTER TABLE [dbo].[sales] ALTER COLUMN [status] NVARCHAR(100) NOT NULL;
ALTER TABLE [dbo].[sales] ALTER COLUMN [zatcaStatus] NVARCHAR(100) NOT NULL;

-- Recreate clustered primary keys
ALTER TABLE [dbo].[batches] ADD CONSTRAINT [batches_pkey] PRIMARY KEY CLUSTERED ([id] ASC);
ALTER TABLE [dbo].[branches] ADD CONSTRAINT [branches_pkey] PRIMARY KEY CLUSTERED ([id] ASC);
ALTER TABLE [dbo].[items] ADD CONSTRAINT [items_pkey] PRIMARY KEY CLUSTERED ([id] ASC);
ALTER TABLE [dbo].[offers] ADD CONSTRAINT [offers_pkey] PRIMARY KEY CLUSTERED ([id] ASC);
ALTER TABLE [dbo].[payments] ADD CONSTRAINT [payments_pkey] PRIMARY KEY CLUSTERED ([id] ASC);
ALTER TABLE [dbo].[return_lines] ADD CONSTRAINT [return_lines_pkey] PRIMARY KEY CLUSTERED ([id] ASC);
ALTER TABLE [dbo].[return_records] ADD CONSTRAINT [return_records_pkey] PRIMARY KEY CLUSTERED ([id] ASC);
ALTER TABLE [dbo].[sale_lines] ADD CONSTRAINT [sale_lines_pkey] PRIMARY KEY CLUSTERED ([id] ASC);
ALTER TABLE [dbo].[sales] ADD CONSTRAINT [sales_pkey] PRIMARY KEY CLUSTERED ([id] ASC);

-- Recreate unique constraints
ALTER TABLE [dbo].[branches] ADD CONSTRAINT [branches_code_key] UNIQUE NONCLUSTERED ([code] ASC);
ALTER TABLE [dbo].[ItemBarcodes] ADD CONSTRAINT [ItemBarcodes_Barcode_key] UNIQUE NONCLUSTERED ([Barcode] ASC);
ALTER TABLE [dbo].[items] ADD CONSTRAINT [items_barcode_key] UNIQUE NONCLUSTERED ([barcode] ASC);
ALTER TABLE [dbo].[return_records] ADD CONSTRAINT [return_records_returnNo_key] UNIQUE NONCLUSTERED ([returnNo] ASC);
ALTER TABLE [dbo].[sales] ADD CONSTRAINT [sales_invoiceNo_key] UNIQUE NONCLUSTERED ([invoiceNo] ASC);

-- Recreate nonclustered indexes
CREATE NONCLUSTERED INDEX [batches_branchId_itemId_batchNo_idx] ON [dbo].[batches] ([branchId] ASC, [itemId] ASC, [batchNo] ASC);
CREATE NONCLUSTERED INDEX [ItemBarcodes_ItemId_idx] ON [dbo].[ItemBarcodes] ([ItemId] ASC);
CREATE NONCLUSTERED INDEX [return_records_branchId_idx] ON [dbo].[return_records] ([branchId] ASC);
CREATE NONCLUSTERED INDEX [sales_branchId_idx] ON [dbo].[sales] ([branchId] ASC);

-- Recreate FKs
ALTER TABLE [dbo].[batches] ADD CONSTRAINT [batches_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[items] ([id]) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE [dbo].[ItemBarcodes] ADD CONSTRAINT [ItemBarcodes_ItemId_fkey] FOREIGN KEY ([ItemId]) REFERENCES [dbo].[items] ([id]) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE [dbo].[offers] ADD CONSTRAINT [offers_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[items] ([id]) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE [dbo].[payments] ADD CONSTRAINT [payments_saleId_fkey] FOREIGN KEY ([saleId]) REFERENCES [dbo].[sales] ([id]) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE [dbo].[return_lines] ADD CONSTRAINT [return_lines_returnRecordId_fkey] FOREIGN KEY ([returnRecordId]) REFERENCES [dbo].[return_records] ([id]) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE [dbo].[return_records] ADD CONSTRAINT [return_records_originalInvoiceId_fkey] FOREIGN KEY ([originalInvoiceId]) REFERENCES [dbo].[sales] ([id]) ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE [dbo].[sale_lines] ADD CONSTRAINT [sale_lines_saleId_fkey] FOREIGN KEY ([saleId]) REFERENCES [dbo].[sales] ([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;
