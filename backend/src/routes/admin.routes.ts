import { Router } from 'express';
import { z } from 'zod';
import { isTransactionConflict, prisma } from '../lib/prisma.js';
import { authenticate, requireRole } from '../middleware/auth.middleware.js';
import { cancelReservation, completeReservation } from '../controllers/reservation.controller.js';
import { deleteAdminRecord, DeletionError } from '../lib/admin-deletion.js';
import { cloudinary } from '../lib/cloudinary.js';
import { businessProfileFields } from '../lib/business-profile.js';
import { hashAdminPassword } from '../lib/admin-password.js';
import { adminLoginLimit } from '../middleware/admin-login-limit.js';
import { recordAdminAction } from '../lib/admin-audit.js';
import { evidenceForRead } from '../lib/evidence-media.js';

const router = Router();
router.use(authenticate, requireRole('SUPERADMIN'));

router.patch('/users/:id/password', adminLoginLimit(), async (req, res) => {
  const parsed = z.object({ password: z.string().min(8).max(256) }).strict().safeParse(req.body);
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success || !parsed.success) return void res.status(400).json({ error: 'Usa una contraseña de entre 8 y 256 caracteres.' });
  const passwordHash = await hashAdminPassword(parsed.data.password);
  const updated = await prisma.$transaction(async tx => {
    const result = await tx.user.updateMany({ where: { id: id.data, role: { not: 'SUPERADMIN' } }, data: { passwordHash } });
    if (result.count) await recordAdminAction(tx, req.authUser!.id, 'password_changed', 'users', id.data);
    return result;
  });
  if (!updated.count) return void res.status(404).json({ error: 'Usuario inexistente o cuenta de administración protegida.' });
  res.json({ message: 'Contraseña actualizada.' });
});

const userSelect = { id: true, email: true, name: true, role: true, isSuspended: true, accessGrant: true, createdAt: true, updatedAt: true } as const;
const text = z.string().trim().min(2).max(100);
const description = z.string().max(500).nullable();
const userFields = z.object({ name: text.nullable().optional(), role: z.enum(['CLIENT', 'PROFESSIONAL']).optional() }).strict();
const businessFields = z.object({ ...businessProfileFields, name: text.optional(), description: description.optional() }).strict();
const serviceFields = z.object({ name: text.optional(), description: description.optional(), durationMin: z.number().int().min(1).max(1440).optional(), price: z.number().min(0).max(99999999.99).optional(), isActive: z.boolean().optional() }).strict();
const availabilityFields = z.object({ dayOfWeek: z.number().int().min(1).max(7).optional(), startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(), endTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(), isActive: z.boolean().optional() }).strict();
const sessionFields = z.object({ notes: z.string().max(1500).nullable().optional() }).strict();
const evidenceFields = z.object({ caption: z.string().max(300).nullable().optional() }).strict();
const groupedResourceSchema = z.enum(['services', 'availabilities', 'reservations', 'sessions', 'evidences']);
const resourceSchema = z.enum(['users', 'businesses', ...groupedResourceSchema.options]);
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(50),
  q: z.string().trim().max(120).optional(),
});
const listSchema = pageSchema.extend({ businessId: z.string().uuid().optional() });

const businessesWithRecords = {
  services: { services: { some: {} } },
  availabilities: { availabilities: { some: {} } },
  reservations: { reservations: { some: {} } },
  sessions: { clientSessions: { some: {} } },
  evidences: { clientSessions: { some: { evidences: { some: {} } } } },
};

router.get('/:resource/businesses', async (req, res) => {
  const resource = groupedResourceSchema.safeParse(req.params.resource);
  const pagination = pageSchema.safeParse(req.query);
  if (!resource.success) return void res.status(404).json({ error: 'Sección inexistente.' });
  if (!pagination.success) return void res.status(400).json({ error: 'Página inválida.' });
  const { page, limit } = pagination.data;
  const businesses = await prisma.business.findMany({
    where: businessesWithRecords[resource.data],
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    skip: (page - 1) * limit,
    take: limit + 1,
    select: { id: true, name: true, category: true, owner: { select: { name: true, email: true } } },
  });
  res.json({ items: businesses.slice(0, limit), hasMore: businesses.length > limit });
});

