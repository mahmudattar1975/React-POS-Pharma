import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { terminalBranch } from '../branch.js';

// Persists what src/store/salesStore.ts already holds in the browser's local storage - this is a
// best-effort backup/sync target, not the primary record. The frontend always saves locally first
// (a sale must never fail because this server or its database is unreachable) and calls this
// afterward; a failure here is logged by the caller but never blocks or reverses the sale. See
// server/prisma/schema.prisma for the schema (field-for-field mirror of src/types/sales.ts).
export const salesRouter = Router();

interface SaleLineInput {
  id: string;
  itemId: string;
  itemNameAr: string;
  itemNameEn: string;
  batchId: string;
  batchNo: string;
  expiryDate: string;
  qty: number;
  unitPrice: number;
  vatRate: number;
  offerLabel?: string;
  manualDiscountType?: string;
  manualDiscountValue?: number;
  discountAmount: number;
  netExclVat: number;
  vatAmount: number;
  totalInclVat: number;
  returnedQty: number;
  controlledStatus?: string;
}

interface PaymentInput {
  method: string;
  amount: number;
  cardNetwork?: string;
  insuranceCompany?: string;
  insuranceApprovalCode?: string;
}

interface SaleInput {
  id: string;
  invoiceNo: string;
  invoiceType: string;
  date: string;
  customerId?: string;
  customerNameAr?: string;
  customerNameEn?: string;
  lines: SaleLineInput[];
  subtotalExclVat: number;
  totalDiscount: number;
  totalVatAmount: number;
  totalInclVat: number;
  totalIncentive?: number;
  payments: PaymentInput[];
  zatcaQrBase64: string;
  zatcaStatus: string;
  status: string;
  cashierName: string;
  pointsEarned?: number;
  pointsRedeemed?: number;
  pointsEarnedClawedBack?: number;
  pointsRedeemedRefunded?: number;
  prescription?: {
    source: string;
    wasfatyReferenceNo?: string;
    prescriberName: string;
    prescriberId?: string;
    prescriptionId: string;
    prescriptionDate: string;
    patientNationalId: string;
  };
}

