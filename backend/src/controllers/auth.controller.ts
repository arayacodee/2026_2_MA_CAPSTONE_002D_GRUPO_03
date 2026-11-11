import {
  Request,
  Response
} from "express";

import { OAuth2Client } from "google-auth-library";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { hashAdminPassword, verifyAdminPassword } from '../lib/admin-password.js';
import { privateUserSelect } from '../lib/user-profile.js';

import {
  createSessionToken,
  verifySessionToken,
  SESSION_COOKIE
} from "../lib/session.js";

const googleClient = new OAuth2Client(
  env.GOOGLE_CLIENT_ID
);

const googleLoginSchema = z.object({
  credential: z.string().min(1)
});

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.NODE_ENV === "production",
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: "/"
};

const credentialsSchema = z.object({ email: z.string().trim().toLowerCase().max(254).pipe(z.email()), password: z.string().min(1).max(256) }).strict();
const dummyPasswordHash = hashAdminPassword('invalid-account-password');
const registrationSchema = credentialsSchema.extend({ password: z.string().min(8).max(256), firstName: z.string().trim().min(2).max(80), lastName: z.string().trim().min(2).max(80), phone: z.string().trim().min(1).max(40), address: z.string().trim().min(5).max(300) }).strict();
export const passwordLogin = async (req: Request, res: Response) => {
  if (req.headers?.origin && req.headers.origin !== env.CORS_ORIGIN) return res.status(403).json({ error: 'Origen no permitido.' });
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Ingresa un correo y una contraseña válidos.' });
  const user = await prisma.user.findFirst({ where: { email: { equals: parsed.data.email, mode: 'insensitive' } } });
  const valid = await verifyAdminPassword(parsed.data.password, user?.passwordHash ?? await dummyPasswordHash);
  if (!user || !valid || user.role === 'SUPERADMIN') return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  res.cookie(SESSION_COOKIE, await createSessionToken(user.id), cookieOptions);
  return res.json({ user: await prisma.user.findUnique({ where: { id: user.id }, select: privateUserSelect }) });
};
export const register = async (req: Request, res: Response) => {
  if (req.headers?.origin && req.headers.origin !== env.CORS_ORIGIN) return res.status(403).json({ error: 'Origen no permitido.' });
  const parsed = registrationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Completa todos los datos. La contraseña debe tener al menos 8 caracteres.' });
  const { password, ...contact } = parsed.data;
  if (await prisma.user.findFirst({ where: { email: { equals: contact.email, mode: 'insensitive' } } })) return res.status(409).json({ error: 'Ya existe una cuenta con ese correo. Inicia sesión o solicita al administrador que configure tu contraseña.' });
  try {
    const user = await prisma.user.create({ data: { ...contact, name: `${contact.firstName} ${contact.lastName}`, passwordHash: await hashAdminPassword(password), role: 'CLIENT' }, select: privateUserSelect });
    res.cookie(SESSION_COOKIE, await createSessionToken(user.id), cookieOptions);
    return res.status(201).json({ user });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' });
    throw error;
  }
};

export const adminLogin = async (req: Request, res: Response) => {
  if (req.headers.origin && req.headers.origin !== env.CORS_ORIGIN) return res.status(403).json({ error: 'Origen no permitido.' });
  const parsed = z.object({ email: z.string().trim().toLowerCase().min(3).max(254), password: z.string().min(1).max(256) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Ingresa el usuario y la contraseña.' });
  const user = await prisma.user.findUnique({
    where: { email: env.SUPERADMIN_LOGIN },
    select: { id: true, email: true, name: true, role: true, passwordHash: true },
  });
  const storedHash = user?.role === 'SUPERADMIN' ? user.passwordHash : null;
  const passwordHash = storedHash ?? env.SUPERADMIN_PASSWORD_HASH;
  if (!passwordHash) return res.status(503).json({ error: 'El acceso de administración aún no está configurado.' });
  const validPassword = await verifyAdminPassword(parsed.data.password, passwordHash);
  if (parsed.data.email !== env.SUPERADMIN_LOGIN || !validPassword) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  if (!user || user.role !== 'SUPERADMIN') return res.status(403).json({ error: 'La cuenta de administración aún no está habilitada.' });
  const token = await createSessionToken(user.id);
  res.cookie(SESSION_COOKIE, token, cookieOptions);
  return res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
};

export const googleLogin = async (
  req: Request,
  res: Response
) => {
  try {
    const parsed =
      googleLoginSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid login data"
      });
    }

    const { credential } = parsed.data;

    const ticket =
      await googleClient.verifyIdToken({
        idToken: credential,
        audience: env.GOOGLE_CLIENT_ID
      });

    const payload = ticket.getPayload();

    if (
      !payload?.sub ||
      !payload.email ||
      payload.email_verified !== true
    ) {
      return res.status(401).json({
        error: "Invalid Google account"
      });
    }

    const googleId = payload.sub;
    const email = payload.email.trim().toLowerCase();
    const name = payload.name ?? null;

    if (email === env.SUPERADMIN_LOGIN) {
      return res.status(403).json({ error: 'La cuenta compartida de administración ingresa con usuario y contraseña.' });
    }

    let user =
      await prisma.user.findUnique({
        where: {
          googleId
        }
      });

    if (!user) {
      // Las cuentas profesionales prehabilitadas se reconocen por el correo
      // registrado por administración, sin confiar en un rol del cliente.
      const existingByEmail =
        await prisma.user.findFirst({
          where: {
            email: {
              equals: email,
              mode: "insensitive"
            }
          }
        });

      if (existingByEmail) {
        if (
          existingByEmail.googleId &&
          existingByEmail.googleId !== googleId
        ) {
          return res.status(409).json({
            error:
              "This email is already linked to another Google account"
          });
        }

        user = await prisma.user.update({
          where: {
            id: existingByEmail.id
          },

          data: {
            googleId,
            name:
              existingByEmail.name ??
              name
          }
        });
      } else {
        user = await prisma.user.create({
          data: {
            googleId,
            email,
            name,
            role: "CLIENT"
          }
        });
      }
    }

    const sessionToken =
      await createSessionToken(user.id);

    res.cookie(
      SESSION_COOKIE,
      sessionToken,
      cookieOptions
    );

    return res.status(200).json({
      user: await prisma.user.findUnique({ where: { id: user.id }, select: privateUserSelect })
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      "Google authentication failed:",
      message
    );

    return res.status(401).json({
      error: "Google authentication failed"
    });
  }
};

export const getCurrentUser = async (
  req: Request,
  res: Response
) => {
  return res.status(200).json({
    user: req.authUser
  });
};

export const logout = async (
  _req: Request,
  res: Response
) => {
  res.clearCookie(
    SESSION_COOKIE,
    {
      httpOnly: true,
      sameSite: "lax",
      secure:
        env.NODE_ENV === "production",
      path: "/"
    }
  );

  return res.status(204).send();
};
