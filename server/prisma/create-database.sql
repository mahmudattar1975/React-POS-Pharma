-- Run this ONCE against your SQL Server instance (the same one that hosts XPH), using an account
-- with rights to create databases (e.g. sysadmin or dbcreator). This creates a brand-new, EMPTY
-- database, completely separate from XPH's own tables - Prisma will create this app's own tables
-- inside it afterward (see server/prisma/schema.prisma + the migration step in server/README.md).
--
-- Collation: Arabic_CI_AS (case-insensitive, accent-sensitive) - every text column Prisma
-- generates for this schema is NVARCHAR (confirmed via `npx prisma migrate diff --from-empty
-- --to-schema-datamodel prisma/schema.prisma --script`), so Arabic text stores correctly under any
-- collation; this one makes ORDER BY / LIKE / search on itemNameAr, customerNameAr etc. sort and
-- match the way a Saudi Arabic reader expects, instead of plain byte order. Plain (pre-"_100_")
-- version by choice - the newer Arabic_100_CI_AS has slightly more refined sort rules, but both
-- store and compare Arabic text correctly; this is a deliberate pick, not a correction.
--
-- Usage (sqlcmd): sqlcmd -S <host>[,<port>] -U <admin_user> -P <admin_password> -i create-database.sql
-- Or set "Collation" to Arabic_CI_AS in SSMS/Azure Data Studio's New Database dialog instead.

IF DB_ID('PharmaDB') IS NULL
BEGIN
    CREATE DATABASE PharmaDB COLLATE Arabic_CI_AS;
END
GO
