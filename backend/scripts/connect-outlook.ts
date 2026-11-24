import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mailConfig } from '../src/lib/mail-config.js';
import { authorizationUrl, completeAuthorization } from '../src/lib/outlook.js';

// Local administrative helper only: no public authorization endpoint is exposed.
const redirect = new URL(mailConfig.OUTLOOK_REDIRECT_URI);
if (redirect.protocol !== 'http:' || redirect.hostname !== 'localhost' || redirect.search || redirect.hash) {
  throw new Error('Para conectar localmente usa una URI http://localhost:PUERTO/api/mail/outlook/callback.');
}
const state = randomBytes(32).toString('base64url');
const verifier = randomBytes(64).toString('base64url');
const link = authorizationUrl(state, verifier);
let consumed = false;
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  const incoming = new URL(req.url ?? '/', redirect.origin);
  if (incoming.pathname !== redirect.pathname || req.method !== 'GET') { res.writeHead(404).end(); return; }
  const receivedState = Buffer.from(incoming.searchParams.get('state') ?? '');
  const expectedState = Buffer.from(state);
  if (consumed || receivedState.length !== expectedState.length || !timingSafeEqual(receivedState, expectedState)) {
    res.writeHead(400).end('Solicitud inválida. Usa el enlace generado en la terminal.'); return;
  }
  consumed = true;
  try {
    const code = incoming.searchParams.get('code');
    if (!code || incoming.searchParams.has('error')) throw new Error('La autorización fue cancelada o rechazada en Microsoft.');
    await completeAuthorization(code, verifier);
    res.end('Outlook conectado con Cronos. Puedes cerrar esta pestaña. No se ha enviado ningún correo.');
    console.log('Outlook conectado. Autorización guardada cifrada; no se enviaron correos.');
  } catch (error) {
    res.writeHead(400).end('No se pudo conectar Outlook. Revisa la terminal y vuelve a ejecutar el comando.');
    console.error(error instanceof Error ? error.message : 'Falló la autorización.');
    process.exitCode = 1;
  } finally { clearTimeout(timeout); server.close(); }
});
server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(error.code === 'EADDRINUSE' ? 'El puerto está ocupado. Detén temporalmente el backend y repite npm run outlook:connect.' : 'No se pudo iniciar el asistente local.');
  clearTimeout(timeout); process.exitCode = 1;
});
const timeout = setTimeout(() => { console.error('El enlace venció. Ejecuta nuevamente npm run outlook:connect.'); server.close(); process.exitCode = 1; }, 10 * 60 * 1000);
server.listen(Number(redirect.port || 80), 'localhost', () => console.log(`Abre este enlace e inicia sesión con la cuenta remitente de Cronos:\n\n${link}\n\nEsperando autorización (10 minutos).`));
