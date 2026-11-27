import { Router, type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { terminalBranch } from '../branch.js';
import { RequestError, conflict } from '../validation/common.js';
import { validateReceiving, validateReversal } from '../validation/receiving.js';

// Best-effort backup of a receiving event (vendor or head-office) - mirrors what
// store/catalogStore.ts's receiveStock() already did to the browser's local copy. Without this,
// the batches table only ever moved on a sale (see routes/sales.ts) and never on the "in" side of
// stock, so it would drift from real on-hand qty just as badly, only in the opposite direction.
//
// SEC-05: quantities, dates and prices are validated, every write is scoped to this terminal's
// branch, and a browser-generated event id makes retries idempotent (see ReceivingBackupEvent).
export const receivingRouter = Router();

function actorOf(req: Request): number {
  return req.auth?.cashierId ?? 0;
}

function respondWithError(res: Response, err: unknown): void {
  if (err instanceof RequestError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // A concurrent replay lost the unique-id race: the stock change is already recorded.
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    res.status(200).json({ ok: true, duplicate: true });
    return;
  }
  res.status(502).json({ error: String(err) });
}

receivingRouter.post('/', async (req, res) => {
  try {
    const input = validateReceiving(req.body);
    const outcome = await prisma.$transaction(async (tx) => {
      if (input.receivingId) {
        const existing = await tx.receivingBackupEvent.findUnique({
          where: { id: input.receivingId },
          select: { branchId: true, kind: true },
        });
        if (existing) {
          if (existing.branchId !== terminalBranch.id || existing.kind !== 'receive') {
            return { status: 409, body: { error: 'Receiving event belongs to another terminal.' } } as const;
          }
          return { status: 200, body: { ok: true, duplicate: true } } as const;
        }
      }

      // The item master isn't owned by receiving - never overwrite it on a repeat receive, only
      // create it the first time this DB has ever heard of this itemId (e.g. a local seed item or
      // a first-time ERP item that was never pushed here before).
      await tx.item.upsert({
        where: { id: input.itemId },
        create: {
          id: input.itemId,
          barcode: input.barcode ?? input.itemId,
          nameAr: input.itemNameAr,
          nameEn: input.itemNameEn,
          unit: input.unit ?? '',
          category: input.category ?? '',
          basePrice: input.basePrice,
          vatRate: input.vatRate,
          requiresBatchTracking: input.requiresBatchTracking,
          reorderLevel: input.reorderLevel,
        },
        update: {},
      });

      // Same "top up an existing batch number, else create a new row" rule catalogStore.receiveStock
      // uses locally, re-derived independently here rather than trusted from the client, since this
      // DB's own batches table may already differ from the browser's view of which batch is "new".
      const existingBatch = await tx.batch.findFirst({
        where: { branchId: terminalBranch.id, itemId: input.itemId, batchNo: input.batchNo },
        select: { id: true },
      });
      if (existingBatch) {
        await tx.batch.update({
          where: { id: existingBatch.id },
          data: { qtyOnHand: { increment: input.qty } },
        });
      } else {
        // ERP batch ids are deterministic per item+batchNo, so two branches can generate the same
        // id. Keep the browser's id when it is free; otherwise namespace it by branch.
        let newId = input.batchId;
        const idOwner = await tx.batch.findUnique({
          where: { id: input.batchId },
          select: { branchId: true },
        });
        if (idOwner && idOwner.branchId !== terminalBranch.id) {
          newId = `${terminalBranch.id}:${input.batchId}`;
        }
        await tx.batch.create({
          data: {
            id: newId,
            branchId: terminalBranch.id,
            itemId: input.itemId,
            batchNo: input.batchNo,
            expiryDate: input.expiryDate ?? new Date(input.receivedDate),
            receivedDate: input.receivedDate,
            qtyOnHand: input.qty,
            purchasePrice: input.purchasePrice,
            purchaseDiscountPercent: input.purchaseDiscountPercent,
            costPrice: input.costPrice,
          },
        });
      }

      if (input.receivingId) {
        await tx.receivingBackupEvent.create({
          data: {
            id: input.receivingId,
            kind: 'receive',
            branchId: terminalBranch.id,
            itemId: input.itemId,
            batchNo: input.batchNo,
            qty: input.qty,
            cashierId: actorOf(req),
          },
        });
      }
      return { status: 201, body: { ok: true } } as const;
    });
    res.status(outcome.status).json(outcome.body);
  } catch (err) {
    respondWithError(res, err);
  }
});

// Reverses the quantity a deleted/modified purchase invoice had received. The browser has already
// checked that the stock is still on hand (catalogStore.reversePurchaseInvoice); this mirrors the
// decrement onto this branch's SQL batches with the same guard and an idempotency key, so a replay
// cannot take the same delivery off the shelf twice.
receivingRouter.post('/reverse', async (req, res) => {
  try {
    const input = validateReversal(req.body);
    const outcome = await prisma.$transaction(async (tx) => {
      if (input.reversalId) {
        const existing = await tx.receivingBackupEvent.findUnique({
          where: { id: input.reversalId },
          select: { branchId: true, kind: true },
        });
        if (existing) {
          if (existing.branchId !== terminalBranch.id || existing.kind !== 'reverse') {
            return { status: 409, body: { error: 'Reversal belongs to another terminal.' } } as const;
          }
          return { status: 200, body: { ok: true, duplicate: true } } as const;
        }
      }

      const batch = await tx.batch.findFirst({
        where: { branchId: terminalBranch.id, itemId: input.itemId, batchNo: input.batchNo },
        select: { id: true },
      });
      if (batch) {
        // Conditional decrement: never push a branch's shelf balance below zero.
        const updated = await tx.batch.updateMany({
          where: { id: batch.id, qtyOnHand: { gte: input.qty } },
          data: { qtyOnHand: { decrement: input.qty } },
        });
        if (updated.count !== 1) throw conflict('Insufficient stock to reverse this delivery.');
      }

      if (input.reversalId) {
        await tx.receivingBackupEvent.create({
          data: {
            id: input.reversalId,
            kind: 'reverse',
            branchId: terminalBranch.id,
            itemId: input.itemId,
            batchNo: input.batchNo,
            qty: input.qty,
            cashierId: actorOf(req),
          },
        });
      }
      return { status: 200, body: { ok: true } } as const;
    });
    res.status(outcome.status).json(outcome.body);
  } catch (err) {
    respondWithError(res, err);
  }
});
