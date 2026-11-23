import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
Object.assign(process.env, { DATABASE_URL: 'postgresql://test:test@localhost/test', GOOGLE_CLIENT_ID: 'test', AUTH_SECRET: 'test-secret-with-at-least-32-characters', CLOUDINARY_CLOUD_NAME: 'test', CLOUDINARY_API_KEY: 'test', CLOUDINARY_API_SECRET: 'test', MP_ACCESS_TOKEN: 'test', MP_WEBHOOK_SECRET: 'secret', MP_RETURN_URL: 'https://example.com/companies?payment=return', MP_WEBHOOK_URL: 'https://example.com/api/subscriptions/webhook' });
const { validWebhook, validPlan, invoicePeriodEnd } = await import('../src/lib/mercado-pago.js');
const { canReceiveBookings, syncSubscription } = await import('../src/lib/subscriptions.js');
const { prisma } = await import('../src/lib/prisma.js');
const remote = { id: 'provider', external_reference: 'local', status: 'authorized', init_point: 'https://www.mercadopago.cl/subscriptions/checkout', auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: 7900, currency_id: 'CLP' } };

test('el catálogo y la agenda usan el mismo período o habilitación guardados en la base', () => {
  const owner = { role: 'PROFESSIONAL' as const, isSuspended: false, accessGrant: null, subscriptions: [{ paidUntil: new Date(0) }] };
  const profile = { isArchived: false, owner };
  assert.equal(canReceiveBookings(profile), false);
  assert.equal(canReceiveBookings({ ...profile, owner: { ...owner, accessGrant: 'DEMO' } }), true);
  const paidOwner = { ...owner, subscriptions: [{ paidUntil: new Date(Date.now() + 86_400_000) }] };
  assert.equal(canReceiveBookings({ ...profile, owner: paidOwner }), true);
  assert.equal(canReceiveBookings({ ...profile, isArchived: true, owner: paidOwner }), false);
  assert.equal(canReceiveBookings({ ...profile, owner: { ...paidOwner, isSuspended: true } }), false);
});

test('firma rechaza identificadores manipulados, secretos incorrectos y firmas incompletas', () => {
  const signature = `ts=123,v1=${createHmac('sha256', 'secret').update('id:abc;request-id:request;ts:123;').digest('hex')}`;
  assert.equal(validWebhook('ABC', 'request', signature, 'secret'), true);
  assert.equal(validWebhook('different', 'request', signature, 'secret'), false);
  assert.equal(validWebhook('abc', 'request', signature, 'wrong'), false);
  assert.equal(validWebhook('abc', '', signature, 'secret'), false);
  assert.equal(validWebhook('abc', 'request', 'ts=123,v1=short', 'secret'), false);
});
test('verifica propietario lógico, moneda, precio y frecuencia sin confiar en el navegador', () => {
  assert.equal(validPlan(remote, 'local'), true);
  assert.equal(validPlan(remote, 'other'), false);
  for (const patch of [{ currency_id: 'ARS' }, { transaction_amount: 1 }, { frequency: 2 }, { frequency_type: 'days' }]) {
    assert.equal(validPlan({ ...remote, auto_recurring: { ...remote.auto_recurring, ...patch } }, 'local'), false);
  }
});
test('el período usa un mes calendario; pagos pendientes, reembolsados o de otro monto no activan', () => {
  const invoice = { id: 1, preapproval_id: 'provider', debit_date: '2024-01-31T12:00:00Z', currency_id: 'CLP', transaction_amount: 7900, payment: { id: 2, status: 'approved' } };
  assert.equal(invoicePeriodEnd(invoice)?.toISOString(), '2024-02-29T12:00:00.000Z');
  assert.equal(invoicePeriodEnd({ ...invoice, payment: { id: 2, status: 'pending' } }), null);
  assert.equal(invoicePeriodEnd({ ...invoice, payment: { id: 2, status: 'refunded' } }), null);
  assert.equal(invoicePeriodEnd({ ...invoice, transaction_amount: 790 }), null);
});

test('conciliación: autorización no activa, cobro activa una vez y reembolso retira período', async () => {
  const original = { fetch: globalThis.fetch, find: prisma.professionalSubscription.findUnique, transaction: prisma.$transaction };
  let status = 'pending'; let business: any = null; let created = 0; let role = 'CLIENT'; let paidUntil: Date | null = null;
  const invoice = { id: 1, preapproval_id: 'provider', debit_date: new Date().toISOString(), currency_id: 'CLP', transaction_amount: 7900, payment: { id: 2, status: 'approved' } };
  prisma.professionalSubscription.findUnique = (async () => ({ id: 'local', userId: 'user', providerId: 'provider', businessName: 'Empresa', category: 'GENERAL', updatedAt: new Date() })) as any;
  prisma.$transaction = (async (callback: any) => callback({
    professionalSubscription: { updateMany: async ({ data }: any) => { paidUntil = data.paidUntil; return { count: 1 }; } },
    subscriptionPayment: { upsert: async () => ({}) },
    user: { findUniqueOrThrow: async () => ({ id: 'user', role }), update: async () => { role = 'PROFESSIONAL'; } },
    business: { findFirst: async () => business, create: async () => { created++; business = { id: 'business' }; } },
  })) as any;
  globalThis.fetch = (async (url: any) => {
    const path = String(url);
    const body = path.includes('/preapproval/') ? remote : path.includes('/authorized_payments/search') ? { results: [invoice], paging: { total: 1 } } : { status, transaction_amount: 7900, currency_id: 'CLP' };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  try {
    await syncSubscription('provider'); assert.equal(created, 0); assert.equal(paidUntil, null);
    status = 'approved'; await syncSubscription('provider'); assert.equal(created, 1); assert.equal(role, 'PROFESSIONAL'); assert.ok(paidUntil);
    await syncSubscription('provider'); assert.equal(created, 1);
    status = 'refunded'; await syncSubscription('provider'); assert.equal(paidUntil, null);
  } finally { globalThis.fetch = original.fetch; prisma.professionalSubscription.findUnique = original.find; prisma.$transaction = original.transaction; }
});
