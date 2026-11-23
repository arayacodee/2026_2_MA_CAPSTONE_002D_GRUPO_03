import { prisma } from './prisma.js';
import { mpRequest, validPlan, invoicePeriodEnd, type MPSubscription, type MPInvoice } from './mercado-pago.js';
import type { Prisma } from '../generated/prisma/client.js';

export const bookingOwnerSelect = {
  role: true,
  isSuspended: true,
  accessGrant: true,
  manualAccessUntil: true,
  subscriptions: { select: { paidUntil: true }, where: { paidUntil: { not: null } } },
} satisfies Prisma.UserSelect;

export function canReceiveBookings(business: {
  isArchived: boolean;
  owner: Prisma.UserGetPayload<{ select: typeof bookingOwnerSelect }>;
}): boolean {
  const { owner } = business;
  if (business.isArchived || owner.isSuspended || owner.role !== 'PROFESSIONAL') return false;
  const now = new Date();
  return Boolean(owner.accessGrant || (owner.manualAccessUntil && owner.manualAccessUntil > now)) ||
    owner.subscriptions.some(record => record.paidUntil && record.paidUntil > now);
}

export async function hasProfessionalAccess(userId: string): Promise<boolean> {
  const owner = await prisma.user.findUnique({ where: { id: userId }, select: bookingOwnerSelect });
  return Boolean(owner && canReceiveBookings({ isArchived: false, owner }));
}

export async function syncSubscription(providerId: string) {
  const local = await prisma.professionalSubscription.findUnique({ where: { providerId } });
  if (!local) return;
  const remote = await mpRequest<MPSubscription>(`/preapproval/${encodeURIComponent(providerId)}`);
  if (remote.id !== providerId || !validPlan(remote, local.id)) throw new Error('Subscription plan mismatch');
  // Read every invoice, including refunds/chargebacks: a browser redirect or an
  // authorized mandate is never treated as proof of payment.
  const invoices: MPInvoice[] = [];
  for (let offset = 0; ;) {
    // This API rejects limit=20/100; use its default page size (currently 12).
    const page = await mpRequest<{ results: MPInvoice[]; paging: { total: number } }>(`/authorized_payments/search?preapproval_id=${encodeURIComponent(providerId)}${offset ? `&offset=${offset}` : ''}`);
    invoices.push(...page.results);
    if (offset + page.results.length >= page.paging.total) break;
    if (!page.results.length || offset >= 10000) throw new Error('Incomplete invoice search');
    offset += page.results.length;
  }
  // Fetch authoritative payment status as invoice snapshots can lag refunds.
  const verified: { invoice: MPInvoice; end: Date | null }[] = [];
  for (const invoice of invoices) {
    if (invoice.preapproval_id !== providerId) throw new Error('Invoice subscription mismatch');
    if (invoice.payment?.id) {
      const payment = await mpRequest<{ status: string; transaction_amount: number; currency_id: string; transaction_amount_refunded?: number }>(`/v1/payments/${invoice.payment.id}`);
      invoice.payment.status = payment.status;
      if (payment.currency_id !== 'CLP' || Number(payment.transaction_amount) !== 7900 || Number(payment.transaction_amount_refunded ?? 0) > 0) invoice.payment.status = 'invalid';
    }
    verified.push({ invoice, end: invoicePeriodEnd(invoice) });
  }
  const paidUntil = verified.reduce<Date | null>((latest, item) => item.end && (!latest || item.end > latest) ? item.end : latest, null);
  await prisma.$transaction(async tx => {
    const updated = await tx.professionalSubscription.updateMany({ where: { id: local.id, updatedAt: local.updatedAt }, data: {
      status: remote.status, paidUntil,
      ...(remote.status === 'cancelled' ? { activeKey: null } : {}),
    } });
    if (!updated.count) throw new Error('Concurrent subscription update; retry reconciliation');
    for (const { invoice, end } of verified) {
      await tx.subscriptionPayment.upsert({ where: { id: String(invoice.id) },
        create: { id: String(invoice.id), subscriptionId: local.id, status: invoice.payment?.status ?? 'pending', paidUntil: end },
        update: { status: invoice.payment?.status ?? 'pending', paidUntil: end },
      });
    }
    if (paidUntil && paidUntil > new Date()) {
      const user = await tx.user.findUniqueOrThrow({ where: { id: local.userId } });
      if (user.role === 'SUPERADMIN') throw new Error('Cannot change administrator role');
      await tx.user.update({ where: { id: user.id }, data: { role: 'PROFESSIONAL' } });
      const business = await tx.business.findFirst({ where: { ownerId: user.id } });
      if (!business) await tx.business.create({ data: { ownerId: user.id, name: local.businessName, category: local.category, description: local.description } });
    }
  }, { isolationLevel: 'Serializable' });
}
