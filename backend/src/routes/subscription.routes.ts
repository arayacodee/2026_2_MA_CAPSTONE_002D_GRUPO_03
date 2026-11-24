import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { adminLoginLimit } from '../middleware/admin-login-limit.js';
import { paymentsConfigured, mpRequest, validWebhook, validPlan, MONTHLY_PRICE, type MPSubscription, type MPInvoice } from '../lib/mercado-pago.js';
import { syncSubscription } from '../lib/subscriptions.js';

const router = Router();
router.post('/webhook', async (req, res) => {
  if (!paymentsConfigured()) return void res.sendStatus(503);
  const id = req.query['data.id'];
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id) || !validWebhook(id, req.get('x-request-id') ?? '', req.get('x-signature') ?? '', env.MP_WEBHOOK_SECRET!)) return void res.sendStatus(401);
  try {
    const topic = req.query.type ?? req.body?.type;
    if (topic === 'subscription_preapproval') await syncSubscription(id);
    else if (topic === 'subscription_authorized_payment') {
      const invoice = await mpRequest<MPInvoice>(`/authorized_payments/${encodeURIComponent(id)}`);
      await syncSubscription(invoice.preapproval_id);
    } else if (topic === 'payment') {
      const invoices = await mpRequest<{ results: MPInvoice[] }>(`/authorized_payments/search?payment_id=${encodeURIComponent(id)}`);
      for (const invoice of invoices.results) await syncSubscription(invoice.preapproval_id);
    }
    res.sendStatus(200);
  } catch {
    console.error('Subscription webhook reconciliation failed');
    res.sendStatus(503); // Let the provider retry; never acknowledge a lost update.
  }
});
router.use(authenticate);
router.post('/checkout', adminLoginLimit(), async (req, res) => {
  if (req.body?.acceptedRecurring !== true) {
    return void res.status(400).json({ error: 'Acepta el cobro automático mensual para continuar.', field: 'acceptedRecurring' });
  }
  if (!paymentsConfigured()) return void res.status(503).json({ error: 'El pago todavía no está configurado.' });
  const user = req.authUser!;
  if (user.role === 'SUPERADMIN') return void res.sendStatus(403);
  const application = await prisma.professionalApplication.findUnique({ where: { userId: user.id } });
  if (!application) return void res.status(400).json({ error: 'Guarda primero los datos de tu empresa.' });
  let local = await prisma.professionalSubscription.findUnique({ where: { activeKey: user.id } });
  let created = false;
  if (!local) {
    try {
      local = await prisma.professionalSubscription.create({ data: { id: randomUUID(), userId: user.id, activeKey: user.id, businessName: application.businessName, category: application.category, description: application.description } });
      created = true;
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      return void res.status(409).json({ error: 'Ya se está preparando tu suscripción. Espera y vuelve a consultar.' });
    }
  }
  try {
    if (!local.providerId) {
      let remote: MPSubscription;
      if (created) {
        remote = await mpRequest<MPSubscription>('/preapproval', 'POST', {
          reason: 'Cronos · Plan profesional mensual', external_reference: local.id,
          payer_email: env.NODE_ENV !== 'production' ? (env.MP_TEST_PAYER_EMAIL ?? user.email) : user.email,
          auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: MONTHLY_PRICE, currency_id: 'CLP' },
          back_url: env.MP_RETURN_URL, notification_url: env.MP_WEBHOOK_URL, status: 'pending',
        });
      } else {
        // An ambiguous timeout must not create a second recurring mandate.
        const found = await mpRequest<{ results: MPSubscription[] }>(`/preapproval/search?external_reference=${encodeURIComponent(local.id)}`);
        const matches = found.results.filter(record => validPlan(record, local!.id));
        if (matches.length !== 1) return void res.status(409).json({ error: 'Estamos verificando un intento anterior. Contacta a soporte si no cambia; no se creará otra suscripción.' });
        remote = matches[0];
      }
      if (!validPlan(remote, local.id)) throw new Error('Invalid subscription');
      const url = new URL(remote.init_point);
      if (url.protocol !== 'https:' || !['www.mercadopago.cl', 'www.mercadopago.com'].includes(url.hostname)) throw new Error('Invalid checkout URL');
      local = await prisma.professionalSubscription.update({ where: { id: local.id }, data: { providerId: remote.id, status: remote.status, checkoutUrl: remote.init_point } });
    }
    if (local.status !== 'pending') return void res.status(409).json({ error: 'Ya tienes una suscripción. Consulta su estado antes de iniciar otra.' });
    res.json({ checkoutUrl: local.checkoutUrl });
  } catch {
    res.status(502).json({ error: 'No pudimos preparar el pago. Tu intento quedó registrado para evitar duplicados. Vuelve a consultar.' });
  }
});
router.get('/', async (req, res) => {
  const userId = req.authUser!.id;
  const [subscriptions, user] = await Promise.all([
    prisma.professionalSubscription.findMany({ where: { userId, OR: [{ providerId: { not: null } }, { status: 'creating' }] }, orderBy: { createdAt: 'desc' }, take: 1 }),
    prisma.user.findUnique({ where: { id: userId }, select: { manualAccessUntil: true } }),
  ]);
  res.json({
    manualAccessUntil: user?.manualAccessUntil ?? null,
    subscriptions: subscriptions.map(({ id, status, paidUntil, businessName }) => ({ id, status, paidUntil, businessName })),
  });
});
router.post('/refresh', adminLoginLimit(), async (req, res) => {
  if (!paymentsConfigured()) return void res.sendStatus(503);
  try {
    const records = await prisma.professionalSubscription.findMany({ where: { userId: req.authUser!.id, providerId: { not: null } } });
    for (const record of records) await syncSubscription(record.providerId!);
    res.json({ message: 'Estado actualizado.' });
  } catch { res.status(502).json({ error: 'No pudimos consultar el pago. Intenta nuevamente.' }); }
});
router.post('/:id/cancel', adminLoginLimit(), async (req, res) => {
  if (!paymentsConfigured()) return void res.sendStatus(503);
  if (typeof req.params.id !== 'string') return void res.sendStatus(400);
  const local = await prisma.professionalSubscription.findFirst({ where: { id: req.params.id, userId: req.authUser!.id } });
  if (!local?.providerId) return void res.sendStatus(404);
  try {
    await mpRequest(`/preapproval/${encodeURIComponent(local.providerId)}`, 'PUT', { status: 'cancelled' });
    await syncSubscription(local.providerId);
    res.json({ message: 'Renovación cancelada. Conservas el acceso hasta terminar el período pagado.' });
  } catch { res.status(502).json({ error: 'No pudimos confirmar la cancelación. Vuelve a consultar el estado.' }); }
});
export default router;
