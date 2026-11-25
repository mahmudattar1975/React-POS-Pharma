-- Multi-branch: shared branch master in PharmaDB + branch ownership on documents and stock.
-- Apply with: cd server; npx prisma migrate deploy
-- Existing rows are assigned to the Riyadh branch (cc-br-001) by the column defaults below.

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[branches] (
    [id] NVARCHAR(1000) NOT NULL,
    [code] NVARCHAR(1000) NOT NULL,
    [nameEn] NVARCHAR(1000) NOT NULL,
    [nameAr] NVARCHAR(1000) NOT NULL,
    [address] NVARCHAR(1000),
    [phone] NVARCHAR(1000),
    [vatNumber] NVARCHAR(1000),
    [crNumber] NVARCHAR(1000),
    [glnNo] NVARCHAR(1000),
    [costCenterId] NVARCHAR(1000),
    [isActive] BIT NOT NULL CONSTRAINT [DF_branches_isActive] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [DF_branches_createdAt] DEFAULT GETDATE(),
    CONSTRAINT [branches_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [branches_code_key] UNIQUE NONCLUSTERED ([code])
);

CREATE INDEX [branches_isActive_idx] ON [dbo].[branches]([isActive]);

-- Seed the four known pharmacies. Additional branches are added from Settings > Branches.
INSERT INTO [dbo].[branches] ([id], [code], [nameEn], [nameAr], [costCenterId], [isActive])
VALUES
    (N'cc-br-001', N'RIY', N'Riyadh Branch - Pharmacy Operations', N'فرع الرياض - عمليات الصيدلية', N'cc-br-001', 1),
    (N'cc-br-002', N'JED', N'Jeddah Branch - Pharmacy Operations', N'فرع جدة - عمليات الصيدلية', N'cc-br-002', 1),
    (N'cc-br-003', N'DAM', N'Dammam Branch - Pharmacy Operations', N'فرع الدمام - عمليات الصيدلية', N'cc-br-003', 1),
    (N'cc-br-004', N'MKK', N'Makkah Branch - Pharmacy Operations', N'فرع مكة المكرمة - عمليات الصيدلية', N'cc-br-004', 1);

-- Documents: defaults backfill every pre-existing row to the original single branch.
ALTER TABLE [dbo].[sales] ADD [branchId] NVARCHAR(1000) NOT NULL CONSTRAINT [DF_sales_branchId] DEFAULT N'cc-br-001';
ALTER TABLE [dbo].[return_records] ADD [branchId] NVARCHAR(1000) NOT NULL CONSTRAINT [DF_return_records_branchId] DEFAULT N'cc-br-001';

-- Stock: each branch owns its own batches, so the same item/batchNo may exist in several branches.
ALTER TABLE [dbo].[batches] ADD [branchId] NVARCHAR(1000) NOT NULL CONSTRAINT [DF_batches_branchId] DEFAULT N'cc-br-001';

CREATE INDEX [sales_branchId_idx] ON [dbo].[sales]([branchId]);
CREATE INDEX [return_records_branchId_idx] ON [dbo].[return_records]([branchId]);
CREATE INDEX [batches_branchId_itemId_batchNo_idx] ON [dbo].[batches]([branchId], [itemId], [batchNo]);

COMMIT TRAN;

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
