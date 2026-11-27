-- Item Master > Pricing & tax: an optional item-level CostPrice beside the existing basePrice.
-- Receiving still stores the authoritative per-batch cost on dbo.batches; this column is the
-- master/default value shared across terminals. Nullable and guarded, so older rows and reruns
-- are untouched.

BEGIN TRY

BEGIN TRAN;

IF COL_LENGTH(N'[dbo].[items]', N'costPrice') IS NULL
    ALTER TABLE [dbo].[items] ADD [costPrice] DECIMAL(12, 3) NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
