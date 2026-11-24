import { test } from 'node:test';
import assert from 'node:assert/strict';
Object.assign(process.env, { DATABASE_URL: 'postgresql://test:test@localhost/test', GOOGLE_CLIENT_ID: 'test-client', AUTH_SECRET: 'test-secret-with-at-least-32-characters', CLOUDINARY_CLOUD_NAME: 'test', CLOUDINARY_API_KEY: 'test', CLOUDINARY_API_SECRET: 'test' });
const { prisma } = await import('../src/lib/prisma.js');
const { register, passwordLogin } = await import('../src/controllers/auth.controller.js');
const { verifyAdminPassword } = await import('../src/lib/admin-password.js');
function response() { return { code: 200, body: null as any, cookies: [] as any[], status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; }, cookie(...args: any[]) { this.cookies.push(args); return this; } }; }
test('registro guarda hash y teléfono sin SMS, rechaza duplicados y roles; login verifica contraseña y no filtra hash', async () => {
  const original = { first: prisma.user.findFirst, create: prisma.user.create, unique: prisma.user.findUnique };
  let stored: any = null;
  prisma.user.findFirst = (async () => stored) as any;
  prisma.user.create = (async (args: any) => { stored = { id: 'client', ...args.data }; const { passwordHash, ...safe } = stored; return safe; }) as any;
  prisma.user.findUnique = (async () => { const { passwordHash, ...safe } = stored; return safe; }) as any;
  const contact = { email: ' CLIENT@EXAMPLE.COM ', password: 'secret-password', firstName: 'Martín', lastName: 'Ibarra', phone: '56 9 1234 5678', address: 'Santiago 123' };
  try {
    const role = response(); await register({ body: { ...contact, role: 'SUPERADMIN' } } as any, role as any); assert.equal(role.code, 400); assert.equal(stored, null);
    const invalidPhone = response(); await register({ body: { ...contact, phone: 'sin teléfono' } } as any, invalidPhone as any);
    assert.equal(invalidPhone.code, 400); assert.equal(stored, null);
    const created = response(); await register({ body: contact } as any, created as any);
    assert.equal(created.code, 201); assert.equal(stored.email, 'client@example.com'); assert.equal(stored.role, 'CLIENT'); assert.equal(stored.phone, '+56912345678');
    assert.notEqual(stored.passwordHash, contact.password); assert.ok(await verifyAdminPassword(contact.password, stored.passwordHash)); assert.equal(created.body.user.passwordHash, undefined); assert.equal(created.cookies.length, 1);
    const duplicate = response(); await register({ body: contact } as any, duplicate as any); assert.equal(duplicate.code, 409);
    const wrong = response(); await passwordLogin({ body: { email: contact.email, password: 'incorrect' } } as any, wrong as any); assert.equal(wrong.code, 401); assert.equal(wrong.cookies.length, 0);
    stored.role = 'PROFESSIONAL';
    const valid = response(); await passwordLogin({ body: { email: contact.email, password: contact.password } } as any, valid as any); assert.equal(valid.code, 200); assert.equal(valid.body.user.role, 'PROFESSIONAL'); assert.equal(valid.body.user.passwordHash, undefined);
    stored.role = 'SUPERADMIN'; const admin = response(); await passwordLogin({ body: { email: contact.email, password: contact.password } } as any, admin as any); assert.equal(admin.code, 401);
  } finally { prisma.user.findFirst = original.first; prisma.user.create = original.create; prisma.user.findUnique = original.unique; }
});
