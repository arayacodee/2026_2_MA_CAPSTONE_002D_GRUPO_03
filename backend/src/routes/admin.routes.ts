import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireRole } from '../middleware/auth.middleware.js';
import { cancelReservation, completeReservation } from '../controllers/reservation.controller.js';
import { deleteAdminRecord, DeletionError } from '../lib/admin-deletion.js';
import { cloudinary } from '../lib/cloudinary.js';
import { businessProfileFields } from '../lib/business-profile.js';
import { hashAdminPassword } from '../lib/admin-password.js';
import { adminLoginLimit } from '../middleware/admin-login-limit.js';

const router = Router();
router.use(authenticate, requireRole('SUPERADMIN'));

router.patch('/users/:id/password', adminLoginLimit(), async (req, res) => {
  const parsed = z.object({ password: z.string().min(8).max(256) }).strict().safeParse(req.body);
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success || !parsed.success) return void res.status(400).json({ error: 'Usa una contraseña de entre 8 y 256 caracteres.' });
  const updated = await prisma.user.updateMany({ where: { id: id.data, role: { not: 'SUPERADMIN' } }, data: { passwordHash: await hashAdminPassword(parsed.data.password) } });
  if (!updated.count) return void res.status(404).json({ error: 'Usuario inexistente o cuenta de administración protegida.' });
  res.json({ message: 'Contraseña actualizada.' });
});

const userSelect = { id: true, email: true, name: true, role: true, createdAt: true, updatedAt: true } as const;
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
  const resource = resourceSchema.safeParse(req.params.resource);
  const query = listSchema.safeParse(req.query);
  if (!resource.success) return void res.status(404).json({ error: 'Sección inexistente.' });
  if (!query.success) return void res.status(400).json({ error: 'Filtros de listado inválidos.' });
  const { page, limit, businessId } = query.data;
  if (businessId && !groupedResourceSchema.safeParse(resource.data).success) {
    return void res.status(400).json({ error: 'Esta sección no admite el filtro por negocio.' });
  }
  const args = { take: limit + 1, skip: (page - 1) * limit, orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }] };
  const where = businessId ? { businessId } : undefined;
  let items;
  switch (resource.data) {
    case 'users': items = await prisma.user.findMany({ ...args, select: userSelect }); break;
    case 'businesses': items = await prisma.business.findMany({ ...args, include: { owner: { select: userSelect } } }); break;
    case 'services': items = await prisma.service.findMany({ ...args, where, include: { business: { select: { id: true, name: true } } } }); break;
    case 'availabilities': items = await prisma.availability.findMany({ ...args, where, include: { business: { select: { id: true, name: true } } } }); break;
    case 'reservations': items = await prisma.reservation.findMany({ ...args, where, include: { business: { select: { id: true, name: true } }, service: true, client: { select: userSelect } } }); break;
    case 'sessions': items = await prisma.clientSession.findMany({ ...args, where, include: { business: { select: { id: true, name: true } }, client: { select: userSelect } } }); break;
    case 'evidences': items = await prisma.sessionEvidence.findMany({
      ...args, where: where ? { session: where } : undefined,
      include: { session: { select: { businessId: true, clientId: true, occurredAt: true } } },
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
    res.status(201).json(await prisma.user.create({ data: parsed.data, select: userSelect }));
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return void res.status(409).json({ error: 'El correo ya está registrado.' });
    throw error;
  }
});

router.patch('/reservations/:id/cancel', cancelReservation);
router.patch('/reservations/:id/complete', completeReservation);

router.delete('/:resource/:id', async (req, res) => {
  const resource = resourceSchema.safeParse(req.params.resource);
  if (!resource.success) return void res.status(404).json({ error: 'Sección inexistente.' });
  if (!z.string().uuid().safeParse(req.params.id).success) return void res.status(400).json({ error: 'Identificador inválido.' });
  const confirmation = z.object({ confirm: z.literal(true) }).strict().safeParse(req.body);
  if (!confirmation.success) return void res.status(400).json({ error: 'Debes confirmar la eliminación permanente.' });
  try {
    const images = await prisma.$transaction(tx => deleteAdminRecord(tx, resource.data, req.params.id, req.authUser!.id), { isolationLevel: 'Serializable' });
    let failedImages = 0;
    // Database rollback must never remove files. A Cloudinary failure does not undo a committed deletion.
    for (const publicId of images) {
      try {
        const result = await cloudinary.uploader.destroy(publicId);
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
    if (code === 'P2034' || code === 'P2003') return void res.status(409).json({ error: 'Los datos cambiaron durante la eliminación. Actualiza la lista e intenta nuevamente.' });
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
    switch (resource) {
      case 'users': {
        const data = userFields.parse(req.body);
        // Protect superadmin accounts; elevations are performed only by the provisioning command.
        if (data.role) {
          const user = await prisma.user.findUnique({ where });
          if (!user) return void res.status(404).json({ error: 'Usuario inexistente.' });
          if (user.role === 'SUPERADMIN') return void res.status(409).json({ error: 'No se puede cambiar el rol de un superadmin desde el panel.' });
          if (data.role === 'CLIENT' && await prisma.business.count({ where: { ownerId: where.id } })) return void res.status(409).json({ error: 'Este usuario tiene negocios; debe conservar su rol profesional.' });
          // Conditional write also protects against concurrent promotion by the provisioning command.
          const updated = await prisma.user.updateMany({ where: { ...where, role: { not: 'SUPERADMIN' } }, data });
          if (!updated.count) return void res.status(409).json({ error: 'El rol cambió. Actualiza la lista.' });
          res.json(await prisma.user.findUnique({ where, select: userSelect }));
        } else res.json(await prisma.user.update({ where, data, select: userSelect }));
        break;
      }
      case 'businesses': res.json(await prisma.business.update({ where, data: businessFields.parse(req.body) })); break;
      case 'services': res.json(await prisma.service.update({ where, data: serviceFields.parse(req.body) })); break;
      case 'availabilities': {
        const data = availabilityFields.parse(req.body);
        const current = await prisma.availability.findUnique({ where });
        if (!current) return void res.status(404).json({ error: 'Horario inexistente.' });
        if ((data.startTime ?? current.startTime) >= (data.endTime ?? current.endTime)) return void res.status(400).json({ error: 'El inicio debe ser anterior al término.' });
        res.json(await prisma.availability.update({ where, data })); break;
      }
      case 'sessions': res.json(await prisma.clientSession.update({ where, data: sessionFields.parse(req.body) })); break;
      case 'evidences': res.json(await prisma.sessionEvidence.update({ where, data: evidenceFields.parse(req.body) })); break;
    }
  } catch (error) {
    if ((error as { code?: string }).code === 'P2025') return void res.status(404).json({ error: 'Registro inexistente.' });
    throw error;
  }
});

export default router;
