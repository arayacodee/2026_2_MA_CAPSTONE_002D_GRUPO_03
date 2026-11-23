import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancelSafely, completeSafely, ReservationConflict } from '../src/lib/reservation-state.js';
import type { Prisma } from '../src/generated/prisma/client.js';

function transaction(status = 'CONFIRMED', future = false) {
  const reservation = { id: 'reservation', status, businessId: 'business', clientId: 'client', startsAt: new Date(Date.now() + (future ? 60_000 : -60_000)), bookedPrice: '15000', service: { price: '15000' } };
  let session: any = status === 'COMPLETED' ? { id: 'existing' } : null;
  let creations = 0;
  const tx = {
    reservation: {
      updateMany: async ({ where, data }: any) => {
        const allowed = typeof where.status === 'string' ? reservation.status === where.status : where.status.in.includes(reservation.status);
        if (!allowed || (where.startsAt && reservation.startsAt > where.startsAt.lte)) return { count: 0 };
        reservation.status = data.status;
        return { count: 1 };
      },
      findUniqueOrThrow: async () => reservation
    },
    clientSession: {
      findUnique: async () => session,
      create: async ({ data }: any) => { creations++; session = { id: 'session', ...data }; return session; }
    }
  } as unknown as Prisma.TransactionClient;
  return { tx, reservation, creations: () => creations };
}

test('no permite cancelar una atención completada', async () => {
  const state = transaction('COMPLETED');
  await assert.rejects(cancelSafely(state.tx, 'reservation'), ReservationConflict);
  assert.equal(state.reservation.status, 'COMPLETED');
});
test('cancelar dos veces es idempotente', async () => {
  const state = transaction();
  await cancelSafely(state.tx, 'reservation');
  assert.equal((await cancelSafely(state.tx, 'reservation')).status, 'CANCELLED');
});
test('completar dos veces conserva una única atención y el precio original aunque cambie la tarifa', async () => {
  const state = transaction();
  state.reservation.service.price = '20000';
  const first = await completeSafely(state.tx, 'reservation', 'Nota');
  const second = await completeSafely(state.tx, 'reservation', 'Otra nota');
  assert.equal(first.session.id, second.session.id);
  assert.equal(state.creations(), 1);
  assert.equal(first.session.occurredAt, state.reservation.startsAt);
  assert.equal(first.session.amount, '15000');
  assert.equal(second.session.amount, '15000');
});
test('una cancelación previa impide completar', async () => {
  const state = transaction();
  await cancelSafely(state.tx, 'reservation');
  await assert.rejects(completeSafely(state.tx, 'reservation'), ReservationConflict);
  assert.equal(state.creations(), 0);
});
test('no permite completar reservas futuras o pendientes', async () => {
  for (const state of [transaction('CONFIRMED', true), transaction('PENDING')]) {
    await assert.rejects(completeSafely(state.tx, 'reservation'), ReservationConflict);
    assert.equal(state.creations(), 0);
  }
});
