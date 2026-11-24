import type { Prisma } from '../generated/prisma/client.js';
import { mailConfig, mailEnabled } from './mail-config.js';
import { mailTemplate, mailDate, mailMoney } from './mail-template.js';

export async function queueMail(tx: Prisma.TransactionClient, eventKey: string, recipient: string, title: string, introduction: string, details: [string, string][], path: string) {
  if (!mailEnabled()) return;
  const html = mailTemplate(title, introduction, details, new URL(path, mailConfig.MAIL_APP_URL).href);
  await tx.mailNotification.upsert({ where: { eventKey }, update: {}, create: { eventKey, recipient, subject: `${title} · Cronos`, html } });
}
export async function queueReservationMail(tx: Prisma.TransactionClient, id: string, completed = false) {
  if (!mailEnabled()) return;
  const reservation = await tx.reservation.findUniqueOrThrow({ where: { id }, include: { client: true, service: true, business: { include: { owner: { select: { email: true } } } } } });
  const title = completed ? 'Tu atención fue registrada' : 'Tu reserva está confirmada';
  const intro = completed ? 'El profesional registró la atención realizada. Gracias por agendar con Cronos.' : 'Tu hora quedó agendada. Estos son los detalles de tu reserva.';
  const details: [string, string][] = [['Negocio', reservation.business.name], ['Servicio', reservation.service.name], ['Fecha y hora', mailDate(reservation.startsAt, reservation.business.timezone)]];
  if (!completed && reservation.business.address) details.push(['Dirección', reservation.business.address]);
  // A completed session is not proof of payment. Never expose private notes or evidence.
  await queueMail(tx, `reservation:${id}:${completed ? 'completed' : 'confirmed'}`, reservation.client.email, title, intro, details, '/my-reservations');
  if (!completed) {
    const clientName = reservation.client.name?.trim()
      || [reservation.client.firstName, reservation.client.lastName].filter(Boolean).join(' ').trim()
      || 'Un cliente';
    await queueMail(tx, `reservation:${id}:business-confirmed`, reservation.business.owner.email,
      'Nueva cita agendada', `${clientName} ha agendado una cita en ${reservation.business.name}.`,
      [['Cliente', clientName], ['Negocio', reservation.business.name], ['Servicio', reservation.service.name],
        ['Fecha y hora', mailDate(reservation.startsAt, reservation.business.timezone)]], '/dashboard');
  }
}
export async function queueSubscriptionPaymentMail(tx: Prisma.TransactionClient, invoiceId: string, userId: string, businessName: string, until: Date) {
  if (!mailEnabled()) return;
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  await queueMail(tx, `subscription-payment:${invoiceId}:approved`, user.email, 'Recibimos el pago de tu suscripción',
    'Mercado Pago confirmó el pago de tu plan profesional.', [['Empresa', businessName], ['Importe', `${mailMoney(7900)} CLP`], ['Período pagado hasta', mailDate(until)], ['Referencia', invoiceId]], '/subscriptions');
}
