import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteAdminRecord, DeletionError } from '../src/lib/admin-deletion.js';

function transaction({ role = 'CLIENT', linked = false } = {}) {
  const writes: string[] = [];
  const remove = (model: string) => async () => { writes.push(model); return { count: 1 }; };
  const tx = {
    user: { findUnique: async () => ({ id: 'target', role }), count: async () => Number(linked), deleteMany: remove('user') },
    business: { findUnique: async () => ({ avatarPublicId: 'avatar', coverPublicId: 'cover' }), delete: remove('business') },
    businessPhoto: { findMany: async () => [{ imagePublicId: 'photo' }] },
    service: { delete: remove('service'), deleteMany: remove('service') },
    availability: { delete: remove('availability'), deleteMany: remove('availability') },
    reservation: { count: async () => Number(linked) },
    sessionEvidence: { delete: async () => { writes.push('evidence'); return { imagePublicId: 'photo', deliveryType: 'authenticated' }; } },
  };
  return { tx: tx as unknown as Parameters<typeof deleteAdminRecord>[0], writes };
}

test('protege el historial aunque se solicite eliminar un usuario, negocio o servicio relacionado', async () => {
  for (const resource of ['users', 'businesses', 'services', 'reservations', 'sessions'] as const) {
    const { tx, writes } = transaction({ linked: true });
    await assert.rejects(deleteAdminRecord(tx, resource, 'target', 'operator'),
      (error: unknown) => error instanceof DeletionError && error.status === 409);
    assert.deepEqual(writes, []);
  }
});

test('protege la cuenta de superadmin y permite quitar una cuenta sin actividad', async () => {
  const protectedAccount = transaction({ role: 'SUPERADMIN' });
  await assert.rejects(deleteAdminRecord(protectedAccount.tx, 'users', 'target', 'operator'), DeletionError);
  assert.deepEqual(protectedAccount.writes, []);
  const emptyAccount = transaction();
  await deleteAdminRecord(emptyAccount.tx, 'users', 'target', 'operator');
  assert.deepEqual(emptyAccount.writes, ['user']);
});

test('limpia únicamente la configuración e imágenes de un negocio sin historial', async () => {
  const { tx, writes } = transaction();
  const images = await deleteAdminRecord(tx, 'businesses', 'target', 'operator');
  assert.deepEqual(writes, ['service', 'availability', 'business']);
  assert.deepEqual(images, ['avatar', 'cover', 'photo'].map(publicId => ({ publicId, type: 'upload' })));
});

test('conserva el tipo de entrega de la evidencia para su limpieza en Cloudinary', async () => {
  const { tx, writes } = transaction();
  const images = await deleteAdminRecord(tx, 'evidences', 'target', 'operator');
  assert.deepEqual(writes, ['evidence']);
  assert.deepEqual(images, [{ publicId: 'photo', type: 'authenticated' }]);
});
