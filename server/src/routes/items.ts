import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { dotnetPos } from '../db/dotnetPosPrisma.js';
import { barcodeKey, validateItemImportBody, type ItemImportInput } from '../items/import.js';

// Excel → item master. The browser owns file parsing and the review screen, but this endpoint is the
// only writer: it validates again, then upserts by barcode into BOTH catalogues -
//   dotnet_pos.dbo.items  the app's POS catalogue (Prisma client `prisma`)
//   dotnet_pos.dbo.item   the .NET commission master (separate Prisma client `dotnetPos`)
// Re-importing the same file updates the same rows, so the operation is safe to repeat. The two
// databases cannot share one transaction, so each write is snapshotted and rolled back if either
// side fails; the caller gets an explicit error instead of half a file being applied.
export const itemsRouter = Router();

interface AppRow {
  id: string;
  barcode: string;
  nameAr: string;
  nameEn: string;
  unit: string;
  category: string;
  categoryId: number | null;
  basePrice: number;
  vatRate: number;
  controlledStatus: string | null;
  requiresBatchTracking: boolean;
  reorderLevel: number;
  vendorNo: string | null;
  manufacturerNo: string | null;
}

interface LegacyRow {
  id: number;
  code: string | null;
  name: string;
  salePrice: number;
  vatRate: number;
  isActive: boolean;
}

type AppSnapshot =
  | { kind: 'create'; id: string }
  | { kind: 'update'; id: string; before: AppRow };

type LegacySnapshot =
  | { kind: 'create'; id: number }
  | { kind: 'update'; id: number; before: LegacyRow };

interface AliasRow {
  Id: number;
  ItemId: string;
  Barcode: string;
}

interface AliasSnapshot {
  itemId: string;
  before: AliasRow[];
}

// A barcode claimed by a different item is a data error, not something to guess past: tell the
// owner which code to fix instead of silently reassigning a scannable identity.
class ImportConflict extends Error {}

async function aliasesForItems(itemIds: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  for (let i = 0; i < itemIds.length; i += 500) {
    const rows = await prisma.$queryRaw<AliasRow[]>`
      SELECT [Id], [ItemId], [Barcode] FROM [dbo].[ItemBarcodes]
      WHERE [ItemId] IN (${Prisma.join(itemIds.slice(i, i + 500))})
      ORDER BY [Id]
    `;
    for (const row of rows) {
      const codes = result.get(row.ItemId) ?? [];
      codes.push(row.Barcode);
      result.set(row.ItemId, codes);
    }
  }
  return result;
}

async function aliasOwners(codes: string[]): Promise<AliasRow[]> {
  const all: AliasRow[] = [];
  for (let i = 0; i < codes.length; i += 500) {
    const chunk = codes.slice(i, i + 500).map((code) => code.toLowerCase());
    all.push(...await prisma.$queryRaw<AliasRow[]>`
      SELECT [Id], [ItemId], [Barcode] FROM [dbo].[ItemBarcodes]
      WHERE LOWER([Barcode]) IN (${Prisma.join(chunk)})
    `);
  }
  return all;
}

async function replaceAliases(itemId: string, codes: string[]): Promise<AliasSnapshot> {
  const before = await prisma.$queryRaw<AliasRow[]>`
    SELECT [Id], [ItemId], [Barcode] FROM [dbo].[ItemBarcodes]
    WHERE [ItemId] = ${itemId} ORDER BY [Id]
  `;
  await prisma.$executeRaw`DELETE FROM [dbo].[ItemBarcodes] WHERE [ItemId] = ${itemId}`;
  for (const code of codes) {
    await prisma.$executeRaw`
      INSERT INTO [dbo].[ItemBarcodes] ([ItemId], [Barcode]) VALUES (${itemId}, ${code})
    `;
  }
  return { itemId, before };
}

async function inChunks<T>(values: string[], find: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const all: T[] = [];
  for (let i = 0; i < values.length; i += 500) {
    all.push(...(await find(values.slice(i, i + 500))));
  }
  return all;
}

function byBarcode<T extends { barcode: string }>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) map.set(barcodeKey(row.barcode), row);
  return map;
}

function byLegacyCode<T extends { code: string | null }>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>();
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.code?.trim()) continue;
    const key = barcodeKey(row.code);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    map.set(key, row);
  }
  for (const [key, count] of counts) {
    if (count > 1) throw new Error(`The .NET item master has ${count} rows with code ${key}; resolve the duplicate before importing.`);
  }
  return map;
}

