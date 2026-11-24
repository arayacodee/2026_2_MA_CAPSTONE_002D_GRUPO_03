import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'cronos-mail-test-'));
Object.assign(process.env, { MAIL_MODE: 'preview', OUTLOOK_DATA_DIR: directory,
  OUTLOOK_CLIENT_ID: '11111111-2222-4333-8444-555555555555', OUTLOOK_CLIENT_SECRET: 'test-only-secret',
  OUTLOOK_REDIRECT_URI: 'http://localhost:3000/api/mail/outlook/callback',
  MAIL_APP_URL: 'https://cronos.example.com', DATABASE_URL: 'postgresql://test:test@localhost/test',
  GOOGLE_CLIENT_ID: 'test', AUTH_SECRET: 'test-secret-with-at-least-32-characters',
  CLOUDINARY_CLOUD_NAME: 'test', CLOUDINARY_API_KEY: 'test', CLOUDINARY_API_SECRET: 'test' });
const { mailTemplate } = await import('../src/lib/mail-template.js');
const { queueReservationMail } = await import('../src/lib/notifications.js');
const { authorizationUrl, sealToken, unsealToken, completeAuthorization, sendOutlookMail } = await import('../src/lib/outlook.js');
const { processMailBatch, mailFailureReason } = await import('../src/lib/mail-worker.js');
const { prisma } = await import('../src/lib/prisma.js');
const { mailConfig } = await import('../src/lib/mail-config.js');

test('el diagnóstico de correo conserva códigos y omite datos privados', () => {
  assert.equal(mailFailureReason(new Error('Microsoft Graph HTTP 403 (ErrorAccessDenied)')), 'Microsoft Graph HTTP 403 (ErrorAccessDenied)');
  assert.equal(mailFailureReason(new Error('Microsoft OAuth HTTP 400 (invalid_grant: 70000). Revisa las credenciales.')), 'Microsoft OAuth HTTP 400 (invalid_grant: 70000)');
  assert.equal(mailFailureReason(new Error('fetch failed', { cause: { code: 'ECONNRESET' } })), 'Error de conexión o archivo: ECONNRESET');
  assert.ok(!mailFailureReason(new Error('recipient@example.com secret-token')).includes('secret-token'));
  assert.ok(!mailFailureReason(new Error('recipient@example.com secret-token')).includes('@'));
});

