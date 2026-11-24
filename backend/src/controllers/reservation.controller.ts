import type { Request, Response } from "express";
import { z } from "zod";
import { isTransactionConflict, prisma } from "../lib/prisma.js";
import { bookingOwnerSelect, canReceiveBookings } from '../lib/subscriptions.js';
import type { Prisma } from '../generated/prisma/client.js';
import { cancelSafely, completeSafely, ReservationConflict } from "../lib/reservation-state.js";
import { timeToMinutes, zonedLocalToDate } from './availability.controller.js';
import { recordAdminAction } from '../lib/admin-audit.js';

const createReservationSchema = z.object({
  serviceId: z.string().uuid(),
  startsAt: z.iso.datetime({ offset: true }).refine(value => Date.parse(value) % 60_000 === 0),
});

const completeReservationSchema = z.object({
  notes: z
    .string()
    .trim()
    .max(1500)
    .optional(),
});

class ReservationSlotConflict extends ReservationConflict {
  constructor(readonly field: 'day' | 'time', message: string) {
    super(message);
  }
}

const weekdayMap: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const getLocalDateParts = (date: Date, timeZone: string) => {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(date);

  const datePart = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);

  return {
    dayOfWeek: weekdayMap[weekday],
    datePart,
    time,
  };
};

const reservationInclude = {
  service: { select: { id: true, name: true, durationMin: true, price: true } },
  client: { select: { id: true, name: true, email: true } },
  business: { select: { id: true, name: true, timezone: true } },
} satisfies Prisma.ReservationInclude;

async function withScheduleTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: 'Serializable', timeout: 12_000 });
    } catch (error) {
      if (!isTransactionConflict(error)) throw error;
      if (attempt === 3) throw new ReservationConflict('La agenda cambió. Actualiza los horarios e intenta nuevamente.');
    }
  }
}

async function checkSlot(
  tx: Prisma.TransactionClient,
  business: { id: string; timezone: string },
  startsAt: Date,
  durationMin: number,
  excludingId?: string,
): Promise<Date> {
  if (startsAt <= new Date()) throw new ReservationSlotConflict('time', 'Elige un horario futuro.');
  const endsAt = new Date(startsAt.getTime() + durationMin * 60_000);
  const start = getLocalDateParts(startsAt, business.timezone);
  const end = getLocalDateParts(endsAt, business.timezone);
  if (start.datePart !== end.datePart) throw new ReservationSlotConflict('time', 'Elige una hora que permita terminar la reserva el mismo día.');
  const exception = await tx.scheduleException.findUnique({
    where: { businessId_day: { businessId: business.id, day: start.datePart } },
  });
  if (exception) throw new ReservationSlotConflict('day', 'El negocio no atiende en esa fecha. Elige otro día.');

  const availability = await tx.availability.findFirst({
    where: {
      businessId: business.id, dayOfWeek: start.dayOfWeek, isActive: true,
      startTime: { lte: start.time }, endTime: { gte: end.time },
    },
  });
  if (!availability) throw new ReservationSlotConflict('time', 'Elige una hora dentro de la disponibilidad del negocio.');
  if (!excludingId && (
    (timeToMinutes(start.time) - timeToMinutes(availability.startTime)) % durationMin !== 0 ||
    zonedLocalToDate(start.datePart, start.time, business.timezone).getTime() !== startsAt.getTime()
  )) throw new ReservationSlotConflict('time', 'Selecciona una de las horas disponibles para este servicio.');

  const overlap = await tx.reservation.findFirst({
    where: {
      businessId: business.id, ...(excludingId ? { id: { not: excludingId } } : {}),
      status: { in: ['PENDING', 'CONFIRMED', 'COMPLETED'] },
      startsAt: { lt: endsAt }, endsAt: { gt: startsAt },
    },
  });
  if (overlap) throw new ReservationSlotConflict('time', 'Ese horario ya está ocupado. Selecciona otro.');
  return endsAt;
}