// Shared item catalogue for branch terminals. The browser is offline-first and keeps its own copy
// in localStorage; this read-only endpoint lets a terminal adopt master rows that another branch
// imported without copying that branch's stock (batches are never returned here).
itemsRouter.get('/', async (_req, res) => {
  try {
    const rows = await prisma.item.findMany({
      orderBy: { nameEn: 'asc' },
      select: {
        id: true, barcode: true, nameAr: true, nameEn: true, unit: true, category: true,
        categoryId: true, basePrice: true, vatRate: true, controlledStatus: true,
        requiresBatchTracking: true, reorderLevel: true, vendorNo: true, manufacturerNo: true,
      },
    });
    // Alternate codes are part of the shared catalogue too: a branch that never imported the file
    // must still recognise a scanned alias on boot.
    const aliases = await aliasesForItems(rows.map((row) => row.id));
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        barcode: row.barcode,
        barcodes: aliases.get(row.id) ?? [],
        nameAr: row.nameAr,
        nameEn: row.nameEn,
        unit: row.unit,
        category: row.category,
        categoryId: row.categoryId,
        basePrice: row.basePrice.toNumber(),
        vatRate: row.vatRate.toNumber(),
        requiresBatchTracking: row.requiresBatchTracking,
        reorderLevel: row.reorderLevel,
        controlledStatus: row.controlledStatus,
        vendorNo: row.vendorNo,
        manufacturerNo: row.manufacturerNo,
        // isActive is branch-local pharmacy data (the SQL mirror has no column for it), so it is
        // intentionally omitted: the browser keeps its own flag and defaults new rows to active.
      })),
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

