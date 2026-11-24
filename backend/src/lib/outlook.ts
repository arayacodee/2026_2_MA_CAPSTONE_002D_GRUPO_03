import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mailConfig, mailDirectory } from './mail-config.js';

export const outlookScope = 'https://graph.microsoft.com/Mail.Send offline_access';
const authority = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const tokenFile = () => join(mailDirectory, 'authorization.enc');

function encryptionKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error('AUTH_SECRET debe tener al menos 32 caracteres.');
  return createHash('sha256').update(`cronos-outlook:${secret}`).digest();
}
export function sealToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
export function unsealToken(value: string): string {
  const data = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}
export async function saveRefreshToken(token: string) {
  await mkdir(mailDirectory, { recursive: true, mode: 0o700 });
  const temporary = `${tokenFile()}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(temporary, sealToken(token), { mode: 0o600 });
  await rename(temporary, tokenFile());
}
export function requireOutlookCredentials() {
  if (!mailConfig.OUTLOOK_CLIENT_ID || !mailConfig.OUTLOOK_CLIENT_SECRET) {
    throw new Error('Faltan OUTLOOK_CLIENT_ID y OUTLOOK_CLIENT_SECRET en backend/.env.');
  }
}
export function authorizationUrl(state: string, verifier: string) {
  requireOutlookCredentials();
  const params = new URLSearchParams({ client_id: mailConfig.OUTLOOK_CLIENT_ID!, response_type: 'code',
    redirect_uri: mailConfig.OUTLOOK_REDIRECT_URI, response_mode: 'query', scope: outlookScope,
    state, code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256', prompt: 'select_account' });
  return `${authority}/authorize?${params}`;
}
async function requestToken(fields: Record<string, string>) {
  requireOutlookCredentials();
  const response = await fetch(`${authority}/token`, { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: mailConfig.OUTLOOK_CLIENT_ID!, client_secret: mailConfig.OUTLOOK_CLIENT_SECRET!, scope: outlookScope, ...fields }),
    signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string; error_codes?: number[] } | null;
    const code = body?.error?.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 100);
    const numbers = body?.error_codes?.filter(Number.isInteger).join(',');
    throw new Error(`Microsoft OAuth HTTP ${response.status}${code ? ` (${code}${numbers ? `: ${numbers}` : ''})` : ''}. Revisa las credenciales o vuelve a autorizar Outlook.`);
  }
  const result = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
  if (!result.access_token || !result.scope?.split(' ').some(scope => scope.toLowerCase().endsWith('mail.send'))) {
    throw new Error('Microsoft no concedió el permiso Mail.Send.');
  }
  return result;
}
export async function completeAuthorization(code: string, verifier: string) {
  const result = await requestToken({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: mailConfig.OUTLOOK_REDIRECT_URI });
  if (!result.refresh_token) throw new Error('Microsoft no concedió acceso sin conexión. Repite la autorización.');
  await saveRefreshToken(result.refresh_token);
}
let cached: { token: string; expires: number } | undefined;
let refreshing: Promise<string> | undefined;
async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60000) return cached.token;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const refreshToken = unsealToken(await readFile(tokenFile(), 'utf8'));
    const result = await requestToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
    if (result.refresh_token) await saveRefreshToken(result.refresh_token);
    cached = { token: result.access_token!, expires: Date.now() + (result.expires_in ?? 3600) * 1000 };
    return cached.token;
  })();
  try { return await refreshing; } finally { refreshing = undefined; }
}
export async function sendOutlookMail(to: string, subject: string, html: string) {
  const token = await accessToken();
  const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { subject, body: { contentType: 'HTML', content: html },
      toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: true }), signal: AbortSignal.timeout(15000),
  });
  if (response.status === 401) cached = undefined;
  if (response.status !== 202) {
    const body = await response.json().catch(() => null) as { error?: { code?: string } } | null;
    const code = body?.error?.code?.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 100);
    throw new Error(`Microsoft Graph HTTP ${response.status}${code ? ` (${code})` : ''}`);
  }
}
