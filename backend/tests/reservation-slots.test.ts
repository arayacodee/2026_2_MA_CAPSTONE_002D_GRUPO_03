import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import type { Prisma } from '../src/generated/prisma/client.js';

Object.assign(process.env, {
  DATABASE_URL: 'postgresql://test:test@localhost/test',
  GOOGLE_CLIENT_ID: 'test',
  AUTH_SECRET: 'test-secret-with-at-least-32-characters',
  CLOUDINARY_CLOUD_NAME: 'test',
  CLOUDINARY_API_KEY: 'test',
  CLOUDINARY_API_SECRET: 'test',
});
const { prisma } = await import('../src/lib/prisma.js');
const { createReservation } = await import('../src/controllers/reservation.controller.js');

test('acepta las horas publicadas y rechaza minutos intermedios del mismo bloque', async () => {
  const service = {
    id: '00112233-4455-4677-8899-aabbccddeeff',
    businessId: 'business',
    name: 'Consulta',
    price: 10000,
    durationMin: 30,
    isActive: true,
    business: { id: 'business', timezone: 'UTC', isArchived: false, owner: { role: 'PROFESSIONAL', accessGrant: true } },
  };
  let writes = 0;
  const tx = {
    service: { findUnique: async () => service },
    availability: { findFirst: async () => ({ startTime: '09:15', endTime: '11:15' }) },
    scheduleException: { findUnique: async () => null },
    reservation: { findFirst: async () => null, create: async () => { writes++; return { id: 'reserved' }; } },
  } as unknown as Prisma.TransactionClient;
  const original = prisma.$transaction;
  prisma.$transaction = (async (operation: (client: Prisma.TransactionClient) => Promise<unknown>) => operation(tx)) as typeof original;
  const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const send = async (time: string) => {
    const res = { code: 0, body: {} as unknown, status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; return this; } };
    const req = { authUser: { id: 'client' }, body: { serviceId: service.id, startsAt: `${day}T${time}:00Z` } };
    await createReservation(req as Request, res as unknown as Response);
    return res;
  };
  try {
    const invalid = await send('09:30');
    assert.equal(invalid.code, 409);
    assert.deepEqual(invalid.body, { error: 'Selecciona una de las horas disponibles para este servicio.', field: 'time' });
    assert.equal(writes, 0);
    assert.equal((await send('09:45')).code, 201);
    assert.equal(writes, 1);
  } finally {
    prisma.$transaction = original;
  }
});
