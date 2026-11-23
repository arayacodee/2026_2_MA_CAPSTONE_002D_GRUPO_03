import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { addCalendarMonths } from './calendar-months.js';

export const MONTHLY_PRICE = 7900;
export const paymentsConfigured = () => Boolean(env.MP_ACCESS_TOKEN && env.MP_WEBHOOK_SECRET && env.MP_RETURN_URL && env.MP_WEBHOOK_URL);

export async function mpRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (!paymentsConfigured()) throw new Error('Payments not configured');
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    method, headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Mercado Pago HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export function validWebhook(id: string, requestId: string, signature: string, secret: string): boolean {
  const fields = Object.fromEntries(signature.split(',').map(part => part.trim().split('=')));
  if (!/^\d+$/.test(fields.ts ?? '') || !/^[a-fA-F0-9]{64}$/.test(fields.v1 ?? '') || !requestId) return false;
  const digest = createHmac('sha256', secret).update(`id:${id.toLowerCase()};request-id:${requestId};ts:${fields.ts};`).digest();
  return timingSafeEqual(digest, Buffer.from(fields.v1, 'hex'));
}

export interface MPSubscription {
  id: string; external_reference: string; status: string; init_point: string;
  auto_recurring: { frequency: number; frequency_type: string; transaction_amount: number; currency_id: string };
}
export interface MPInvoice {
  id: number; preapproval_id: string; currency_id: string; transaction_amount: number | string;
  debit_date: string; payment?: { id: number; status: string };
}

export function validPlan(remote: MPSubscription, reference: string) {
  const plan = remote.auto_recurring;
  return remote.external_reference === reference && plan?.frequency === 1 && plan.frequency_type === 'months' && Number(plan.transaction_amount) === MONTHLY_PRICE && plan.currency_id === 'CLP';
}

export function invoicePeriodEnd(invoice: MPInvoice): Date | null {
  if (invoice.payment?.status !== 'approved' || invoice.currency_id !== 'CLP' || Number(invoice.transaction_amount) !== MONTHLY_PRICE) return null;
  const start = new Date(invoice.debit_date);
  if (!Number.isFinite(start.getTime()) || start.getTime() > Date.now() + 86400000) return null;
  return addCalendarMonths(start, 1);
}