router.get('/:resource', async (req, res) => {
  const resource = z.enum([...resourceSchema.options, 'subscriptions', 'audit']).safeParse(req.params.resource);
  const query = listSchema.safeParse(req.query);
  if (!resource.success) return void res.status(404).json({ error: 'Sección inexistente.' });
  if (!query.success) return void res.status(400).json({ error: 'Filtros de listado inválidos.' });
  const { page, limit, businessId, q } = query.data;
  if (businessId && !groupedResourceSchema.safeParse(resource.data).success) {
    return void res.status(400).json({ error: 'Esta sección no admite el filtro por negocio.' });
  }
  const args = { take: limit + 1, skip: (page - 1) * limit, orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }] };
  const where = businessId ? { businessId } : undefined;
  const contains = q ? { contains: q, mode: 'insensitive' as const } : null;
  const contact = contains ? { OR: [{ name: contains }, { email: contains }, { id: q }] } : undefined;
  const businessFilter = contains ? { OR: [{ name: contains }, { id: q }, { owner: contact }] } : undefined;
  let items;
  switch (resource.data) {
    case 'users': items = await prisma.user.findMany({ ...args, where: contact, select: userSelect }); break;
    case 'businesses': items = await prisma.business.findMany({ ...args, where: businessFilter, include: { owner: { select: userSelect } } }); break;
    case 'services': items = await prisma.service.findMany({ ...args, where: contains ? { ...where, OR: [{ id: q }, { name: contains }] } : where, include: { business: { select: { id: true, name: true } } } }); break;
    case 'availabilities': items = await prisma.availability.findMany({ ...args, where: contains ? { ...where, OR: [{ id: q }, { startTime: contains }, { endTime: contains }] } : where, include: { business: { select: { id: true, name: true } } } }); break;
    case 'reservations': items = await prisma.reservation.findMany({ ...args, where: contains ? { ...where, OR: [{ id: q }, { client: contact }, { bookedServiceName: contains }, { service: { name: contains } }] } : where, include: { business: { select: { id: true, name: true } }, service: true, client: { select: userSelect }, changes: { orderBy: { createdAt: 'desc' }, take: 10 } } }); break;
    case 'sessions': items = await prisma.clientSession.findMany({ ...args, where: contains ? { ...where, OR: [{ id: q }, { client: contact }] } : where, include: { business: { select: { id: true, name: true } }, client: { select: userSelect } } }); break;
    case 'evidences': items = (await prisma.sessionEvidence.findMany({
      ...args, where: contains ? { ...(where ? { session: where } : {}), OR: [{ id: q }, { caption: contains }] } : where ? { session: where } : undefined,
      include: { session: { select: { businessId: true, clientId: true, occurredAt: true } } },
    })).map(evidenceForRead); break;
    case 'subscriptions': items = await prisma.professionalSubscription.findMany({
      ...args, where: contains ? { OR: [{ businessName: contains }, { status: contains }, { user: contact }] } : undefined,
      select: { id: true, businessName: true, status: true, paidUntil: true, createdAt: true, updatedAt: true, user: { select: userSelect } },
    }); break;
    case 'audit': items = await prisma.adminAction.findMany({
      ...args, where: contains ? { OR: [{ actorId: q }, { recordId: q }, { action: contains }, { resource: contains }, { reason: contains }] } : undefined,
    }); break;
  }
  res.json({ items: items.slice(0, limit), hasMore: items.length > limit });
});

