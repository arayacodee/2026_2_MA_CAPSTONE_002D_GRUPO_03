import nodemailer from 'nodemailer';
import { mailConfig } from './mail-config.js';

export function gmailTransportOptions() {
  if (!mailConfig.GMAIL_USER || !mailConfig.GMAIL_APP_PASSWORD) {
    throw new Error('Configura GMAIL_USER y GMAIL_APP_PASSWORD antes de habilitar Gmail.');
  }
  return {
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: mailConfig.GMAIL_USER, pass: mailConfig.GMAIL_APP_PASSWORD },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    disableFileAccess: true, disableUrlAccess: true,
  };
}

let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
function gmailTransport() {
  return transport ??= nodemailer.createTransport(gmailTransportOptions());
}

export async function verifyGmailConnection() {
  await gmailTransport().verify();
}

export async function sendGmailMail(to: string, subject: string, html: string) {
  const result = await gmailTransport().sendMail({
    from: { name: 'Cronos', address: mailConfig.GMAIL_USER! },
    to, subject, html,
  });
  if (result.rejected?.length || !result.accepted?.length) {
    throw new Error('Gmail no aceptó el destinatario del mensaje.');
  }
}
