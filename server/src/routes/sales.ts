import { Router, type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { terminalBranch } from '../branch.js';
import { RequestError, badRequest, conflict } from '../validation/common.js';
import { validateReturnInput, validateSaleInput } from '../validation/sales.js';

// Persists what src/store/salesStore.ts already holds in the browser's local storage - this is a
// best-effort backup/sync target, not the primary record. The frontend always saves locally first
// (a sale must never fail because this server or its database is unreachable) and calls this
// afterward; a failure here is logged by the caller but never blocks or reverses the sale. See
// server/prisma/schema.prisma for the schema (field-for-field mirror of src/types/sales.ts).
//
// SEC-03/04: branch, cashier, totals and return quantities are re-derived/validated here. The
// browser remains the primary record, so invalid mirrors are rejected rather than silently
// corrupting the SQL stock and financial copy (the frontend queues a retry; see pendingSyncStore).
export const salesRouter = Router();

function cashierOf(req: Request): string {
  return req.auth?.fullName || req.auth?.username || '';
}

function respondWithError(res: Response, err: unknown): void {
  if (err instanceof RequestError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // Unique conflicts (invoiceNo/returnNo/id) are idempotency races, not server failures.
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    res.status(409).json({ error: 'This document has already been backed up.' });
    return;
  }
  // Same philosophy as ZATCA submission: this is a backup write, not a sale-blocking one - 502
  // tells the frontend "couldn't back this up right now", not "the sale failed".
  res.status(502).json({ error: String(err) });
}

salesRouter.post('/', async (req, res) => {
  try {
    const input = validateSaleInput(req.body, cashierOf(req));

    const outcome = await prisma.$transaction(async (tx) => {
      // SEC-04 idempotency: replayed backups (from the pending-sync queue) must not decrement
      // stock a second time. A colliding document from another branch is a conflict, never a
      // silent overwrite.
      const existing = await tx.sale.findFirst({
        where: { OR: [{ id: input.id }, { invoiceNo: input.invoiceNo }] },
        select: { id: true, invoiceNo: true, branchId: true },
      });
      if (existing) {
        if (existing.branchId !== terminalBranch.id || existing.invoiceNo !== input.invoiceNo) {
          return { status: 409, body: { error: 'Document id or invoice number belongs to another sale.' } } as const;
        }
        return { status: 200, body: { ok: true, duplicate: true } } as const;
      }

      // Batch ids are generated in the browser and are only unique within a terminal (ERP ids are
      // deterministic per item+batchNo). Resolve them by branch + item + batchNo instead, so two
      // branches holding the same batch can never decrement each other's stock. The conditional
      // update is the atomic stock check: it fails if this branch's shelf count is already short.
      for (const line of input.lines) {
        const batch = await tx.batch.findFirst({
          where: { branchId: terminalBranch.id, itemId: line.itemId, batchNo: line.batchNo },
          select: { id: true },
        });
        if (!batch) continue; // A batch seeded only in the browser is skipped, never a backup failure.
        const updated = await tx.batch.updateMany({
          where: { id: batch.id, qtyOnHand: { gte: line.qty } },
          data: { qtyOnHand: { decrement: line.qty } },
        });
        if (updated.count !== 1) {
          throw conflict(`Insufficient stock on batch ${line.batchNo} for item ${line.itemId}.`);
        }
      }

      await tx.sale.create({
        data: {
          id: input.id,
          invoiceNo: input.invoiceNo,
          branchId: terminalBranch.id,
          invoiceType: input.invoiceType,
          date: input.date,
          customerId: input.customerId,
          customerNameAr: input.customerNameAr,
          customerNameEn: input.customerNameEn,
          subtotalExclVat: input.subtotalExclVat,
          totalDiscount: input.totalDiscount,
          totalVatAmount: input.totalVatAmount,
          totalInclVat: input.totalInclVat,
          totalIncentive: input.totalIncentive ?? null,
          zatcaQrBase64: input.zatcaQrBase64,
          zatcaStatus: input.zatcaStatus,
          status: input.status,
          cashierName: input.cashierName,
          pointsEarned: input.pointsEarned,
          pointsRedeemed: input.pointsRedeemed,
          pointsEarnedClawedBack: input.pointsEarnedClawedBack,
          pointsRedeemedRefunded: input.pointsRedeemedRefunded,
          prescriptionSource: input.prescription?.source,
          prescriptionWasfatyRefNo: input.prescription?.wasfatyReferenceNo,
          prescriberName: input.prescription?.prescriberName,
          prescriberId: input.prescription?.prescriberId,
          prescriptionId: input.prescription?.prescriptionId,
          prescriptionDate: input.prescription?.prescriptionDate,
          patientNationalId: input.prescription?.patientNationalId,
          lines: {
            create: input.lines.map((l) => ({
              id: l.id,
              itemId: l.itemId,
              itemNameAr: l.itemNameAr,
              itemNameEn: l.itemNameEn,
              batchId: l.batchId,
              batchNo: l.batchNo,
              expiryDate: l.expiryDate ? new Date(l.expiryDate) : new Date(input.date),
              qty: l.qty,
              unitPrice: l.unitPrice,
              vatRate: l.vatRate,
              offerLabel: l.offerLabel,
              manualDiscountType: l.manualDiscountType,
              manualDiscountValue: l.manualDiscountValue,
              discountAmount: l.discountAmount,
              netExclVat: l.netExclVat,
              vatAmount: l.vatAmount,
              totalInclVat: l.totalInclVat,
              returnedQty: l.returnedQty,
              controlledStatus: l.controlledStatus,
            })),
          },
          payments: {
            create: input.payments.map((p) => ({
              method: p.method,
              amount: p.amount,
              cardNetwork: p.cardNetwork,
              insuranceCompany: p.insuranceCompany,
              insuranceApprovalCode: p.insuranceApprovalCode,
            })),
          },
        },
      });
      return { status: 201, body: { ok: true } } as const;
    });

    res.status(outcome.status).json(outcome.body);
  } catch (err) {
    respondWithError(res, err);
  }
});

salesRouter.post('/returns', async (req, res) => {
  try {
    const input = validateReturnInput(req.body);

    const outcome = await prisma.$transaction(async (tx) => {
      // SEC-03 idempotency: a replayed return must not restock the same lines again.
      const existing = await tx.returnRecord.findFirst({
        where: { OR: [{ id: input.id }, { returnNo: input.returnNo }] },
        select: { id: true, returnNo: true, branchId: true },
      });
      if (existing) {
        if (existing.branchId !== terminalBranch.id || existing.returnNo !== input.returnNo) {
          return { status: 409, body: { error: 'Return id or number belongs to another sale.' } } as const;
        }
        return { status: 200, body: { ok: true, duplicate: true } } as const;
      }

      // SEC-03: the original sale must belong to THIS terminal. Client-supplied line and invoice
      // ids can no longer reach another branch's rows.
      const original = await tx.sale.findFirst({
        where: { id: input.originalInvoiceId, branchId: terminalBranch.id },
        select: {
          id: true,
          pointsEarned: true,
          pointsRedeemed: true,
          pointsEarnedClawedBack: true,
          pointsRedeemedRefunded: true,
          totalIncentive: true,
          totalIncentiveClawedBack: true,
          lines: { select: { id: true, itemId: true, batchNo: true, qty: true, returnedQty: true } },
        },
      });
      if (!original) throw conflict('Original invoice not found on this terminal.');
      if (original.lines.length === 0) throw badRequest('Original invoice has no lines.');

      const originalById = new Map(original.lines.map((line) => [line.id, line]));
      // Seed with the quantities already returned by earlier returns. A second partial return must
      // EXTEND the running total, not replace it with just this return's quantity.
      const returnQtyByLine = new Map(original.lines.map((line) => [line.id, line.returnedQty]));
      for (const line of input.lines) {
        const source = originalById.get(line.saleLineId);
        if (!source) throw badRequest(`Return line ${line.saleLineId} is not part of this invoice.`);
        const cumulative = (returnQtyByLine.get(line.saleLineId) ?? 0) + line.qty;
        if (cumulative > source.qty) {
          throw badRequest(`Return quantity exceeds the returnable quantity of line ${line.saleLineId}.`);
        }
        returnQtyByLine.set(line.saleLineId, cumulative);
      }

      // Points/incentive clawbacks are cumulative snapshots on the invoice. Validate they move
      // forward and never exceed what the original sale granted; the exact ratios are computed by
      // the browser and preserved, so the local business rule is unchanged.
      const pointsClawedBack = input.updatedInvoicePointsEarnedClawedBack ?? original.pointsEarnedClawedBack ?? 0;
      const pointsRefunded = input.updatedInvoicePointsRedeemedRefunded ?? original.pointsRedeemedRefunded ?? 0;
      const incentiveClawedBack = Number(input.updatedInvoiceTotalIncentiveClawedBack ?? original.totalIncentiveClawedBack ?? 0);
      if (pointsClawedBack < (original.pointsEarnedClawedBack ?? 0) || pointsClawedBack > (original.pointsEarned ?? 0)) {
        throw badRequest('Invalid pointsEarnedClawedBack for this invoice.');
      }
      if (pointsRefunded < (original.pointsRedeemedRefunded ?? 0) || pointsRefunded > (original.pointsRedeemed ?? 0)) {
        throw badRequest('Invalid pointsRedeemedRefunded for this invoice.');
      }
      if (
        incentiveClawedBack < Number(original.totalIncentiveClawedBack ?? 0) - 0.02 ||
        incentiveClawedBack > Number(original.totalIncentive ?? 0) + 0.02
      ) {
        throw badRequest('Invalid totalIncentiveClawedBack for this invoice.');
      }

      // A return line only carries saleLineId/qty, not batchId - restock the original line's batch
      // on this branch only, using the quantities just validated (never the raw body values).
      for (const line of input.lines) {
        const source = originalById.get(line.saleLineId)!;
        const batch = await tx.batch.findFirst({
          where: { branchId: terminalBranch.id, itemId: source.itemId, batchNo: source.batchNo },
          select: { id: true },
        });
        if (!batch) continue;
        await tx.batch.update({ where: { id: batch.id }, data: { qtyOnHand: { increment: line.qty } } });
      }

      const updatedLineIds = [...returnQtyByLine.keys()];
      const status = original.lines.every((line) => (returnQtyByLine.get(line.id) ?? line.returnedQty) >= line.qty)
        ? 'returned'
        : 'partially_returned';

      await tx.returnRecord.create({
        data: {
          id: input.id,
          returnNo: input.returnNo,
          branchId: terminalBranch.id,
          date: input.date,
          originalInvoiceId: input.originalInvoiceId,
          originalInvoiceNo: input.originalInvoiceNo,
          totalRefund: input.totalRefund,
          reason: input.reason,
          lines: {
            create: input.lines.map((l) => ({
              saleLineId: l.saleLineId,
              itemNameEn: l.itemNameEn,
              qty: l.qty,
              refundAmount: l.refundAmount,
            })),
          },
        },
      });
      await tx.sale.update({
        where: { id: original.id },
        data: {
          status,
          pointsEarnedClawedBack: pointsClawedBack,
          totalIncentiveClawedBack: incentiveClawedBack,
          pointsRedeemedRefunded: pointsRefunded,
        },
      });
      // Only the lines actually returned are touched; client-supplied returnedQty values for other
      // lines are ignored, so a return cannot rewrite unrelated history.
      for (const lineId of updatedLineIds) {
        await tx.saleLine.update({
          where: { id: lineId },
          data: { returnedQty: returnQtyByLine.get(lineId)! },
        });
      }
      return { status: 201, body: { ok: true } } as const;
    });

    res.status(outcome.status).json(outcome.body);
  } catch (err) {
    respondWithError(res, err);
  }
});