router.post('/users', async (req, res) => {
  const parsed = z.object({ email: z.string().trim().toLowerCase().email(), name: text.nullable().optional(), role: z.enum(['CLIENT', 'PROFESSIONAL']) }).strict().safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: 'Datos de usuario inválidos.' });
  const existing = await prisma.user.findFirst({ where: { email: { equals: parsed.data.email, mode: 'insensitive' } } });
  if (existing) return void res.status(409).json({ error: 'El correo ya está registrado.' });
  try {
    const user = await prisma.$transaction(async tx => {
      const created = await tx.user.create({
        data: { ...parsed.data, accessGrant: parsed.data.role === 'PROFESSIONAL' ? 'MANUAL' : null }, select: userSelect,
      });
      await recordAdminAction(tx, req.authUser!.id, 'user_created', 'users', created.id);
      return created;
    });
    res.status(201).json(user);
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return void res.status(409).json({ error: 'El correo ya está registrado.' });
    throw error;
  }
});

router.patch('/reservations/:id/cancel', cancelReservation);
router.patch('/reservations/:id/complete', completeReservation);

router.patch('/:resource/:id/state', async (req, res) => {
  const resource = z.enum(['users', 'businesses', 'services']).safeParse(req.params.resource);
  const id = z.string().uuid().safeParse(req.params.id);
  const parsed = z.object({ disabled: z.boolean(), reason: z.string().trim().min(3).max(300) }).strict().safeParse(req.body);
  if (!resource.success || !id.success || !parsed.success) return void res.status(400).json({ error: 'Indica un motivo de 3 a 300 caracteres.' });
  const where = { id: id.data };
  const { disabled, reason } = parsed.data;
  const changed = await prisma.$transaction(async tx => {
    const changed = resource.data === 'users'
      ? await tx.user.updateMany({ where: { ...where, role: { not: 'SUPERADMIN' } }, data: { isSuspended: disabled } })
      : resource.data === 'businesses'
        ? await tx.business.updateMany({ where, data: { isArchived: disabled } })
        : await tx.service.updateMany({ where, data: { isActive: !disabled } });
    if (changed.count) await recordAdminAction(tx, req.authUser!.id, disabled ? 'disabled' : 'restored', resource.data, id.data, reason);
    return changed.count;
  });
  if (!changed) return void res.status(404).json({ error: 'Registro inexistente o protegido.' });
  res.json({ message: disabled ? 'Registro desactivado.' : 'Registro reactivado.' });
});

router.delete('/:resource/:id', async (req, res) => {
  const resource = resourceSchema.safeParse(req.params.resource);
  if (!resource.success) return void res.status(404).json({ error: 'Sección inexistente.' });
  if (!z.string().uuid().safeParse(req.params.id).success) return void res.status(400).json({ error: 'Identificador inválido.' });
  const confirmation = z.object({ confirm: z.literal(true), reason: z.string().trim().min(3).max(300) }).strict().safeParse(req.body);
  if (!confirmation.success) return void res.status(400).json({ error: 'Debes confirmar la eliminación permanente.' });
  try {
    const recordId = req.params.id;
    const images = await prisma.$transaction(async tx => {
      const images = await deleteAdminRecord(tx, resource.data, recordId, req.authUser!.id);
      await recordAdminAction(tx, req.authUser!.id, 'deleted', resource.data, recordId, confirmation.data.reason);
      return images;
    }, { isolationLevel: 'Serializable' });
    let failedImages = 0;
    // Database rollback must never remove files. A Cloudinary failure does not undo a committed deletion.
    for (const { publicId, type } of images) {
      try {
        const result = await cloudinary.uploader.destroy(publicId, { type, invalidate: true });
        if (result.result !== 'ok' && result.result !== 'not found') throw new Error('Cloudinary no confirmó la eliminación.');
      } catch (error) {
        failedImages++;
        console.error('Admin deletion: pending Cloudinary cleanup', { publicId, error });
      }
    }
    res.json({ message: 'Registro y datos relacionados eliminados.', warning: failedImages ? 'Los datos se eliminaron, pero quedaron imágenes pendientes de limpieza en el almacenamiento.' : null });
  } catch (error) {
    if (error instanceof DeletionError) return void res.status(error.status).json({ error: error.message });
    const code = (error as { code?: string }).code;
    if (code === 'P2025') return void res.status(404).json({ error: 'Registro inexistente.' });
    if (isTransactionConflict(error) || code === 'P2003') return void res.status(409).json({ error: 'Los datos cambiaron durante la eliminación. Actualiza la lista e intenta nuevamente.' });
    throw error;
  }
});

