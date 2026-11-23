import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import type { AddressInfo } from 'node:net';

Object.assign(process.env, {
  DATABASE_URL: 'postgresql://test:test@localhost/test', GOOGLE_CLIENT_ID: 'test-client',
  AUTH_SECRET: 'test-secret-with-at-least-32-characters', CLOUDINARY_CLOUD_NAME: 'test',
  CLOUDINARY_API_KEY: 'test', CLOUDINARY_API_SECRET: 'test',
});
const { prisma } = await import('../src/lib/prisma.js');
const { default: routes } = await import('../src/routes/admin.routes.js');
const { createSessionToken } = await import('../src/lib/session.js');

test('administración exige superadmin, consulta global y bloquea escalamiento y cambios de identidad', async () => {
  const originals = { user: prisma.user.findUnique, users: prisma.user.findMany, business: prisma.business.findMany, update: prisma.user.updateMany, updateOne: prisma.user.update, transaction: prisma.$transaction };
  const audit: { action: string }[] = [];
  prisma.$transaction = (async (callback: any) => callback({
    user: prisma.user, business: prisma.business, professionalSubscription: prisma.professionalSubscription,
    adminAction: { create: async ({ data }: { data: { action: string } }) => audit.push(data) },
  })) as any;
  let role: 'CLIENT' | 'PROFESSIONAL' | 'SUPERADMIN' = 'CLIENT';
  let businessQuery: any;
  let writes = 0;
  let temporaryEnd: Date | null = null;
  let accessTargetRole: 'SUPERADMIN' | 'PROFESSIONAL' | 'CLIENT' = 'SUPERADMIN';
  prisma.user.findUnique = (async (args: { select?: { manualAccessUntil?: boolean } }) => args.select?.manualAccessUntil
    ? { role: accessTargetRole, manualAccessUntil: temporaryEnd }
    : { id: 'admin', email: 'admin@example.com', name: 'Admin', role }) as any;
  prisma.user.findMany = (async () => []) as any;
  prisma.business.findMany = (async (args: any) => { businessQuery = args; return Array.from({ length: 51 }, (_, index) => ({ id: String(index) })); }) as any;
  prisma.user.updateMany = (async () => { writes++; return { count: 1 }; }) as any;
  const app = express(); app.use(express.json(), cookieParser()); app.use('/api/admin', routes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin`;
  const cookie = `cronos_session=${await createSessionToken('admin')}`;
  const id = '00000000-0000-4000-8000-000000000001';
  const patch = (data: unknown) => fetch(`${url}/users/${id}`, { method: 'PATCH', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const grant = (months: number, subscriptionId?: string) => fetch(`${url}/users/${id}/temporary-access`, {
    method: 'PATCH', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ months, reason: 'Período de prueba', subscriptionId }),
  });
  try {
    assert.equal((await fetch(`${url}/users`)).status, 401);
    for (const denied of ['CLIENT', 'PROFESSIONAL'] as const) {
      role = denied;
      assert.equal((await fetch(`${url}/users`, { headers: { cookie } })).status, 403);
      assert.equal((await fetch(`${url}/evidences/businesses`, { headers: { cookie } })).status, 403);
      assert.equal((await fetch(`${url}/reservations?businessId=${id}`, { headers: { cookie } })).status, 403);
      assert.equal((await patch({ role: 'PROFESSIONAL' })).status, 403);
      assert.equal((await grant(2)).status, 403);
      assert.equal((await fetch(`${url}/users/${id}/password`, { method: 'PATCH', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'new-password' }) })).status, 403);
      assert.equal((await fetch(`${url}/businesses/${id}`, { method: 'DELETE', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }) })).status, 403);
    }
    role = 'SUPERADMIN';
    assert.equal((await fetch(`${url}/businesses/${id}`, { method: 'DELETE', headers: { cookie } })).status, 400);
    const response = await fetch(`${url}/businesses?page=2`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const body = await response.json() as { items: unknown[]; hasMore: boolean };
    assert.equal(body.items.length, 50); assert.equal(body.hasMore, true);
    assert.equal(businessQuery.where, undefined); assert.equal(businessQuery.skip, 50);
    assert.equal((await patch({ role: 'SUPERADMIN' })).status, 400);
    assert.equal((await patch({ email: 'replacement@example.com' })).status, 400);
    assert.equal((await patch({ googleId: 'replacement' })).status, 400);
    assert.equal((await patch({ role: 'CLIENT' })).status, 409);
    assert.equal(writes, 0);
    assert.equal((await fetch(`${url}/users/${id}/password`, { method: 'PATCH', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'short' }) })).status, 400);
    const { verifyAdminPassword } = await import('../src/lib/admin-password.js');
    prisma.user.updateMany = (async (args: any) => {
      assert.equal(args.where.id, id); assert.deepEqual(args.where.role, { not: 'SUPERADMIN' });
      assert.notEqual(args.data.passwordHash, 'new-password');
      assert.ok(await verifyAdminPassword('new-password', args.data.passwordHash));
      return { count: 1 };
    }) as any;
    const changed = await fetch(`${url}/users/${id}/password`, { method: 'PATCH', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'new-password' }) });
    assert.equal(changed.status, 200); assert.deepEqual(await changed.json(), { message: 'Contraseña actualizada.' });
    prisma.user.updateMany = (async () => ({ count: 0 })) as any;
    assert.equal((await fetch(`${url}/users/${id}/password`, { method: 'PATCH', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'new-password' }) })).status, 404);
    assert.equal((await fetch(`${url}/users?page=0`, { headers: { cookie } })).status, 400);
    assert.equal((await grant(3)).status, 404);
    accessTargetRole = 'PROFESSIONAL';
    for (const invalid of [0, 1.5, 4]) assert.equal((await grant(invalid)).status, 400);
    prisma.user.update = (async ({ data }: { data: { isSuspended: boolean; accessGrant: null; manualAccessUntil: Date } }) => {
      assert.equal(data.isSuspended, false);
      assert.equal(data.accessGrant, null);
      temporaryEnd = data.manualAccessUntil;
      return { id };
    }) as any;
    const firstEnd = (await (await grant(3)).json() as { manualAccessUntil: string }).manualAccessUntil;
    assert.ok(Date.parse(firstEnd) > Date.now());
    const shorter = await grant(1);
    assert.equal(shorter.status, 200);
    assert.equal((await shorter.json() as { manualAccessUntil: string }).manualAccessUntil, firstEnd);
    assert.equal(audit.filter(item => item.action === 'temporary_access').length, 2);
    accessTargetRole = 'CLIENT';
    assert.equal((await grant(2)).status, 404);
    const subscriptionId = '00000000-0000-4000-8000-000000000002';
    const saved = { subscription: prisma.professionalSubscription.findUnique, business: prisma.business.findUnique, create: prisma.business.create };
    try {
      prisma.professionalSubscription.findUnique = (async ({ where }: { where: { id: string; userId: string } }) => {
        assert.equal(where.userId, id);
        return where.id === subscriptionId ? { businessName: 'Estudio de prueba', category: 'GENERAL', description: null } : null;
      }) as any;
      prisma.business.findUnique = (async () => null) as any;
      let created = 0;
      prisma.business.create = (async ({ data }: { data: { ownerId: string } }) => {
        assert.equal(data.ownerId, id);
        created++;
        return { id: 'business' };
      }) as any;
      assert.equal((await grant(2, id)).status, 404);
      assert.equal(created, 0);
      assert.equal((await grant(2, subscriptionId)).status, 200);
      assert.equal(created, 1);
    } finally {
      prisma.professionalSubscription.findUnique = saved.subscription;
      prisma.business.findUnique = saved.business;
      prisma.business.create = saved.create;
    }
  } finally {
    prisma.user.findUnique = originals.user; prisma.user.findMany = originals.users;
    prisma.user.update = originals.updateOne;
    prisma.business.findMany = originals.business; prisma.user.updateMany = originals.update; prisma.$transaction = originals.transaction;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('pagina los negocios por módulo y filtra los registros antes de paginarlos', async () => {
  const originals = {
    user: prisma.user.findUnique,
    business: prisma.business.findMany,
    service: prisma.service.findMany,
    evidence: prisma.sessionEvidence.findMany,
  };
  const businessId = '00000000-0000-4000-8000-000000000001';
  const rows = Array.from({ length: 3 }, (_, index) => ({ id: String(index) }));
  prisma.user.findUnique = (async () => ({ id: 'admin', role: 'SUPERADMIN' })) as any;
  prisma.business.findMany = (async (args: any) => {
    assert.deepEqual(args.where, { clientSessions: { some: { evidences: { some: {} } } } });
    assert.deepEqual(args.orderBy, [{ name: 'asc' }, { id: 'asc' }]);
    assert.equal(args.skip, 2);
    assert.equal(args.take, 3);
    return rows;
  }) as any;
  prisma.service.findMany = (async (args: any) => {
    assert.deepEqual(args.where, { businessId });
    assert.equal(args.skip, 2);
    assert.equal(args.take, 3);
    return rows;
  }) as any;
  prisma.sessionEvidence.findMany = (async (args: any) => {
    assert.deepEqual(args.where, { session: { businessId } });
    assert.equal(args.skip, 2);
    assert.equal(args.take, 3);
    return rows;
  }) as any;

  const app = express();
  app.use(cookieParser());
  app.use('/api/admin', routes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin`;
  const cookie = `cronos_session=${await createSessionToken('admin')}`;
  const get = (path: string) => fetch(`${url}/${path}`, { headers: { cookie } });
  try {
    for (const path of [
      'evidences/businesses?page=2&limit=2',
      `services?businessId=${businessId}&page=2&limit=2`,
      `evidences?businessId=${businessId}&page=2&limit=2`,
    ]) {
      const response = await get(path);
      assert.equal(response.status, 200);
      const items = path.startsWith('evidences?') ? rows.slice(0, 2).map(row => ({ ...row, imageUrl: null })) : rows.slice(0, 2);
      assert.deepEqual(await response.json(), { items, hasMore: true });
    }
    assert.equal((await get('services?businessId=invalid')).status, 400);
    assert.equal((await get(`users?businessId=${businessId}`)).status, 400);
    assert.equal((await get('services/businesses?limit=51')).status, 400);
  } finally {
    prisma.user.findUnique = originals.user;
    prisma.business.findMany = originals.business;
    prisma.service.findMany = originals.service;
    prisma.sessionEvidence.findMany = originals.evidence;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
