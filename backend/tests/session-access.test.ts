import { test } from 'node:test';
import assert from 'node:assert/strict';

// Test configuration never connects to Neon: all persistence calls used below are replaced.
Object.assign(process.env, {
  DATABASE_URL: 'postgresql://test:test@localhost/test',
  GOOGLE_CLIENT_ID: 'test-client', AUTH_SECRET: 'test-secret-with-at-least-32-characters',
  CLOUDINARY_CLOUD_NAME: 'test', CLOUDINARY_API_KEY: 'test', CLOUDINARY_API_SECRET: 'test',
});
const { prisma } = await import('../src/lib/prisma.js');
const { getSessions, getAttentionMetrics, updateSession, addEvidence, deleteEvidence } = await import('../src/controllers/session.controller.js');
const { requireRole } = await import('../src/middleware/auth.middleware.js');
const { deleteBusinessAvatar, deleteBusinessCover } = await import('../src/controllers/business.controller.js');

function response() {
  return { statusCode: 200, body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; }, send() { return this; }
  };
}

test('historial restringido al profesional propietario y paginado', async () => {
  const original = prisma.clientSession.findMany;
  let query: any;
  prisma.clientSession.findMany = (async (args: any) => { query = args; return []; }) as any;
  try {
    const res = response();
    await getSessions({ authUser: { id: 'owner' }, query: {} } as any, res as any);
    assert.equal(query.where.business.ownerId, 'owner');
    assert.equal(query.take, 51);
    assert.deepEqual(res.body, { items: [], nextCursor: null });
  } finally { prisma.clientSession.findMany = original; }
});

