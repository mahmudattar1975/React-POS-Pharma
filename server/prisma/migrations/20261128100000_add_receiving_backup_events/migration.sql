-- Idempotency ledger for receiving/reversal SQL mirror writes (SEC-05). A repeated backup must
-- add/subtract stock exactly once even when the browser's pending-sync queue replays it.

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[receiving_backup_events]', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[receiving_backup_events] (
        [id] NVARCHAR(100) NOT NULL
            CONSTRAINT [receiving_backup_events_pkey] PRIMARY KEY CLUSTERED,
        [kind] NVARCHAR(10) NOT NULL,
        [branchId] NVARCHAR(100) NOT NULL,
        [itemId] NVARCHAR(100) NOT NULL,
        [batchNo] NVARCHAR(100) NOT NULL,
        [qty] INT NOT NULL,
        [cashierId] INT NOT NULL,
        [createdAt] DATETIME2 NOT NULL CONSTRAINT [DF_receiving_backup_events_createdAt] DEFAULT SYSUTCDATETIME()
    );
END;

IF NOT EXISTS (SELECT 1 FROM [sys].[indexes] WHERE [name] = N'receiving_backup_events_branch_item_batch_idx' AND [object_id] = OBJECT_ID(N'[dbo].[receiving_backup_events]'))
    CREATE INDEX [receiving_backup_events_branch_item_batch_idx]
        ON [dbo].[receiving_backup_events]([branchId], [itemId], [batchNo]);

COMMIT TRAN;

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
