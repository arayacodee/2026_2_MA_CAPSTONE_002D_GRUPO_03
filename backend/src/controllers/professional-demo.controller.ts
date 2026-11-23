import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { privateUserSelect } from '../lib/user-profile.js';
import { paymentsConfigured } from '../lib/mercado-pago.js';

export async function activateProfessionalDemo(req: Request, res: Response) {
  if (env.NODE_ENV === 'production' || paymentsConfigured()) return res.status(403).json({ error: 'La activación de prueba no está disponible con pagos habilitados ni en producción.' });
  if (req.authUser!.role === 'SUPERADMIN') return res.status(403).json({ error: 'La cuenta de administración conserva su rol.' });
  try {
    const result = await prisma.$transaction(async tx => {
      const application = await tx.professionalApplication.findUnique({ where: { userId: req.authUser!.id } });
      if (!application) return null;
      const user = await tx.user.update({ where: { id: req.authUser!.id, role: { not: 'SUPERADMIN' } }, data: { role: 'PROFESSIONAL', accessGrant: 'DEMO' }, select: privateUserSelect });
      const existing = await tx.business.findFirst({ where: { ownerId: user.id } });
      const business = existing ?? await tx.business.create({ data: { ownerId: user.id, name: application.businessName, category: application.category, description: application.description } });
      return { user, business, demo: true, charged: false };
    }, { isolationLevel: 'Serializable' });
    if (!result) return res.status(400).json({ error: 'Guarda primero los datos de tu empresa.' });
    return res.json(result);
  } catch (error) {
    if ((error as { code?: string }).code === 'P2034') return res.status(409).json({ error: 'Otra activación está en curso. Intenta nuevamente.' });
    throw error;
  }
}
