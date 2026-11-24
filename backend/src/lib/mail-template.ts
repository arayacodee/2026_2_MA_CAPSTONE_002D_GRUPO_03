export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
export function mailTemplate(title: string, introduction: string, details: [string, string][], link: string): string {
  const url = new URL(link);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid mail link');
  const hostname = url.hostname.toLowerCase();
  const localLink = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]' || hostname.startsWith('127.') || hostname === '0.0.0.0';
  const button = localLink ? '' : `<p style="margin:32px 0"><a href="${escapeHtml(url.href)}" style="display:inline-block;padding:14px 24px;background:#0f766e;color:white;border-radius:8px;text-decoration:none;font-weight:bold">Abrir Cronos</a></p>`;
  const rows = details.map(([label, value]) => `<tr><td style="padding:12px 0;color:#64748b;border-bottom:1px solid #e2e8f0">${escapeHtml(label)}</td><td style="padding:12px 0;text-align:right;border-bottom:1px solid #e2e8f0">${escapeHtml(value)}</td></tr>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:16px" cellspacing="0" cellpadding="0"><tr><td style="padding:28px 32px;background:#0f172a;color:#fff;border-radius:16px 16px 0 0;font-size:24px;font-weight:bold;letter-spacing:4px">CRONOS</td></tr><tr><td style="padding:32px"><h1 style="font-size:25px;margin:0 0 16px">${escapeHtml(title)}</h1><p style="line-height:1.7;color:#475569">${escapeHtml(introduction)}</p><table width="100%" cellspacing="0" cellpadding="0">${rows}</table>${button}<p style="font-size:12px;line-height:1.6;color:#64748b">Este es un aviso automático de Cronos. Puedes consultar los detalles ingresando a tu cuenta.</p></td></tr></table></td></tr></table></body></html>`;
}
export const mailDate = (date: Date, timeZone = 'America/Santiago') => new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeStyle: 'short', timeZone }).format(date);
export const mailMoney = (amount: string | number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(amount));