salesRouter.post('/', async (req, res) => {
  const body = req.body as SaleInput;
  try {
    // Batch IDs are generated in the browser and are only unique within a terminal (ERP ids are
    // deterministic per item+batchNo). Resolve them by branch + item + batchNo instead, so two
    // branches holding the same batch can never decrement each other's stock.
    const batchIds = await Promise.all(
      body.lines.map(async (l) => {
        const batch = await prisma.batch.findFirst({
          where: { branchId: terminalBranch.id, itemId: l.itemId, batchNo: l.batchNo },
          select: { id: true },
        });
        return batch?.id;
      })
    );
    const batchDeductions = body.lines.flatMap((l, i) =>
      batchIds[i] ? [prisma.batch.update({ where: { id: batchIds[i] }, data: { qtyOnHand: { decrement: l.qty } } })] : []
    );

    await prisma.$transaction([
      prisma.sale.create({
        data: {
        id: body.id,
        invoiceNo: body.invoiceNo,
        branchId: terminalBranch.id,
        invoiceType: body.invoiceType,
        date: new Date(body.date),
        customerId: body.customerId,
        customerNameAr: body.customerNameAr,
        customerNameEn: body.customerNameEn,
        subtotalExclVat: body.subtotalExclVat,
        totalDiscount: body.totalDiscount,
        totalVatAmount: body.totalVatAmount,
        totalInclVat: body.totalInclVat,
        totalIncentive: body.totalIncentive ?? null,
        zatcaQrBase64: body.zatcaQrBase64,
        zatcaStatus: body.zatcaStatus,
        status: body.status,
        cashierName: body.cashierName,
        pointsEarned: body.pointsEarned,
        pointsRedeemed: body.pointsRedeemed,
        pointsEarnedClawedBack: body.pointsEarnedClawedBack,
        pointsRedeemedRefunded: body.pointsRedeemedRefunded,
        prescriptionSource: body.prescription?.source,
        prescriptionWasfatyRefNo: body.prescription?.wasfatyReferenceNo,
        prescriberName: body.prescription?.prescriberName,
        prescriberId: body.prescription?.prescriberId,
        prescriptionId: body.prescription?.prescriptionId,
        prescriptionDate: body.prescription ? new Date(body.prescription.prescriptionDate) : undefined,
        patientNationalId: body.prescription?.patientNationalId,
        lines: {
          create: body.lines.map((l) => ({
            id: l.id,
            itemId: l.itemId,
            itemNameAr: l.itemNameAr,
            itemNameEn: l.itemNameEn,
            batchId: l.batchId,
            batchNo: l.batchNo,
            expiryDate: new Date(l.expiryDate),
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
          create: body.payments.map((p) => ({
            method: p.method,
            amount: p.amount,
            cardNetwork: p.cardNetwork,
            insuranceCompany: p.insuranceCompany,
            insuranceApprovalCode: p.insuranceApprovalCode,
          })),
        },
        },
      }),
      // The frontend already decremented its own local copy (catalogStore.decrementBatch) before
      // calling this - mirror that same deduction onto this branch's batches. A batch this DB has
      // never heard of (seeded only in the browser) is simply skipped, never a backup failure.
      ...batchDeductions,
    ]);
    res.status(201).json({ ok: true });
  } catch (err) {
    // Same philosophy as ZATCA submission (see routes/invoices.ts): this is a backup write, not a
    // sale-blocking one - 502 tells the frontend "couldn't back this up right now", not "the sale
    // failed" (it didn't - it's already saved locally by the time this call is made).
    res.status(502).json({ error: String(err) });
  }
});

interface ReturnLineInput {
  saleLineId: string;
  itemNameEn: string;
  qty: number;
  refundAmount: number;
}

interface ReturnInput {
  id: string;
  returnNo: string;
  date: string;
  originalInvoiceId: string;
  originalInvoiceNo: string;
  lines: ReturnLineInput[];
  totalRefund: number;
  reason: string;
  // The invoice's own fields that change when a return is processed (status, clawed-back points,
  // per-line returnedQty) - sent alongside so this one call can update both, matching what
  // salesStore.ts's recordReturn() already does atomically on the frontend's local copy.
  updatedInvoiceStatus: string;
  updatedInvoicePointsEarnedClawedBack?: number;
  updatedInvoiceTotalIncentiveClawedBack?: number;
  updatedInvoicePointsRedeemedRefunded?: number;
  updatedLineReturnedQtys: { lineId: string; returnedQty: number }[];
}

salesRouter.post('/returns', async (req, res) => {
  const body = req.body as ReturnInput;
  try {
    // A return line only carries saleLineId/qty, not batchId - look the original lines up first
    // so each one's batch can be restocked (catalogStore.incrementBatch's server-side mirror),
    // same reasoning as the batch decrement on the sale backup above.
    const originalLines = await prisma.saleLine.findMany({
      where: {
        id: { in: body.lines.map((l) => l.saleLineId) },
        // A terminal must not restock another branch's batch, even if an id somehow collides.
        sale: { branchId: terminalBranch.id },
      },
      select: { id: true, itemId: true, batchNo: true },
    });
    const originalByLineId = new Map(originalLines.map((l) => [l.id, l]));

    const restockIds = await Promise.all(
      body.lines.map(async (l) => {
        const original = originalByLineId.get(l.saleLineId);
        if (!original) return undefined;
        const batch = await prisma.batch.findFirst({
          where: { branchId: terminalBranch.id, itemId: original.itemId, batchNo: original.batchNo },
          select: { id: true },
        });
        return batch?.id;
      })
    );
    const batchIncrements = body.lines.flatMap((l, i) =>
      restockIds[i] ? [prisma.batch.update({ where: { id: restockIds[i] }, data: { qtyOnHand: { increment: l.qty } } })] : []
    );

    await prisma.$transaction([
      prisma.returnRecord.create({
        data: {
          id: body.id,
          returnNo: body.returnNo,
          branchId: terminalBranch.id,
          date: new Date(body.date),
          originalInvoiceId: body.originalInvoiceId,
          originalInvoiceNo: body.originalInvoiceNo,
          totalRefund: body.totalRefund,
          reason: body.reason,
          lines: {
            create: body.lines.map((l) => ({
              saleLineId: l.saleLineId,
              itemNameEn: l.itemNameEn,
              qty: l.qty,
              refundAmount: l.refundAmount,
            })),
          },
        },
      }),
      prisma.sale.update({
        where: { id: body.originalInvoiceId },
        data: {
          status: body.updatedInvoiceStatus,
          pointsEarnedClawedBack: body.updatedInvoicePointsEarnedClawedBack,
          totalIncentiveClawedBack: body.updatedInvoiceTotalIncentiveClawedBack,
          pointsRedeemedRefunded: body.updatedInvoicePointsRedeemedRefunded,
        },
      }),
      ...body.updatedLineReturnedQtys.map((l) =>
        prisma.saleLine.update({ where: { id: l.lineId }, data: { returnedQty: l.returnedQty } })
      ),
      ...batchIncrements,
    ]);
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});
