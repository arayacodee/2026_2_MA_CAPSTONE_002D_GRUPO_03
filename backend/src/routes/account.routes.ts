import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { privateUserSelect } from '../lib/user-profile.js';
import { smsConfigured, startVerification, checkVerification, VerificationProviderError } from '../lib/phone-verification.js';
import { adminLoginLimit } from '../middleware/admin-login-limit.js';
import { activateProfessionalDemo } from '../controllers/professional-demo.controller.js';
import { paymentsConfigured } from '../lib/mercado-pago.js';
import { contactFields } from '../lib/input-validation.js';

const router = Router();
router.get('/configuration', (_req, res) => res.json({ smsAvailable: smsConfigured(), monthlyPrice: 7900, currency: 'CLP', paymentsAvailable: paymentsConfigured() }));
router.use(authenticate);
router.post('/professional-application/activate-demo', adminLoginLimit(), activateProfessionalDemo);
const contactSchema = z.object(contactFields).strict();


router.patch('/profile', async (req, res) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: 'Revisa nombre, apellido, dirección y teléfono con código de país.' });
  try {
    const user = await prisma.$transaction(async tx => {
      const existing = await tx.user.findUniqueOrThrow({ where: { id: req.authUser!.id } });
      const previousPhone = contactFields.phone.safeParse(existing.phone);
      const changedPhone = !previousPhone.success || previousPhone.data !== parsed.data.phone;
      return tx.user.update({ where: { id: existing.id }, data: { ...parsed.data, name: `${parsed.data.firstName} ${parsed.data.lastName}`, ...(changedPhone ? { phoneVerifiedAt: null, pendingVerificationSid: null } : {}) }, select: privateUserSelect });
    }, { isolationLevel: 'Serializable' });
    res.json({ user });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2034') return void res.status(409).json({ error: 'Tus datos cambiaron; vuelve a guardar el formulario.' });
    throw error;
  }
});

router.post('/phone/send', adminLoginLimit(), async (req, res) => {
  if (!smsConfigured()) return void res.status(503).json({ error: 'La verificación por SMS todavía no está disponible.' });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.authUser!.id } });
  if (!user.phone) return void res.status(400).json({ error: 'Guarda tu teléfono primero.' });
  const sentAt = new Date();
  const reserved = await prisma.user.updateMany({ where: { id: user.id, phone: user.phone, OR: [{ phoneVerificationSentAt: null }, { phoneVerificationSentAt: { lte: new Date(sentAt.getTime() - 60000) } }] }, data: { phoneVerificationSentAt: sentAt, pendingVerificationSid: null } });
  if (!reserved.count) return void res.status(429).json({ error: 'Espera un minuto antes de solicitar otro código.' });
  try {
    const verification = await startVerification(user.phone);
    if (verification.status !== 'pending' || !/^VE[a-fA-F0-9]{32}$/.test(verification.sid)) throw new VerificationProviderError(502);
    const saved = await prisma.user.updateMany({ where: { id: user.id, phone: user.phone, phoneVerificationSentAt: sentAt }, data: { pendingVerificationSid: verification.sid } });
    if (!saved.count) return void res.status(409).json({ error: 'El teléfono cambió; solicita un nuevo código.' });
    res.json({ message: 'Código enviado por SMS. Ingresa el código recibido.' });
  } catch { res.status(502).json({ error: 'No fue posible enviar el código. Intenta nuevamente más tarde.' }); }
});
router.post('/phone/check', adminLoginLimit(), async (req, res) => {
  if (!smsConfigured()) return void res.status(503).json({ error: 'La verificación por SMS todavía no está disponible.' });
  const parsed = z.object({ code: z.string().regex(/^\d{4,10}$/) }).strict().safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: 'Ingresa el código recibido por SMS.' });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.authUser!.id } });
  if (!user.pendingVerificationSid || !user.phoneVerificationSentAt || Date.now() - user.phoneVerificationSentAt.getTime() > 10 * 60000) return void res.status(400).json({ error: 'Solicita un nuevo código; el anterior expiró.' });
  try {
    const result = await checkVerification(user.pendingVerificationSid, parsed.data.code);
    if (result.status !== 'approved' || result.to !== user.phone) return void res.status(400).json({ error: 'El código es incorrecto o expiró.' });
    const updated = await prisma.user.updateMany({ where: { id: user.id, phone: user.phone, pendingVerificationSid: user.pendingVerificationSid }, data: { phoneVerifiedAt: new Date(), pendingVerificationSid: null } });
    if (!updated.count) return void res.status(409).json({ error: 'El teléfono cambió; solicita un nuevo código.' });
    res.json({ user: await prisma.user.findUnique({ where: { id: user.id }, select: privateUserSelect }) });
  } catch (error) {
    res.status(error instanceof VerificationProviderError && [400, 404, 429].includes(error.status) ? 400 : 502).json({ error: 'No fue posible verificar el código. Solicita otro e intenta nuevamente.' });
  }
});

router.get('/professional-application', async (req, res) => {
  res.json({ application: await prisma.professionalApplication.findUnique({ where: { userId: req.authUser!.id } }) });
});
router.put('/professional-application', async (req, res) => {
  const parsed = z.object({ businessName: z.string().trim().min(2).max(100), category: z.enum(['GENERAL', 'WELLNESS', 'BEAUTY']), description: z.string().trim().max(500).nullable().optional() }).strict().safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: 'Revisa el nombre y la categoría de tu empresa.' });
  // This is a saved draft, never a payment or a role elevation.
  const application = await prisma.professionalApplication.upsert({ where: { userId: req.authUser!.id }, create: { userId: req.authUser!.id, ...parsed.data }, update: parsed.data });
  res.json({ application, paymentsAvailable: paymentsConfigured() });
});
export default router;

