import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import type { AddressInfo } from 'node:net';

Object.assign(process.env, { DATABASE_URL: 'postgresql://test:test@localhost/test', GOOGLE_CLIENT_ID: 'test-client', AUTH_SECRET: 'test-secret-with-at-least-32-characters', CLOUDINARY_CLOUD_NAME: 'test', CLOUDINARY_API_KEY: 'test', CLOUDINARY_API_SECRET: 'test' });
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.TWILIO_VERIFY_SERVICE_SID;
const { prisma } = await import('../src/lib/prisma.js');
const { env } = await import('../src/config/env.js');
Object.assign(env, { MP_ACCESS_TOKEN: undefined, MP_WEBHOOK_SECRET: undefined, MP_RETURN_URL: undefined, MP_WEBHOOK_URL: undefined });
const { default: routes } = await import('../src/routes/account.routes.js');
const { createSessionToken } = await import('../src/lib/session.js');

test('contacto privado invalida verificación al cambiar teléfono y el boceto no permite comprar roles', async () => {
  const originals = { find: prisma.user.findUnique, transaction: prisma.$transaction, upsert: prisma.professionalApplication.upsert };
  let user: any = { id: 'client', email: 'client@example.com', role: 'CLIENT', phone: '+56912345678', phoneVerifiedAt: new Date(), pendingVerificationSid: 'old' };
  let writes = 0;
  prisma.user.findUnique = (async () => user) as any;
  prisma.$transaction = (async (callback: any) => callback({ user: { findUniqueOrThrow: async () => user, update: async (args: any) => { writes++; user = { ...user, ...args.data }; return user; } } })) as any;
  prisma.professionalApplication.upsert = (async (args: any) => { assert.equal(args.create.userId, 'client'); return { ...args.create, monthlyPrice: 7900, currency: 'CLP' }; }) as any;
  const app = express(); app.use(express.json(), cookieParser()); app.use('/api/account', routes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/account`;
  const cookie = `cronos_session=${await createSessionToken('client')}`;
  const request = (path: string, body: unknown, method = 'PATCH') => fetch(url + path, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const contact = { firstName: 'Martín', lastName: 'Ibarra', address: 'Santiago 123', phone: '+56912345678' };
  try {
    assert.equal((await request('/profile', { ...contact, role: 'SUPERADMIN' })).status, 400);
    assert.equal((await request('/profile', { ...contact, phone: '' })).status, 400);
    assert.equal(writes, 0);
    assert.equal((await request('/profile', contact)).status, 200);
    assert.ok(user.phoneVerifiedAt);
    assert.equal((await request('/profile', { ...contact, phone: '56 9 8765 4321' })).status, 200);
    assert.equal(user.phone, '+56987654321');
    assert.equal(user.phoneVerifiedAt, null);
    assert.equal(user.pendingVerificationSid, null);
    assert.equal(user.role, 'CLIENT');
    assert.equal((await request('/phone/send', {}, 'POST')).status, 503);
    assert.equal((await request('/phone/check', { code: '123456' }, 'POST')).status, 503);
    assert.equal(user.phoneVerifiedAt, null);
    const draft = { businessName: 'Centro de bienestar', category: 'WELLNESS' };
    assert.equal((await request('/professional-application', { ...draft, monthlyPrice: 1 }, 'PUT')).status, 400);
    const result = await request('/professional-application', draft, 'PUT');
    assert.equal(result.status, 200);
    const body: any = await result.json();
    assert.equal(body.paymentsAvailable, false);
    assert.equal(body.application.monthlyPrice, 7900);
    assert.equal(user.role, 'CLIENT');
  } finally {
    prisma.user.findUnique = originals.find; prisma.$transaction = originals.transaction; prisma.professionalApplication.upsert = originals.upsert;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
