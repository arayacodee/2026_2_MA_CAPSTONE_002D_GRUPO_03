import type { Prisma } from "../generated/prisma/client.js";

export class ReservationConflict extends Error {}

// Conditional updates acquire the reservation row lock before changing state.
// Completion and cancellation therefore cannot overwrite each other.
export async function cancelSafely(tx: Prisma.TransactionClient, id: string) {
  const changed = await tx.reservation.updateMany({
    where: { id, status: { in: ["PENDING", "CONFIRMED"] } },
    data: { status: "CANCELLED" },
  });
  const reservation = await tx.reservation.findUniqueOrThrow({ where: { id } });
  if (!changed.count && reservation.status !== "CANCELLED") {
    throw new ReservationConflict("Una reserva cerrada no puede cancelarse.");
  }
  return reservation;
}

export async function completeSafely(tx: Prisma.TransactionClient, id: string, notes?: string) {
  const changed = await tx.reservation.updateMany({
    where: { id, status: "CONFIRMED", startsAt: { lte: new Date() } },
    data: { status: "COMPLETED" },
  });
  const reservation = await tx.reservation.findUniqueOrThrow({ where: { id } });
  if (!changed.count) {
    const session = await tx.clientSession.findUnique({ where: { reservationId: id } });
    if (reservation.status === "COMPLETED" && session) return { reservation, session };
    throw new ReservationConflict("Solo se pueden completar reservas confirmadas que ya comenzaron.");
  }
  const session = await tx.clientSession.create({
    data: {
      businessId: reservation.businessId,
      clientId: reservation.clientId,
      reservationId: id,
      occurredAt: reservation.startsAt,
      notes: notes || null,
      amount: reservation.bookedPrice ?? null,
    },
  });
  return { reservation, session };
}
