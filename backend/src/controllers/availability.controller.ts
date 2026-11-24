import type { Request, Response } from "express";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { bookingOwnerSelect, canReceiveBookings } from '../lib/subscriptions.js';

const timeRegex = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const calendarDay = z.iso.date();

export async function listBlockedDays(req: Request, res: Response) {
  return res.json(await prisma.scheduleException.findMany({
    where: { business: { ownerId: req.authUser!.id } },
    orderBy: { day: 'asc' },
  }));
}

export async function blockDay(req: Request, res: Response) {
  const parsed = z.object({ day: calendarDay, reason: z.string().trim().max(160).optional() }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Indica una fecha y un motivo de hasta 160 caracteres.' });
  const business = await prisma.business.findUnique({ where: { ownerId: req.authUser!.id } });
  if (!business) return res.status(404).json({ error: 'Primero crea tu negocio.' });
  const day = parsed.data.day;
  const data = { businessId: business.id, day, reason: parsed.data.reason || null };
  return res.json(await prisma.scheduleException.upsert({
    where: { businessId_day: { businessId: business.id, day } },
    create: data, update: { reason: data.reason },
  }));
}

export async function unblockDay(req: Request, res: Response) {
  const parsed = calendarDay.safeParse(req.params.day);
  if (!parsed.success) return res.status(400).json({ error: 'Fecha inválida.' });
  await prisma.scheduleException.deleteMany({ where: { day: parsed.data, business: { ownerId: req.authUser!.id } } });
  return res.status(204).end();
}

const createAvailabilitySchema = z.object({
  businessId: z.string().uuid(),
  dayOfWeek: z.number().int().min(1).max(7),
  startTime: z.string().regex(timeRegex),
  endTime: z.string().regex(timeRegex),
  isActive: z.boolean().optional(),
});

const slotsQuerySchema = z.object({
  serviceId: z.string().uuid(),

  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const parsed = new Date(`${value}T00:00:00Z`);

      return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
      );
    }, "Invalid date"),
});

export const timeToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(":").map(Number);

  return hours * 60 + minutes;
};

const minutesToTime = (total: number): string => {
  const hours = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");

  const minutes = (total % 60)
    .toString()
    .padStart(2, "0");

  return `${hours}:${minutes}`;
};

const getTimeZoneOffsetMs = (
  date: Date,
  timeZone: string
): number => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  const representedAsUtc = Date.UTC(
    Number(values["year"]),
    Number(values["month"]) - 1,
    Number(values["day"]),
    Number(values["hour"]),
    Number(values["minute"]),
    Number(values["second"])
  );

  return representedAsUtc - date.getTime();
};

export const zonedLocalToDate = (
  date: string,
  time: string,
  timeZone: string
): Date => {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);

  const guess = new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      hour,
      minute,
      0
    )
  );

  let offset = getTimeZoneOffsetMs(
    guess,
    timeZone
  );

  let result = new Date(
    guess.getTime() - offset
  );

  const correctedOffset =
    getTimeZoneOffsetMs(
      result,
      timeZone
    );

  if (correctedOffset !== offset) {
    offset = correctedOffset;

    result = new Date(
      guess.getTime() - offset
    );
  }

  return result;
};

const nextDate = (date: string): string => {
  const [year, month, day] =
    date.split("-").map(Number);

  return new Date(
    Date.UTC(year, month - 1, day + 1)
  )
    .toISOString()
    .slice(0, 10);
};