itemsRouter.post('/import', async (req, res) => {
  let inputs: ItemImportInput[];
  try {
    inputs = validateItemImportBody(req.body).items;
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }

  const requestedCategoryIds = [...new Set(
    inputs.map((item) => item.categoryId).filter((id): id is number => id !== undefined)
  )];
  const validCategoryIds = new Set<number>();
  const categoryLabels = new Map<number, string>();
  if (requestedCategoryIds.length > 0) {
    try {
      const found = await prisma.itemCategory.findMany({
        where: { categoryId: { in: requestedCategoryIds } },
        select: { categoryId: true, nameEn: true },
      });
      for (const row of found) {
        validCategoryIds.add(row.categoryId);
        categoryLabels.set(row.categoryId, row.nameEn);
      }
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }
    const missing = requestedCategoryIds.filter((id) => !validCategoryIds.has(id));
    if (missing.length > 0) {
      res.status(400).json({ error: `Unknown ItemCategories id(s): ${missing.join(', ')}.` });
      return;
    }
  }

  try {
    const codes = inputs.map((item) => item.barcode);
    const [appRowsRaw, legacyRowsRaw] = await Promise.all([
      inChunks(codes, (chunk) =>
        prisma.item.findMany({
          where: { barcode: { in: chunk } },
          select: {
            id: true, barcode: true, nameAr: true, nameEn: true, unit: true, category: true,
            categoryId: true, basePrice: true, vatRate: true, controlledStatus: true,
            requiresBatchTracking: true, reorderLevel: true, vendorNo: true, manufacturerNo: true,
          },
        }),
      ),
      inChunks(codes, (chunk) =>
        dotnetPos.item.findMany({
          where: { code: { in: chunk } },
          select: { id: true, code: true, name: true, salePrice: true, vatRate: true, isActive: true },
        }),
      ),
    ]);
    // Prisma returns Decimal objects; the snapshot/rollback path works with plain numbers.
    const appRows: AppRow[] = appRowsRaw.map((row) => ({
      ...row,
      basePrice: row.basePrice.toNumber(),
      vatRate: row.vatRate.toNumber(),
    }));
    const legacyRows: LegacyRow[] = legacyRowsRaw.map((row) => ({
      ...row,
      salePrice: row.salePrice.toNumber(),
      vatRate: row.vatRate.toNumber(),
    }));

    const appByCode = byBarcode(appRows);
    const legacyByCode = byLegacyCode(legacyRows);
    const appById = new Map(appRows.map((row) => [row.id, row]));
    const usedIds = new Set(appById.keys());

    // Choose the id once, before any write. Imported rows that already exist locally keep the
    // browser's id where possible, so local batches/sales still point at the same master row.
    const prepared = inputs.map((input) => {
      const key = barcodeKey(input.barcode);
      const existing = appByCode.get(key);
      let id = existing?.id ?? input.preferredId ?? `imp-${randomUUID()}`;
      const owner = appById.get(id);
      if (owner && barcodeKey(owner.barcode) !== key) id = `imp-${randomUUID()}`;
      while (usedIds.has(id)) id = `imp-${randomUUID()}`;
      usedIds.add(id);
      return { ...input, id, appExisting: existing, legacyExisting: legacyByCode.get(key) };
    });

    // A scanned code must name exactly one product. Check every code in the file - primary and
    // alias - against both the main-Barcode column and the ItemBarcodes table before writing.
    const incomingCodes = [
      ...inputs.map((item) => item.barcode),
      ...inputs.flatMap((item) => item.barcodes ?? []),
    ];
    if (incomingCodes.length > 0) {
      const [aliases, mains] = await Promise.all([
        aliasOwners(incomingCodes),
        inChunks(incomingCodes, (chunk) => prisma.item.findMany({
          where: { barcode: { in: chunk } },
          select: { id: true, barcode: true },
        })),
      ]);
      const aliasByCode = new Map(aliases.map((row) => [barcodeKey(row.Barcode), row.ItemId]));
      const mainByCode = new Map(mains.map((row) => [barcodeKey(row.barcode), row.id]));
      for (const row of prepared) {
        for (const code of [row.barcode, ...(row.barcodes ?? [])]) {
          const ownerId = aliasByCode.get(barcodeKey(code)) ?? mainByCode.get(barcodeKey(code));
          if (ownerId && ownerId !== row.appExisting?.id) {
            throw new ImportConflict(
              `Barcode ${code} already belongs to another item; resolve that clash before importing.`
            );
          }
        }
      }
    }

    const appSnapshots: AppSnapshot[] = [];
    const legacySnapshots: LegacySnapshot[] = [];
    const aliasSnapshots: AliasSnapshot[] = [];
    let appCreated = 0;
    let appUpdated = 0;
    let legacyCreated = 0;
    let legacyUpdated = 0;

    try {
      for (const row of prepared) {
        // The server is the writer even when a caller bypasses the browser planner: a supplied
        // CategoryID always owns the free-text label used by POS/cost-center rules.
        const category = row.categoryId !== undefined
          ? categoryLabels.get(row.categoryId) ?? row.category
          : row.category;
        const data = {
          nameAr: row.nameAr,
          nameEn: row.nameEn,
          unit: row.unit,
          category,
          // A blank cell keeps an existing link; a supplied id replaces it. Creates leave it null.
          ...(row.categoryId !== undefined ? { categoryId: row.categoryId } : {}),
          basePrice: row.basePrice,
          vatRate: row.vatRate,
          // A blank controlled-status cell means "not supplied", not "clear a restriction that was
          // set in the app", so an update leaves an existing value alone.
          controlledStatus: row.controlledStatus ?? undefined,
          requiresBatchTracking: row.requiresBatchTracking,
          reorderLevel: row.reorderLevel,
          // Blank Excel cells leave the existing vendor/manufacturer untouched.
          ...(row.vendorNo !== undefined ? { vendorNo: row.vendorNo } : {}),
          ...(row.manufacturerNo !== undefined ? { manufacturerNo: row.manufacturerNo } : {}),
        };
        if (row.appExisting) {
          appSnapshots.push({ kind: 'update', id: row.appExisting.id, before: row.appExisting });
          await prisma.item.update({ where: { id: row.appExisting.id }, data });
          appUpdated += 1;
        } else {
          appSnapshots.push({ kind: 'create', id: row.id });
          await prisma.item.create({ data: { id: row.id, barcode: row.barcode, ...data } });
          appCreated += 1;
        }
        // The extra-barcode column is optional. When present it replaces that item's alias list;
        // when absent, aliases already in SQL are left alone. The .NET master keeps its single Code.
        if (row.barcodes !== undefined) {
          aliasSnapshots.push(await replaceAliases(row.appExisting?.id ?? row.id, row.barcodes));
        }
      }

      for (const row of prepared) {
        const code = row.barcode;
        const name = row.nameEn;
        if (row.legacyExisting) {
          legacySnapshots.push({ kind: 'update', id: row.legacyExisting.id, before: row.legacyExisting });
          await dotnetPos.item.update({
            where: { id: row.legacyExisting.id },
            data: { code, name, salePrice: row.basePrice, vatRate: row.vatRate, isActive: row.isActive },
          });
          legacyUpdated += 1;
        } else {
          // Id is an IDENTITY in the .NET table - let SQL assign it so the .NET application and
          // this importer can never race for the same number.
          const inserted = await dotnetPos.$queryRaw<Array<{ Id: number }>>`
            INSERT INTO dbo.item (Code, Name, SalePrice, VatRate, IsActive)
            OUTPUT INSERTED.Id
            VALUES (${code}, ${name}, ${row.basePrice}, ${row.vatRate}, ${row.isActive ? 1 : 0})
          `;
          legacySnapshots.push({ kind: 'create', id: inserted[0].Id });
          legacyCreated += 1;
        }
      }
    } catch (err) {
      // Reverse in the opposite order so a failed re-import restores the exact previous values.
      // If a compensating write itself fails, include it in the response rather than hiding it.
      const rollbackErrors: string[] = [];
      for (const snapshot of aliasSnapshots.reverse()) {
        try {
          await prisma.$executeRaw`DELETE FROM [dbo].[ItemBarcodes] WHERE [ItemId] = ${snapshot.itemId}`;
          for (const row of snapshot.before) {
            await prisma.$executeRaw`
              INSERT INTO [dbo].[ItemBarcodes] ([ItemId], [Barcode]) VALUES (${row.ItemId}, ${row.Barcode})
            `;
          }
        } catch (rollbackErr) {
          rollbackErrors.push(`ItemBarcodes ${snapshot.itemId}: ${String(rollbackErr)}`);
        }
      }
      for (const snapshot of legacySnapshots.reverse()) {
        try {
          if (snapshot.kind === 'create') {
            await dotnetPos.$executeRaw`DELETE FROM dbo.item WHERE Id = ${snapshot.id}`;
          } else {
            const b = snapshot.before;
            await dotnetPos.item.update({
              where: { id: snapshot.id },
              data: { code: b.code ?? '', name: b.name, salePrice: b.salePrice, vatRate: b.vatRate, isActive: b.isActive },
            });
          }
        } catch (rollbackErr) {
          rollbackErrors.push(`.NET item ${snapshot.id}: ${String(rollbackErr)}`);
        }
      }
      for (const snapshot of appSnapshots.reverse()) {
        try {
          if (snapshot.kind === 'create') {
            await prisma.item.delete({ where: { id: snapshot.id } });
          } else {
            const b = snapshot.before;
            await prisma.item.update({
              where: { id: snapshot.id },
              data: {
                barcode: b.barcode, nameAr: b.nameAr, nameEn: b.nameEn, unit: b.unit,
                category: b.category, categoryId: b.categoryId, basePrice: b.basePrice, vatRate: b.vatRate,
                controlledStatus: b.controlledStatus ?? undefined, requiresBatchTracking: b.requiresBatchTracking,
                reorderLevel: b.reorderLevel,
                vendorNo: b.vendorNo, manufacturerNo: b.manufacturerNo,
              },
            });
          }
        } catch (rollbackErr) {
          rollbackErrors.push(`App item ${snapshot.id}: ${String(rollbackErr)}`);
        }
      }
      res.status(502).json({
        error: err instanceof Error ? err.message : String(err),
        rollbackErrors,
      });
      return;
    }

    res.json({
      created: appCreated,
      updated: appUpdated,
      app: { created: appCreated, updated: appUpdated },
      legacy: { created: legacyCreated, updated: legacyUpdated },
      items: prepared.map((row) => ({
        id: row.id,
        barcode: row.barcode,
        nameAr: row.nameAr,
        nameEn: row.nameEn,
        unit: row.unit,
        category: row.categoryId !== undefined
          ? categoryLabels.get(row.categoryId) ?? row.category
          : row.category,
        categoryId: row.categoryId ?? null,
        basePrice: row.basePrice,
        vatRate: row.vatRate,
        requiresBatchTracking: row.requiresBatchTracking,
        reorderLevel: row.reorderLevel,
        controlledStatus: row.controlledStatus ?? null,
        isActive: row.isActive,
        vendorNo: row.vendorNo,
        manufacturerNo: row.manufacturerNo,
        barcodes: row.barcodes ?? [],
      })),
    });
  } catch (err) {
    // A code owned by a different item is the owner's data to fix; everything else (SQL/network
    // failure during a write) is an infrastructure error and keeps the 502 contract.
    res.status(err instanceof ImportConflict ? 400 : 502)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});