test('correos: escape HTML, cola sin duplicados, privacidad, OAuth, cifrado y reintentos', async () => {
  const originalFetch = globalThis.fetch;
  const originalFind = prisma.mailNotification.findMany;
  const originalUpdate = prisma.mailNotification.updateMany;
  try {
    const html = mailTemplate('<script>alert(1)</script>', 'Hola & adiós', [['Servicio', '<img src=x>']], 'http://localhost:4200/my-reservations');
    assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;img')); assert.ok(html.includes('Hola &amp;'));
    assert.throws(() => mailTemplate('a', 'b', [], 'javascript:alert(1)'));
    assert.ok(!html.includes('href='), 'no incluir enlaces a localhost');
    assert.ok(mailTemplate('a', 'b', [], 'https://cronos.example.com/my-reservations').includes('href="https://cronos.example.com/my-reservations"'));
    for (const host of ['127.0.0.1', '[::1]', 'app.localhost']) {
      assert.ok(!mailTemplate('a', 'b', [], 'http://' + host + ':4200').includes('href='));
    }
    const url = new URL(authorizationUrl('random-state', 'verifier'));
    assert.equal(url.searchParams.get('state'), 'random-state');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(url.searchParams.get('scope')?.includes('Mail.Send'));
    assert.ok(!url.href.includes('test-only-secret'));
    const encrypted = sealToken('refresh-token');
    assert.equal(unsealToken(encrypted), 'refresh-token');
    assert.ok(!encrypted.includes('refresh-token'));
    const tampered = Buffer.from(encrypted, 'base64'); tampered[30] ^= 1;
    assert.throws(() => unsealToken(tampered.toString('base64')));

    const queued = new Map<string, any>();
    const tx = { reservation: { findUniqueOrThrow: async () => ({ startsAt: new Date('2026-11-22T15:00:00Z'),
      client: { name: 'Ana <Pérez>', email: 'client@example.com' }, service: { name: '<Terapia>' },
      business: { name: 'Empresa', timezone: 'America/Santiago', address: 'Dirección', owner: { email: 'owner@example.com' } }, notes: 'PRIVATE NOTE' }) },
      mailNotification: { upsert: async ({ create }: any) => { if (!queued.has(create.eventKey)) queued.set(create.eventKey, create); } } };
    await queueReservationMail(tx as any, 'reservation');
    await queueReservationMail(tx as any, 'reservation');
    await queueReservationMail(tx as any, 'reservation', true);
    assert.equal(queued.size, 3, 'una confirmación por destinatario y un aviso de atención solo al cliente');
    const businessNotice = queued.get('reservation:reservation:business-confirmed');
    assert.equal(businessNotice.recipient, 'owner@example.com');
    assert.equal(businessNotice.subject, 'Nueva cita agendada · Cronos');
    assert.ok(businessNotice.html.includes('Ana &lt;Pérez&gt; ha agendado una cita'));
    assert.ok(businessNotice.html.includes('/dashboard'));
    assert.ok(businessNotice.html.includes('22 de noviembre de 2026'));
    assert.equal(queued.get('reservation:reservation:confirmed').recipient, 'client@example.com');
    assert.equal(queued.get('reservation:reservation:completed').recipient, 'client@example.com');
    for (const value of queued.values()) {
      assert.ok(value.html.includes(value.recipient === 'owner@example.com' ? '/dashboard' : '/my-reservations'));
      assert.ok(!value.html.includes('PRIVATE NOTE'));
      assert.ok(!value.html.includes('Zona horaria'));
      assert.ok(!value.subject.includes('pagad')); assert.ok(value.html.includes('&lt;Terapia&gt;'));
    }

    let tokenCalls = 0; let graphCalls = 0;
    globalThis.fetch = (async (input: any, init: any) => {
      if (String(input).includes('/token')) {
        tokenCalls++;
        const body = new URLSearchParams(init.body);
        assert.equal(body.get('client_secret'), 'test-only-secret');
        return Response.json({ access_token: 'access', refresh_token: 'rotated-refresh', expires_in: 3600, scope: 'Mail.Send' });
      }
      graphCalls++;
      assert.equal(input, 'https://graph.microsoft.com/v1.0/me/sendMail');
      assert.equal(JSON.parse(init.body).message.toRecipients[0].emailAddress.address, 'client@example.com');
      return new Response(null, { status: 202 });
    }) as typeof fetch;
    await completeAuthorization('test-code', 'verifier');
    const stored = await readFile(join(directory, 'authorization.enc'), 'utf8');
    assert.ok(!stored.includes('rotated-refresh'));
    await sendOutlookMail('client@example.com', 'Prueba simulada', html);
    await sendOutlookMail('client@example.com', 'Prueba simulada', html);
    assert.equal(tokenCalls, 2); assert.equal(graphCalls, 2);

    const updates: any[] = [];
    prisma.mailNotification.findMany = (async () => [{ id: 'message', attempts: 0, recipient: 'client@example.com', subject: 'Aviso', html }]) as any;
    prisma.mailNotification.updateMany = (async (args: any) => { updates.push(args); return { count: 1 }; }) as any;
    await processMailBatch();
    assert.equal(graphCalls, 2, 'preview no envía a Microsoft');
    assert.ok((await readFile(join(directory, 'previews/message.html'), 'utf8')).includes('CRONOS'));
    assert.ok(updates.at(-1).data.previewedAt); assert.equal(updates.at(-1).data.acceptedAt, undefined);
    mailConfig.MAIL_MODE = 'outlook';
    globalThis.fetch = (async () => new Response(null, { status: 429 })) as typeof fetch;
    await processMailBatch();
    assert.equal(updates.at(-1).data.lockedUntil, null);
    assert.ok(updates.at(-1).data.nextAttemptAt > new Date());
    assert.equal(updates.at(-1).data.acceptedAt, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    prisma.mailNotification.findMany = originalFind; prisma.mailNotification.updateMany = originalUpdate;
    mailConfig.MAIL_MODE = 'preview';
    await rm(directory, { recursive: true, force: true });
  }
});