export const createAvailability = async (
  req: Request,
  res: Response
) => {
  const result = createAvailabilitySchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      error: "Invalid request data",
      details: result.error.flatten(),
    });
  }

  const {
    businessId,
    dayOfWeek,
    startTime,
    endTime,
    isActive,
  } = result.data;

  if (startTime >= endTime) {
    return res.status(400).json({
      error: "startTime must be earlier than endTime",
    });
  }

  try {
    // El negocio debe existir Y pertenecer
    // al profesional autenticado.
    const business = await prisma.business.findFirst({
      where: {
        id: businessId,
        ownerId: req.authUser!.id,
      },
    });

    if (!business) {
      return res.status(403).json({
        error: "You do not own this business",
      });
    }

    // Evitar bloques de disponibilidad superpuestos.
    const overlappingAvailability =
      await prisma.availability.findFirst({
        where: {
          businessId,
          dayOfWeek,
          isActive: true,

          startTime: {
            lt: endTime,
          },

          endTime: {
            gt: startTime,
          },
        },
      });

    if (overlappingAvailability) {
      return res.status(409).json({
        error: "Availability overlaps an existing time block",
      });
    }

    const availability = await prisma.availability.create({
      data: {
        businessId,
        dayOfWeek,
        startTime,
        endTime,
        isActive: isActive ?? true,
      },
    });

    return res.status(201).json(availability);
  } catch (error) {
    console.error("Create availability error:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
};

export const getAvailabilities = async (
  req: Request,
  res: Response
) => {
  try {
    const businessId =
      typeof req.query.businessId === "string"
        ? req.query.businessId
        : undefined;

    const availabilities = await prisma.availability.findMany({
      where: businessId
        ? {
            businessId,
          }
        : undefined,

      include: {
        business: {
          select: {
            id: true,
            name: true,
          },
        },
      },

      orderBy: [
        {
          dayOfWeek: "asc",
        },
        {
          startTime: "asc",
        },
      ],
    });

    return res.status(200).json(availabilities);
  } catch (error) {
    console.error("Get availabilities error:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
};

export const getAvailableSlots = async (
  req: Request,
  res: Response
) => {
  const result = slotsQuerySchema.safeParse(
    req.query
  );

  if (!result.success) {
    return res.status(400).json({
      error: "Invalid query data",
      details: result.error.flatten(),
    });
  }

  const {
    serviceId,
    date,
  } = result.data;

  try {
    const service =
      await prisma.service.findUnique({
        where: {
          id: serviceId,
        },

        include: { business: { include: { owner: { select: bookingOwnerSelect } } } },
      });

    if (
      !service ||
      !service.isActive
    ) {
      return res.status(404).json({
        error: "Service not available",
      });
    }

    if (!canReceiveBookings(service.business)) {
      return res.status(409).json({ error: 'Este negocio no está recibiendo nuevas reservas.' });
    }
    const exception = await prisma.scheduleException.findUnique({
      where: { businessId_day: { businessId: service.businessId, day: date } },
    });
    if (exception) return res.json({ date, timezone: service.business.timezone, slots: [] });

    const timeZone =
      service.business.timezone;

    /*
     * Nuestra convención:
     *
     * 1 = lunes
     * ...
     * 7 = domingo
     */
    const [year, month, day] =
      date.split("-").map(Number);

    const jsDay =
      new Date(
        Date.UTC(
          year,
          month - 1,
          day
        )
      ).getUTCDay();

    const dayOfWeek =
      jsDay === 0
        ? 7
        : jsDay;

    const availabilities =
      await prisma.availability.findMany({
        where: {
          businessId:
            service.businessId,

          dayOfWeek,

          isActive: true,
        },

        orderBy: {
          startTime: "asc",
        },
      });

    if (availabilities.length === 0) {
      return res.status(200).json({
        date,
        timezone: timeZone,
        slots: [],
      });
    }

    const dayStart =
      zonedLocalToDate(
        date,
        "00:00",
        timeZone
      );

    const dayEnd =
      zonedLocalToDate(
        nextDate(date),
        "00:00",
        timeZone
      );

    const reservations =
      await prisma.reservation.findMany({
        where: {
          businessId:
            service.businessId,

          status: {
            in: ['PENDING', 'CONFIRMED', 'COMPLETED'],
          },

          startsAt: {
            lt: dayEnd,
          },

          endsAt: {
            gt: dayStart,
          },
        },

        select: {
          startsAt: true,
          endsAt: true,
        },
      });

    const slots = new Set<string>();

    const now = new Date();
    const localTime = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const localDay = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });

    for (
      const availability
      of availabilities
    ) {
      let current =
        timeToMinutes(
          availability.startTime
        );

      const availabilityEnd =
        timeToMinutes(
          availability.endTime
        );

      while (
        current +
          service.durationMin <=
        availabilityEnd
      ) {
        const slot =
          minutesToTime(current);

        const slotStart =
          zonedLocalToDate(
            date,
            slot,
            timeZone
          );

        const slotEnd =
          new Date(
            slotStart.getTime() +
              service.durationMin *
                60_000
          );

        const isPast =
          slotStart <= now;

        const hasConflict =
          reservations.some(
            (reservation) =>
              reservation.startsAt <
                slotEnd &&
              reservation.endsAt >
                slotStart
          );

        if (
          !isPast &&
          !hasConflict &&
          localTime.format(slotStart) === slot &&
          localDay.format(slotEnd) === date &&
          localTime.format(slotEnd) <= availability.endTime
        ) {
          slots.add(slot);
        }

        current +=
          service.durationMin;
      }
    }

    return res.status(200).json({
      date,
      timezone: timeZone,
      slots: [...slots].sort(),
    });
  } catch (error) {
    console.error(
      "Get available slots error:",
      error
    );

    return res.status(500).json({
      error: "Internal server error",
    });
  }
};

export const getAvailabilityById = async (
  req: Request<{ id: string }>,
  res: Response
) => {
  try {
    const { id } = req.params;

    const availability = await prisma.availability.findUnique({
      where: {
        id,
      },

      include: {
        business: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!availability) {
      return res.status(404).json({
        error: "Availability not found",
      });
    }

    return res.status(200).json(availability);
  } catch (error) {
    console.error("Get availability error:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
};

export const deleteAvailability = async (
  req: Request<{ id: string }>,
  res: Response
) => {
  try {
    const availability = await prisma.availability.findUnique({
      where: {
        id: req.params.id,
      },

      include: {
        business: true,
      },
    });

    if (!availability) {
      return res.status(404).json({
        error: "Availability not found",
      });
    }

    // Un profesional solo puede eliminar disponibilidad
    // perteneciente a uno de sus propios negocios.
    
    if (
      availability.business.ownerId !==
      req.authUser!.id
    ) {
      return res.status(403).json({
        error: "Forbidden",
      });
    }

    await prisma.availability.delete({
      where: {
        id: availability.id,
      },
    });

    return res.status(204).send();
  } catch (error) {
    console.error("Delete availability error:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
};
