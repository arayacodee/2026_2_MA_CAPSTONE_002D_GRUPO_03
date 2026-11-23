import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { prisma } from '../src/lib/prisma.js';

if (existsSync('../frontend/.env.e2e')) loadEnvFile('../frontend/.env.e2e');

const businessName = 'Estudio Cronos Demo';
const serviceId = '418a6d70-2253-4dc2-87e6-c0cbfcd8ab60';
const scenarios = [
  { id: '418a6d70-2253-4dc2-87e6-c0cbfcd8ab61', status: 'CONFIRMED', daysAgo: 1 },
  { id: '418a6d70-2253-4dc2-87e6-c0cbfcd8ab62', status: 'CONFIRMED', daysAgo: 2 },
  { id: '418a6d70-2253-4dc2-87e6-c0cbfcd8ab63', status: 'COMPLETED', daysAgo: 3 },
  { id: '418a6d70-2253-4dc2-87e6-c0cbfcd8ab64', status: 'CANCELLED', daysAgo: 4 },
  { id: '418a6d70-2253-4dc2-87e6-c0cbfcd8ab65', status: 'CONFIRMED', daysAgo: 5 },
] as const;

async function prepare() {
  const professionalEmail = process.env.E2E_PROFESSIONAL_USER?.toLowerCase();
  const clientEmail = process.env.E2E_CLIENT_USER?.toLowerCase();
  if (!professionalEmail?.endsWith('@cronos.example.invalid') || !clientEmail?.endsWith('@cronos.example.invalid')) {
    throw new Error('Configura las dos cuentas de prueba en frontend/.env.e2e. Deben pertenecer al dominio reservado para Cronos.');
  }

  await prisma.$transaction(async tx => {
    const professional = await tx.user.findUnique({ where: { email: professionalEmail }, include: { subscriptions: { select: { id: true } } } });
    const client = await tx.user.findUnique({ where: { email: clientEmail } });
    if (!professional || professional.role !== 'PROFESSIONAL' || professional.isSuspended || professional.subscriptions.length ||
      !client || client.role !== 'CLIENT' || client.isSuspended) {
      throw new Error('Se necesitan un profesional de prueba sin suscripciones y un cliente de prueba activos.');
    }
    const existing = await tx.business.findUnique({ where: { ownerId: professional.id } });
    if (existing && existing.name !== businessName) throw new Error('El profesional ya tiene otro negocio. Se conservó su perfil.');
    const business = existing ?? await tx.business.create({
      data: {
        ownerId: professional.id, name: businessName, category: 'GENERAL',
        description: 'Negocio de demostración de Cronos con agenda y servicios de prueba.',
        attentionMode: 'ONSITE',
      },
    });
    if (business.isArchived) throw new Error('Reactiva el negocio de prueba antes de preparar la demostración.');

    await tx.user.update({ where: { id: professional.id }, data: { accessGrant: 'DEMO' } });
    const service = await tx.service.upsert({
      where: { id: serviceId },
      update: {},
      create: { id: serviceId, businessId: business.id, name: 'Atención de demostración', price: 10000, durationMin: 30 },
    });
    if (service.businessId !== business.id) throw new Error('El servicio de demostración no pertenece al negocio esperado.');

    if (!existing) {
      await tx.availability.createMany({
        data: Array.from({ length: 7 }, (_, index) => ({
          businessId: business.id, dayOfWeek: index + 1, startTime: '09:00', endTime: '20:00',
        })),
      });
    }

    for (const scenario of scenarios) {
      if (await tx.reservation.findUnique({ where: { id: scenario.id } })) continue;
      const startsAt = new Date(Date.now() - scenario.daysAgo * 86_400_000);
      const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);
      await tx.reservation.create({
        data: {
          id: scenario.id, businessId: business.id, clientId: client.id, serviceId: service.id,
          startsAt, endsAt, status: scenario.status, bookedServiceName: service.name,
          bookedDurationMin: service.durationMin, bookedPrice: service.price,
          ...(scenario.status === 'COMPLETED' ? { clientSession: { create: {
            businessId: business.id, clientId: client.id, occurredAt: startsAt, amount: service.price,
            notes: 'Atención de prueba registrada para mostrar el historial.',
          } } } : {}),
        },
      });
    }
  }, { isolationLevel: 'Serializable', timeout: 15_000 });
  console.log(`Datos preparados en ${businessName}.`);
}

try {
  await prepare();
} finally {
  await prisma.$disconnect();
}
