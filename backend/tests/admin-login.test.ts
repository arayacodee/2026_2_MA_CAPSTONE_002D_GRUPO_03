import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashAdminPassword, verifyAdminPassword } from '../src/lib/admin-password.js';
import { adminLoginLimit } from '../src/middleware/admin-login-limit.js';

const passwordHash = await hashAdminPassword('test-password');
Object.assign(process.env, {
  DATABASE_URL: 'postgresql://test:test@localhost/test', GOOGLE_CLIENT_ID: 'test-client',
  AUTH_SECRET: 'test-secret-with-at-least-32-characters', CLOUDINARY_CLOUD_NAME: 'test',
  CLOUDINARY_API_KEY: 'test', CLOUDINARY_API_SECRET: 'test', SUPERADMIN_LOGIN: 'superadmin@cronos',
  SUPERADMIN_PASSWORD_HASH: passwordHash,
});
const { prisma } = await import('../src/lib/prisma.js');
const { adminLogin } = await import('../src/controllers/auth.controller.js');
const { verifySessionToken } = await import('../src/lib/session.js');
const { env } = await import('../src/config/env.js');
function response() {
  return { statusCode: 200, body: undefined as any, cookies: [] as any[], headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; }, json(body: any) { this.body = body; return this; },
    cookie(...args: any[]) { this.cookies.push(args); return this; }, setHeader(key: string, value: string) { this.headers[key] = value; return this; }
  };
}
test('hash con sal aleatoria, comparación y rechazo de contraseñas incorrectas', async () => {
  assert.equal(await verifyAdminPassword('test-password', passwordHash), true);
  assert.equal(await verifyAdminPassword('wrong-password', passwordHash), false);
  assert.notEqual(await hashAdminPassword('test-password'), passwordHash);
  assert.equal(await verifyAdminPassword('test-password', 'malformed'), false);
});
test('el acceso con el hash de entorno requiere una cuenta superadmin habilitada', async () => {
  const original = prisma.user.findUnique;
  const originalHash = env.SUPERADMIN_PASSWORD_HASH;
  let lookups = 0;
  let user: any = { id: 'shared-admin', email: 'superadmin@cronos', name: 'Admin', role: 'SUPERADMIN' };
  prisma.user.findUnique = (async () => { lookups++; return user; }) as any;
  const request = (email = 'superadmin@cronos', password = 'test-password', origin?: string) => ({ body: { email, password }, headers: origin ? { origin } : {} }) as any;
  try {
    const wrongPassword = response(); await adminLogin(request(undefined, 'wrong'), wrongPassword as any);
    assert.equal(wrongPassword.statusCode, 401); assert.equal(wrongPassword.cookies.length, 0);
    const wrongUser = response(); await adminLogin(request('client@example.com'), wrongUser as any);
    assert.equal(wrongUser.statusCode, 401);
    const otherOrigin = response(); await adminLogin(request(undefined, undefined, 'https://other.example'), otherOrigin as any);
    assert.equal(otherOrigin.statusCode, 403); assert.equal(lookups, 2);
    user.role = 'CLIENT'; const client = response(); await adminLogin(request(), client as any);
    assert.equal(client.statusCode, 403); assert.equal(client.cookies.length, 0);
    user = null; const absent = response(); await adminLogin(request(), absent as any); assert.equal(absent.statusCode, 403);
    user = { id: 'shared-admin', email: 'superadmin@cronos', name: 'Admin', role: 'SUPERADMIN' };
    const success = response(); await adminLogin(request(' SUPERADMIN@CRONOS '), success as any);
    assert.equal(success.statusCode, 200); assert.equal(success.body.user.role, 'SUPERADMIN');
    const [name, token, options] = success.cookies[0];
    assert.equal(name, 'cronos_session'); assert.equal(options.httpOnly, true); assert.equal(options.sameSite, 'lax');
    assert.equal((await verifySessionToken(token)).userId, 'shared-admin');
    env.SUPERADMIN_PASSWORD_HASH = undefined;
    const disabled = response(); await adminLogin(request(), disabled as any); assert.equal(disabled.statusCode, 503);
  } finally { prisma.user.findUnique = original; env.SUPERADMIN_PASSWORD_HASH = originalHash; }
});

test('el hash de la base habilita el acceso sin configuración local y prevalece al rotar la contraseña', async () => {
  const original = prisma.user.findUnique;
  const originalHash = env.SUPERADMIN_PASSWORD_HASH;
  const user = {
    id: 'shared-admin', email: 'superadmin@cronos', name: 'Admin', role: 'SUPERADMIN',
    passwordHash: await hashAdminPassword('shared-password'),
  };
  prisma.user.findUnique = (async () => user) as any;
  const request = (password: string) => ({ body: { email: user.email, password }, headers: {} }) as any;
  try {
    const rotated = response();
    await adminLogin(request('test-password'), rotated as any);
    assert.equal(rotated.statusCode, 401);
    assert.equal(rotated.cookies.length, 0);

    env.SUPERADMIN_PASSWORD_HASH = undefined;
    const success = response();
    await adminLogin(request('shared-password'), success as any);
    assert.equal(success.statusCode, 200);
    assert.equal(success.body.user.role, 'SUPERADMIN');
    assert.equal('passwordHash' in success.body.user, false);
    assert.equal((await verifySessionToken(success.cookies[0][1])).userId, user.id);
  } finally { prisma.user.findUnique = original; env.SUPERADMIN_PASSWORD_HASH = originalHash; }
});

test('límite por dirección bloquea el undécimo intento y permite otra dirección', () => {
  const limit = adminLoginLimit();
  let calls = 0;
  for (let index = 0; index < 11; index++) {
    const res = response(); limit({ ip: '127.0.0.1' } as any, res as any, () => { calls++; });
    assert.equal(res.statusCode, index < 10 ? 200 : 429);
    if (index === 10) assert.ok(Number(res.headers['Retry-After']) > 0);
  }
  assert.equal(calls, 10);
  const res = response(); limit({ ip: '127.0.0.2' } as any, res as any, () => { calls++; });
  assert.equal(calls, 11);
});