test('un cliente no puede usar los endpoints profesionales de historial', () => {
  const res = response();
  let reached = false;
  requireRole('PROFESSIONAL')({ authUser: { role: 'CLIENT' } } as any, res as any, () => { reached = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(reached, false);
});

test('paginación limita resultados, devuelve cursor y rechaza tamaños inválidos', async () => {
  const original = prisma.clientSession.findMany;
  let query: any;
  prisma.clientSession.findMany = (async (args: any) => { query = args; return Array.from({ length: 11 }, (_, i) => ({ id: `session-${i}` })); }) as any;
  try {
    const res = response();
    const cursor = '00000000-0000-4000-8000-000000000001';
    await getSessions({ authUser: { id: 'owner' }, query: { limit: '10', cursor } } as any, res as any);
    assert.equal(query.take, 11);
    assert.equal(query.skip, 1);
    assert.equal(query.cursor.id, cursor);
    assert.equal(res.body.items.length, 10);
    assert.equal(res.body.nextCursor, 'session-9');
    for (const limit of ['0', '51', '-1', 'abc', '1.5']) {
      const invalid = response();
      await getSessions({ query: { limit } } as any, invalid as any);
      assert.equal(invalid.statusCode, 400);
    }
  } finally { prisma.clientSession.findMany = original; }
});

test('métricas filtran propietario, periodo acotado y solo reservas completadas', async () => {
  const originals = { business: prisma.business.findFirst, sessions: prisma.clientSession.findMany };
  let lookup: any;
  let query: any;
  prisma.business.findFirst = (async (args: any) => { lookup = args; return { id: 'own-business', timezone: 'America/Santiago' }; }) as any;
  prisma.clientSession.findMany = (async (args: any) => { query = args; return []; }) as any;
  try {
    const res = response();
    await getAttentionMetrics({ authUser: { id: 'owner' }, query: { month: '2024-02' } } as any, res as any);
    assert.equal(lookup.where.ownerId, 'owner');
    assert.equal(query.where.businessId, 'own-business');
    assert.equal(query.where.reservation.status, 'COMPLETED');
    assert.equal(query.select.amount, true);
    assert.equal(query.select.reservation, undefined);
    assert.ok(query.where.occurredAt.gte instanceof Date);
    assert.ok(query.where.occurredAt.lt - query.where.occurredAt.gte < 36 * 86400000);
    assert.equal(res.body.monthCount, 0);
    assert.equal(res.body.month, '2024-02');
    assert.equal(res.body.daily.length, 29);
    prisma.business.findFirst = (async () => null) as any;
    const missing = response();
    await getAttentionMetrics({ authUser: { id: 'owner' }, query: {} } as any, missing as any);
    assert.equal(missing.statusCode, 404);
  } finally { prisma.business.findFirst = originals.business; prisma.clientSession.findMany = originals.sessions; }
});

test('el filtro mensual pagina por fecha local sin perder registros en los límites', async () => {
  const original = prisma.clientSession.findMany;
  const business = { timezone: 'America/Santiago' };
  const dates = [
    '2026-11-01T03:00:00Z', '2026-11-01T02:59:59Z', '2026-10-20T15:00:00Z',
    '2026-10-01T03:00:00Z', '2026-10-01T02:59:59Z',
  ];
  const rows = dates.map((date, index) => ({
    id: `00000000-0000-4000-8000-00000000000${index}`,
    business,
    occurredAt: new Date(date),
  }));
  prisma.clientSession.findMany = (async (args: any) => {
    assert.equal(args.where.business.ownerId, 'owner');
    assert.ok(args.where.occurredAt.gte instanceof Date);
    const start = args.cursor ? rows.findIndex(row => row.id === args.cursor.id) + args.skip : 0;
    return rows.slice(start, start + args.take);
  }) as any;
  try {
    const query = { month: '2026-10', limit: '2' };
    const first = response();
    await getSessions({ authUser: { id: 'owner' }, query } as any, first as any);
    assert.deepEqual(first.body, { items: rows.slice(1, 3), nextCursor: rows[2].id });
    const second = response();
    await getSessions({ authUser: { id: 'owner' }, query: { ...query, cursor: first.body.nextCursor } } as any, second as any);
    assert.deepEqual(second.body, { items: [rows[3]], nextCursor: null });
  } finally { prisma.clientSession.findMany = original; }
});

test('el historial y las métricas rechazan meses inválidos', async () => {
  for (const handler of [getSessions, getAttentionMetrics]) {
    for (const month of ['2026-00', '2026-13', '2026-2', ['2026-10', '2026-11']]) {
      const res = response();
      await handler({ query: { month } } as any, res as any);
      assert.equal(res.statusCode, 400);
    }
  }
});

test('una nota no puede editar una atención ajena', async () => {
  const original = prisma.clientSession.updateMany;
  let query: any;
  prisma.clientSession.updateMany = (async (args: any) => { query = args; return { count: 0 }; }) as any;
  try {
    const res = response();
    await updateSession({ authUser: { id: 'owner' }, params: { id: '00000000-0000-4000-8000-000000000001' }, body: { notes: 'Nota' } } as any, res as any);
    assert.equal(query.where.business.ownerId, 'owner');
    assert.equal(res.statusCode, 404);
  } finally { prisma.clientSession.updateMany = original; }
});

test('no sube imágenes a Cloudinary si la atención no pertenece al usuario', async () => {
  const original = prisma.clientSession.findFirst;
  prisma.clientSession.findFirst = (async () => null) as any;
  try {
    const res = response();
    await addEvidence({ authUser: { id: 'owner' }, params: { id: '00000000-0000-4000-8000-000000000001' }, body: {}, file: { buffer: Buffer.from('test') } } as any, res as any);
    assert.equal(res.statusCode, 404);
  } finally { prisma.clientSession.findFirst = original; }
});

test('no elimina imágenes ajenas', async () => {
  const original = prisma.sessionEvidence.findFirst;
  let query: any;
  prisma.sessionEvidence.findFirst = (async (args: any) => { query = args; return null; }) as any;
  try {
    const res = response();
    await deleteEvidence({ authUser: { id: 'owner' }, params: { id: '00000000-0000-4000-8000-000000000001' } } as any, res as any);
    assert.equal(query.where.session.business.ownerId, 'owner');
    assert.equal(res.statusCode, 404);
  } finally { prisma.sessionEvidence.findFirst = original; }
});

test('elimina la referencia de avatar y portada solo en el negocio del usuario', async () => {
  const originals = { findFirst: prisma.business.findFirst, updateMany: prisma.business.updateMany, findUniqueOrThrow: prisma.business.findUniqueOrThrow };
  const business = { id: 'business', avatarUrl: null, avatarPublicId: null, coverUrl: null, coverPublicId: null };
  let lookup: any;
  let update: any;
  prisma.business.findFirst = (async (args: any) => { lookup = args; return business; }) as any;
  prisma.business.updateMany = (async (args: any) => { update = args; return { count: 1 }; }) as any;
  prisma.business.findUniqueOrThrow = (async () => business) as any;
  try {
    for (const [handler, kind] of [[deleteBusinessAvatar, 'avatar'], [deleteBusinessCover, 'cover']] as const) {
      const res = response();
      await handler({ authUser: { id: 'owner' } } as any, res as any);
      assert.equal(lookup.where.ownerId, 'owner');
      assert.equal(update.where.ownerId, 'owner');
      assert.equal(update.data[`${kind}Url`], null);
      assert.equal(update.data[`${kind}PublicId`], null);
      assert.equal(res.statusCode, 200);
    }
  } finally { Object.assign(prisma.business, originals); }
});

test('no elimina una imagen reemplazada concurrentemente', async () => {
  const originals = { findFirst: prisma.business.findFirst, updateMany: prisma.business.updateMany };
  prisma.business.findFirst = (async () => ({ id: 'business', avatarUrl: 'old-url', avatarPublicId: 'old-id' })) as any;
  prisma.business.updateMany = (async () => ({ count: 0 })) as any;
  try {
    const res = response();
    await deleteBusinessAvatar({ authUser: { id: 'owner' } } as any, res as any);
    assert.equal(res.statusCode, 409);
  } finally { Object.assign(prisma.business, originals); }
});
