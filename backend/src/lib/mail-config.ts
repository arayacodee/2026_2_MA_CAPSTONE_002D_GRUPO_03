import 'dotenv/config';
import { z } from 'zod';
import { resolve } from 'node:path';

const schema = z.object({
  MAIL_MODE: z.enum(['disabled', 'preview', 'outlook', 'gmail']).default('disabled'),
  GMAIL_USER: z.email().optional(),
  GMAIL_APP_PASSWORD: z.string().transform(value => value.replace(/\s/g, '')).pipe(z.string().regex(/^[a-zA-Z0-9]{16}$/)).optional(),
  OUTLOOK_CLIENT_ID: z.string().uuid().optional(),
  OUTLOOK_CLIENT_SECRET: z.string().min(1).optional(),
  OUTLOOK_REDIRECT_URI: z.string().url().default('http://localhost:3000/api/mail/outlook/callback'),
  MAIL_APP_URL: z.string().url().default('http://localhost:4200'),
  OUTLOOK_DATA_DIR: z.string().min(1).optional(),
});
export const mailConfig = schema.parse(process.env);
export const mailDirectory = resolve(mailConfig.OUTLOOK_DATA_DIR ?? '.outlook');
export const mailEnabled = () => mailConfig.MAIL_MODE !== 'disabled';
