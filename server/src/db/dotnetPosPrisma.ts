import { PrismaClient } from '../../node_modules/.prisma/dotnet-pos-client/index.js';

// Separate connection for the dotnet-pos database. The main `prisma` client in ./prisma.ts stays
// pointed at this app's own PharmaDB; Incentive/Profit rules and their ledger live in dotnet_pos
// (commission_item and pos/pos_item), so they need their own client and datasource.
export const dotnetPos = new PrismaClient();