router.patch('/:resource/:id', async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return void res.status(400).json({ error: 'Identificador inválido.' });
  const schemas = { users: userFields, businesses: businessFields, services: serviceFields, availabilities: availabilityFields, sessions: sessionFields, evidences: evidenceFields };
  const resource = req.params.resource as keyof typeof schemas;
  if (!Object.hasOwn(schemas, resource)) return void res.status(404).json({ error: 'Sección no editable.' });
  const parsed = schemas[resource].safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) return void res.status(400).json({ error: 'Datos inválidos o campos no permitidos.' });
  const where = { id: req.params.id };
  try {
    const result = await prisma.$transaction(async tx => {
      let updated;
      switch (resource) {
        case 'users': {
          const data = userFields.parse(req.body);
          const user = await tx.user.findUnique({ where });
          if (!user) throw new DeletionError(404, 'Usuario inexistente.');
          if (user.role === 'SUPERADMIN') throw new DeletionError(409, 'La cuenta de superadmin está protegida.');
          if (data.role === 'CLIENT' && user.role !== 'CLIENT' && await tx.business.count({ where: { ownerId: where.id } })) {
            throw new DeletionError(409, 'Este usuario tiene un negocio; debe conservar su rol profesional.');
          }
          const accessGrant = data.role && data.role !== user.role ? (data.role === 'PROFESSIONAL' ? 'MANUAL' : null) : undefined;
          const changed = await tx.user.updateMany({ where: { ...where, role: { not: 'SUPERADMIN' } }, data: { ...data, accessGrant } });
          if (!changed.count) throw new DeletionError(409, 'El rol cambió. Actualiza la lista.');
          updated = await tx.user.findUnique({ where, select: userSelect });
          break;
        }
        case 'businesses': updated = await tx.business.update({ where, data: businessFields.parse(req.body) }); break;
        case 'services': updated = await tx.service.update({ where, data: serviceFields.parse(req.body) }); break;
        case 'availabilities': {
          const data = availabilityFields.parse(req.body);
          const current = await tx.availability.findUnique({ where });
          if (!current) throw new DeletionError(404, 'Horario inexistente.');
          const startTime = data.startTime ?? current.startTime, endTime = data.endTime ?? current.endTime;
          if (startTime >= endTime) throw new DeletionError(400, 'El inicio debe ser anterior al término.');
          if ((data.isActive ?? current.isActive) && await tx.availability.count({ where: {
            businessId: current.businessId, dayOfWeek: data.dayOfWeek ?? current.dayOfWeek, isActive: true,
            id: { not: where.id }, startTime: { lt: endTime }, endTime: { gt: startTime },
          } })) throw new DeletionError(409, 'El horario se superpone con otro bloque del negocio.');
          updated = await tx.availability.update({ where, data });
          break;
        }
        case 'sessions': updated = await tx.clientSession.update({ where, data: sessionFields.parse(req.body) }); break;
        case 'evidences': updated = evidenceForRead(await tx.sessionEvidence.update({ where, data: evidenceFields.parse(req.body) })); break;
      }
      await recordAdminAction(tx, req.authUser!.id, 'updated', resource, where.id);
      return updated;
    }, { isolationLevel: 'Serializable' });
    res.json(result);
  } catch (error) {
    if (error instanceof DeletionError) return void res.status(error.status).json({ error: error.message });
    if (isTransactionConflict(error)) return void res.status(409).json({ error: 'Los datos cambiaron. Actualiza la lista e inténtalo nuevamente.' });
    if ((error as { code?: string }).code === 'P2025') return void res.status(404).json({ error: 'Registro inexistente.' });
    throw error;
  }
});

export default router;
