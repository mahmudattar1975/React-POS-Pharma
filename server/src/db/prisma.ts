import { PrismaClient } from '@prisma/client';

// One client for the whole process - PrismaClient already pools connections internally, so a
// per-request instance would just waste connections (the standard Prisma guidance for long-lived
// server processes, as opposed to serverless functions).
export const prisma = new PrismaClient();
