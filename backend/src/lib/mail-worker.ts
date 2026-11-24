import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prisma } from './prisma.js';
import { mailConfig, mailDirectory, mailEnabled } from './mail-config.js';
import { sendOutlookMail } from './outlook.js';
import { sendGmailMail } from './gmail.js';

export function mailFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const microsoft = message.match(/^Microsoft (?:Graph|OAuth) HTTP \d{3}(?: \([a-zA-Z0-9_.:, -]{1,150}\))?/);
  if (microsoft) return microsoft[0];
  const smtp = error as { code?: unknown; responseCode?: unknown } | null;
  if (typeof smtp?.code === 'string' && /^E(?:AUTH|CONNECTION|SOCKET|TIMEDOUT|ENVELOPE|MESSAGE|SMTP)$/.test(smtp.code)) {
    const status = typeof smtp.responseCode === 'number' && Number.isInteger(smtp.responseCode) ? ` SMTP ${smtp.responseCode}` : '';
    return `Error de correo ${smtp.code}${status}`;
  }
  const code = (error as { code?: unknown; cause?: { code?: unknown } } | null)?.code
    ?? (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  if (typeof code === 'string' && /^(?:E[A-Z0-9_]{2,40}|UND_ERR_[A-Z_]{1,40})$/.test(code)) return `Error de conexión o archivo: ${code}`;
  if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) return 'Tiempo de espera agotado al contactar Microsoft.';
  return 'No se pudo confirmar la aceptación del correo. Revisa Outlook y su autorización.';
}

export async function processMailBatch() {
  if (!mailEnabled()) return;
  const now = new Date();
  const items = await prisma.mailNotification.findMany({ where: {
    acceptedAt: null, nextAttemptAt: { lte: now },
    ...(mailConfig.MAIL_MODE === 'preview' ? { previewedAt: null } : {}),
    OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
  }, orderBy: { createdAt: 'asc' }, take: 10 });
  for (const item of items) {
    const lockToken = randomUUID();
    const claimed = await prisma.mailNotification.updateMany({ where: { id: item.id, acceptedAt: null,
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] },
      data: { lockedUntil: new Date(Date.now() + 120000), lockToken, attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    try {
      if (mailConfig.MAIL_MODE === 'preview') {
        const directory = join(mailDirectory, 'previews');
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(join(directory, `${item.id}.html`), item.html, { mode: 0o600 });
      } else if (mailConfig.MAIL_MODE === 'gmail') {
        await sendGmailMail(item.recipient, item.subject, item.html);
      } else await sendOutlookMail(item.recipient, item.subject, item.html);
      await prisma.mailNotification.updateMany({ where: { id: item.id, lockToken }, data: {
        ...(mailConfig.MAIL_MODE === 'preview' ? { previewedAt: new Date() } : { acceptedAt: new Date() }),
        lockedUntil: null, lockToken: null, lastError: null,
      } });
    } catch (error) {
      // Log no tokens, recipient addresses or medical details.
      const reason = mailFailureReason(error);
      console.error(`Mail notification failed: ${item.id}: ${reason}`);
      await prisma.mailNotification.updateMany({ where: { id: item.id, lockToken }, data: {
        lockedUntil: null, lockToken: null, lastError: reason,
        nextAttemptAt: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(item.attempts, 7))),
      } });
    }
  }
}
export function startMailWorker() {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> = Promise.resolve();
  const tick = () => {
    active = processMailBatch().catch(() => console.error('Mail queue unavailable. Check migrations and database connectivity.'))
      .finally(() => { if (!stopped) { timer = setTimeout(tick, 15000); timer.unref(); } });
  };
  if (mailEnabled()) tick();
  return async () => { stopped = true; clearTimeout(timer); await active; };
}
