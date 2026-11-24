import { test } from 'node:test';
import assert from 'node:assert/strict';
Object.assign(process.env, {
  DATABASE_URL: 'postgresql://test:test@localhost/test', GOOGLE_CLIENT_ID: 'test-client',
  AUTH_SECRET: 'test-secret-with-at-least-32-characters', CLOUDINARY_CLOUD_NAME: 'test', CLOUDINARY_API_KEY: 'test', CLOUDINARY_API_SECRET: 'test'
});
const { prisma } = await import('../src/lib/prisma.js');
const { createBusiness, updateMyBusiness } = await import('../src/controllers/business.controller.js');
function response() { return { statusCode: 200, body: undefined as any, status(code: number) { this.statusCode = code; return this; }, json(data: any) { this.body = data; return this; } }; }
test('crea un perfil de terapias con datos públicos y deriva el propietario de la sesión', async () => {
  const originals = { findFirst: prisma.business.findFirst, create: prisma.business.create };
  let saved: any;
  prisma.business.findFirst = (async () => null) as any;
  prisma.business.create = (async (args: any) => { saved = args.data; return saved; }) as any;
  try {
    const res = response();
    await createBusiness({ authUser: { id: 'owner' }, body: { name: 'Centro de bienestar', category: 'WELLNESS', professionalName: 'Terapeuta', specialties: 'Reiki', address: 'Dirección pública', attentionMode: 'BOTH', ownerId: 'another-owner', notes: 'private-note' } } as any, res as any);
    assert.equal(res.statusCode, 201); assert.equal(saved.ownerId, 'owner'); assert.equal(saved.category, 'WELLNESS'); assert.equal(saved.attentionMode, 'BOTH'); assert.equal(saved.notes, undefined);
  } finally { Object.assign(prisma.business, originals); }
});
test('rechaza categorías y modalidades inválidas y permite limpiar campos sin cambiar el tipo omitido', async () => {
  const originals = { findFirst: prisma.business.findFirst, update: prisma.business.update };
  let args: any;
  prisma.business.findFirst = (async (query: any) => { assert.equal(query.where.ownerId, 'owner'); return { id: 'owned-business' }; }) as any;
  prisma.business.update = (async (query: any) => { args = query; return query.data; }) as any;
  try {
    for (const body of [{ name: '   ' }, { category: 'UNKNOWN' }, { attentionMode: 'INVALID' }, { specialties: 'x'.repeat(301) }]) {
      const res = response(); await updateMyBusiness({ authUser: { id: 'owner' }, body } as any, res as any); assert.equal(res.statusCode, 400);
    }
    assert.equal(args, undefined);
    const res = response(); await updateMyBusiness({ authUser: { id: 'owner' }, body: { specialties: null, address: null, attentionMode: null } } as any, res as any);
    assert.equal(res.statusCode, 200); assert.equal(args.where.id, 'owned-business'); assert.deepEqual(args.data, { specialties: null, address: null, attentionMode: null });
  } finally { Object.assign(prisma.business, originals); }
});