export const createReservation = async (req: Request, res: Response) => {
  const parsed = createReservationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Selecciona un servicio y un horario válidos.' });
  const startsAt = new Date(parsed.data.startsAt);
  if (startsAt <= new Date()) return res.status(400).json({ error: 'Elige un horario futuro.', field: 'time' });

  try {
    const reservation = await withScheduleTransaction(async tx => {
      const service = await tx.service.findUnique({
        where: { id: parsed.data.serviceId },
        include: { business: { include: { owner: { select: bookingOwnerSelect } } } },
      });
      if (!service) return null;
      if (!service.isActive || !canReceiveBookings(service.business)) {
        throw new ReservationConflict('Este servicio no está recibiendo reservas.');
      }
      const endsAt = await checkSlot(tx, service.business, startsAt, service.durationMin);
      return tx.reservation.create({
        data: {
          businessId: service.businessId, serviceId: service.id, clientId: req.authUser!.id, startsAt, endsAt,
          bookedServiceName: service.name, bookedDurationMin: service.durationMin, bookedPrice: service.price,
        },
        include: reservationInclude,
      });
    });
    if (!reservation) return res.status(404).json({ error: 'Servicio no encontrado.' });
    return res.status(201).json(reservation);
  } catch (error) {
    if (error instanceof ReservationSlotConflict) return res.status(409).json({ error: error.message, field: error.field });
    if (error instanceof ReservationConflict) return res.status(409).json({ error: error.message });
    throw error;
  }
};

export const rescheduleReservation = async (req: Request<{ id: string }>, res: Response) => {
  const parsed = z.object({ day: z.iso.date(), time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Selecciona un horario válido.' });
  try {
    const changed = await withScheduleTransaction(async tx => {
      const reservation = await tx.reservation.findFirst({
        where: { id: req.params.id, business: { ownerId: req.authUser!.id } },
        include: { business: true },
      });
      if (!reservation) return null;
      if (reservation.status !== 'CONFIRMED' || reservation.startsAt <= new Date()) {
        throw new ReservationConflict('Solo se pueden reprogramar reservas confirmadas que aún no comienzan.');
      }
      const timezone = reservation.business.timezone;
      const startsAt = zonedLocalToDate(parsed.data.day, parsed.data.time, timezone);
      const local = getLocalDateParts(startsAt, timezone);
      if (local.datePart !== parsed.data.day || local.time !== parsed.data.time) {
        throw new ReservationSlotConflict('time', 'Ese horario no existe en la zona horaria del negocio. Elige otra hora.');
      }
      if (reservation.startsAt.getTime() === startsAt.getTime()) {
        throw new ReservationSlotConflict('time', 'Selecciona un horario distinto.');
      }
      const duration = reservation.bookedDurationMin ?? Math.round((reservation.endsAt.getTime() - reservation.startsAt.getTime()) / 60_000);
      const endsAt = await checkSlot(tx, reservation.business, startsAt, duration, reservation.id);
      return tx.reservation.update({
        where: { id: reservation.id },
        data: {
          startsAt, endsAt, changes: { create: {
            actorId: req.authUser!.id, previousStart: reservation.startsAt, previousEnd: reservation.endsAt,
            newStart: startsAt, newEnd: endsAt,
          } },
        },
        include: reservationInclude,
      });
    });
    if (!changed) return res.status(404).json({ error: 'Reserva no encontrada.' });
    return res.json(changed);
  } catch (error) {
    if (error instanceof ReservationSlotConflict) return res.status(409).json({ error: error.message, field: error.field });
    if (error instanceof ReservationConflict) return res.status(409).json({ error: error.message });
    throw error;
  }
};

export const markNoShow = async (req: Request<{ id: string }>, res: Response) => {
  const ownerFilter = { id: req.params.id, business: { ownerId: req.authUser!.id } };
  const changed = await prisma.reservation.updateMany({
    where: { ...ownerFilter, status: 'CONFIRMED', endsAt: { lte: new Date() } },
    data: { status: 'NO_SHOW' },
  });
  const reservation = await prisma.reservation.findFirst({ where: ownerFilter, include: reservationInclude });
  if (!reservation) return res.status(404).json({ error: 'Reserva no encontrada.' });
  if (!changed.count && reservation.status !== 'NO_SHOW') {
    return res.status(409).json({ error: 'Solo se puede registrar inasistencia cuando termina el horario de una reserva confirmada.' });
  }
  return res.json(reservation);
};

export const getReservations = async (
  req: Request,
  res: Response
) => {
  try {
    const user = req.authUser!;

    const requestedBusinessId =
      typeof req.query.businessId === "string"
        ? req.query.businessId
        : undefined;

    if (user.role === "CLIENT") {
      const reservations =
        await prisma.reservation.findMany({
          where: {
            clientId: user.id
          },

          include: {
            business: true,
            service: true
          },

          orderBy: {
            startsAt: "asc"
          }
        });

      return res.status(200).json(
        reservations
      );
    }

    const reservations =
      await prisma.reservation.findMany({
        where: {
          business: {
            ownerId: user.id
          },

          ...(requestedBusinessId
            ? {
                businessId:
                  requestedBusinessId
              }
            : {})
        },

        include: {
          business: true,
          service: true,

          client: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true
            }
          }
        },

        orderBy: {
          startsAt: "asc"
        }
      });

    return res.status(200).json(
      reservations
    );
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error:
        "Unable to load reservations"
    });
  }
};

