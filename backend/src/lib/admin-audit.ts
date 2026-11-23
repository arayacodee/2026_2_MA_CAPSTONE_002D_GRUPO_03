import type { Prisma } from '../generated/prisma/client.js';

export function recordAdminAction(
  tx: Prisma.TransactionClient, actorId: string, action: string, resource: string, recordId: string, reason?: string,
) {
  return tx.adminAction.create({ data: { actorId, action, resource, recordId, reason } });
}
