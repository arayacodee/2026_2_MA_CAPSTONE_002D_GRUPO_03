import type { Prisma } from '../generated/prisma/client.js';

export type AdminResource = 'users' | 'businesses' | 'services' | 'availabilities' | 'reservations' | 'sessions' | 'evidences';
export class DeletionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type Media = { publicId: string; type: string };

export async function deleteAdminRecord(
  tx: Prisma.TransactionClient, resource: AdminResource, id: string, actorId: string,
): Promise<Media[]> {
  const where = { id };
  switch (resource) {
    case 'reservations':
    case 'sessions':
      throw new DeletionError(409, 'El historial de reservas y atenciones se conserva.');
    case 'users': {
      const user = await tx.user.findUnique({ where });
      if (!user) throw new DeletionError(404, 'Usuario inexistente.');
      if (user.role === 'SUPERADMIN' || user.id === actorId) throw new DeletionError(409, 'No se pueden eliminar cuentas superadmin.');
      const related = await tx.user.count({ where: {
        id, OR: [{ businesses: { some: {} } }, { reservations: { some: {} } }, { subscriptions: { some: {} } }],
      } });
      if (related) throw new DeletionError(409, 'Esta cuenta tiene actividad asociada. Puedes suspenderla.');
      const deleted = await tx.user.deleteMany({ where: { id, role: { not: 'SUPERADMIN' } } });
      if (!deleted.count) throw new DeletionError(409, 'El usuario cambió. Actualiza la lista.');
      return [];
    }
    case 'businesses': {
      const business = await tx.business.findUnique({ where });
      if (!business) throw new DeletionError(404, 'Negocio inexistente.');
      if (await tx.reservation.count({ where: { businessId: id } })) {
        throw new DeletionError(409, 'Este negocio tiene historial. Puedes archivarlo.');
      }
      const photos = await tx.businessPhoto.findMany({ where: { businessId: id }, select: { imagePublicId: true } });
      await tx.service.deleteMany({ where: { businessId: id } });
      await tx.availability.deleteMany({ where: { businessId: id } });
      await tx.business.delete({ where });
      const publicIds = new Set([business.avatarPublicId, business.coverPublicId, ...photos.map(photo => photo.imagePublicId)]);
      return [...publicIds].filter((publicId): publicId is string => Boolean(publicId)).map(publicId => ({ publicId, type: 'upload' }));
    }
    case 'services':
      if (await tx.reservation.count({ where: { serviceId: id } })) {
        throw new DeletionError(409, 'Este servicio tiene historial. Puedes desactivarlo.');
      }
      await tx.service.delete({ where });
      return [];
    case 'availabilities':
      await tx.availability.delete({ where });
      return [];
    case 'evidences': {
      const evidence = await tx.sessionEvidence.delete({ where });
      return [{ publicId: evidence.imagePublicId, type: evidence.deliveryType }];
    }
  }
}