export const getReservationById = async (
  req: Request<{ id: string }>,
  res: Response
) => {
  try {
    const reservation =
      await prisma.reservation.findUnique({
        where: {
          id: req.params.id,
        },

        include: {
          business: true,
          service: true,

          client: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
      });

    if (!reservation) {
      return res.status(404).json({
        error: "Reservation not found",
      });
    }

    const user = req.authUser!;

    if (
      user.role === "CLIENT" &&
      reservation.clientId !== user.id
    ) {
      return res.status(403).json({
        error: "Forbidden",
      });
    }

    if (
      user.role === "PROFESSIONAL" &&
      reservation.business.ownerId !== user.id
    ) {
      return res.status(403).json({
        error: "Forbidden",
      });
    }

    return res.status(200).json(reservation);
  } catch (error) {
    console.error(
      "Get reservation error:",
      error
    );

    return res.status(500).json({
      error: "Internal server error",
    });
  }
};

export const cancelReservation = async (req: Request<{ id: string }>, res: Response) => {
  try {
    const reservation = await prisma.reservation.findUnique({ where: { id: req.params.id }, include: { business: true } });
    if (!reservation) return res.status(404).json({ error: "Reserva no encontrada." });
    const user = req.authUser!;
    const allowed = user.role === "SUPERADMIN" || (user.role === "CLIENT" ? reservation.clientId === user.id : reservation.business.ownerId === user.id);
    if (!allowed) return res.status(403).json({ error: "Forbidden" });
    const cancelled = await prisma.$transaction(async tx => {
      const result = await cancelSafely(tx, reservation.id);
      if (user.role === 'SUPERADMIN') await recordAdminAction(tx, user.id, 'cancelled', 'reservations', reservation.id);
      return result;
    });
    return res.json(cancelled);
  } catch (error) {
    if (error instanceof ReservationConflict) return res.status(409).json({ error: error.message });
    console.error("Cancel reservation error:", error);
    return res.status(500).json({ error: "No fue posible cancelar la reserva." });
  }
};

export const completeReservation = async (req: Request<{ id: string }>, res: Response) => {
  const result = completeReservationSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: "Nota inválida.", details: result.error.flatten() });
  try {
    const reservation = await prisma.reservation.findUnique({ where: { id: req.params.id }, include: { business: true } });
    if (!reservation) return res.status(404).json({ error: "Reserva no encontrada." });
    if (req.authUser!.role !== "SUPERADMIN" && reservation.business.ownerId !== req.authUser!.id) return res.status(403).json({ error: "Forbidden" });
    const completed = await prisma.$transaction(async tx => {
      const completion = await completeSafely(tx, reservation.id, result.data.notes);
      if (req.authUser!.role === 'SUPERADMIN') {
        await recordAdminAction(tx, req.authUser!.id, 'completed', 'reservations', reservation.id);
      }
      return completion;
    });
    return res.json(completed);
  } catch (error) {
    if (error instanceof ReservationConflict) return res.status(409).json({ error: error.message });
    console.error("Complete reservation error:", error);
    return res.status(500).json({ error: "No fue posible registrar la atención." });
  }
};
