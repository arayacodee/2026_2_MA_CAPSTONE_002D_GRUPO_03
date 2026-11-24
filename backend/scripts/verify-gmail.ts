import { verifyGmailConnection } from '../src/lib/gmail.js';
import { mailFailureReason } from '../src/lib/mail-worker.js';

try {
  await verifyGmailConnection();
  console.log('Conexión y autenticación con Gmail correctas. No se enviaron correos.');
} catch (error) {
  console.error(mailFailureReason(error));
  process.exitCode = 1;
}
