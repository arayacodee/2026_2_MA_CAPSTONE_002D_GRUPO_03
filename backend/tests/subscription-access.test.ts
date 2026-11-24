import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import type { AddressInfo } from 'node:net';
Object.assign(process.env, { DATABASE_URL: 'postgresql://test:test@localhost/test', GOOGLE_CLIENT_ID: 'test', AUTH_SECRET: 'test-secret-with-at-least-32-characters', CLOUDINARY_CLOUD_NAME: 'test', CLOUDINARY_API_KEY: 'test', CLOUDINARY_API_SECRET: 'test', MP_ACCESS_TOKEN: 'test', MP_WEBHOOK_SECRET: 'secret', MP_RETURN_URL: 'https://example.com/companies?payment=return', MP_WEBHOOK_URL: 'https://example.com/api/subscriptions/webhook' });
const { prisma } = await import('../src/lib/prisma.js');
const { env } = await import('../src/config/env.js');
env.MP_TEST_PAYER_EMAIL = undefined;
const { default: routes } = await import('../src/routes/subscription.routes.js');
const { createSessionToken } = await import('../src/lib/session.js');

test('checkout exige sesión, fija importe, reutiliza intento y no permite cancelar otra cuenta', async () => {
  const original = { fetch: globalThis.fetch, user: prisma.user.findUnique, application: prisma.professionalApplication.findUnique, find: prisma.professionalSubscription.findUnique, first: prisma.professionalSubscription.findFirst, create: prisma.professionalSubscription.create, update: prisma.professionalSubscription.update };
  let local: any = null; let providerCalls = 0;
  prisma.user.findUnique = (async () => ({ id: 'client', email: 'client@example.com', role: 'CLIENT' })) as any;
  prisma.professionalApplication.findUnique = (async () => ({ businessName: 'Empresa', category: 'GENERAL' })) as any;
  prisma.professionalSubscription.findUnique = (async () => local) as any;
  prisma.professionalSubscription.findFirst = (async ({ where }: any) => { assert.equal(where.userId, 'client'); return null; }) as any;
  prisma.professionalSubscription.create = (async ({ data }: any) => { local = { ...data, status: 'creating' }; return local; }) as any;
  prisma.professionalSubscription.update = (async ({ data }: any) => { local = { ...local, ...data }; return local; }) as any;
  globalThis.fetch = (async (url: any, init: any) => {
    if (!String(url).startsWith('https://api.mercadopago.com')) return original.fetch(url, init);
    providerCalls++;
    const payload = JSON.parse(init.body);
    assert.equal(payload.payer_email, 'client@example.com');
    assert.deepEqual(payload.auto_recurring, { frequency: 1, frequency_type: 'months', transaction_amount: 7900, currency_id: 'CLP' });
    return new Response(JSON.stringify({ id: 'provider', external_reference: local.id, status: 'pending', auto_recurring: payload.auto_recurring, init_point: 'https://www.mercadopago.cl/subscriptions/checkout?preapproval_id=provider' }));
  }) as typeof fetch;
  const app = express(); app.use(express.json(), cookieParser()); app.use('/subscriptions', routes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/subscriptions`;
  const cookie = `cronos_session=${await createSessionToken('client')}`;
  const send = (path: string, authenticated = true, acceptedRecurring: unknown = true) => fetch(base + path, { method: 'POST', headers: { ...(authenticated ? { cookie } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify({ acceptedRecurring, price: 1, userId: 'victim' }) });
  try {
    assert.equal((await send('/checkout', false)).status, 401);
    assert.equal((await send('/webhook?data.id=provider&type=subscription_preapproval')).status, 401);
    assert.equal((await send('/checkout', true, false)).status, 400);
    assert.equal((await send('/checkout', true, 'true')).status, 400);
    assert.equal(local, null);
    assert.equal(providerCalls, 0);
    const first = await send('/checkout'); assert.equal(first.status, 200);
    const second = await send('/checkout'); assert.equal(second.status, 200);
    assert.deepEqual(await first.json(), await second.json()); assert.equal(providerCalls, 1);
    assert.equal((await send('/other-user-subscription/cancel')).status, 404);
    assert.equal(providerCalls, 1);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    globalThis.fetch = original.fetch; prisma.user.findUnique = original.user; prisma.professionalApplication.findUnique = original.application;
    prisma.professionalSubscription.findUnique = original.find; prisma.professionalSubscription.findFirst = original.first;
    prisma.professionalSubscription.create = original.create; prisma.professionalSubscription.update = original.update;
  }
});
