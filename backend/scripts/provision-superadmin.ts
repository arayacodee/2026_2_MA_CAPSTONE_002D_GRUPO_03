import { prisma } from '../src/lib/prisma.js';
import { env } from '../src/config/env.js';

// Apply the SUPERADMIN migration first, only against the confirmed development database.
try {
  const passwordHash = env.SUPERADMIN_PASSWORD_HASH;
  if (!passwordHash) {
    console.error('Configura primero las credenciales con npm run admin:configure.');
    process.exitCode = 1;
  } else {
    const updated = await prisma.user.updateMany({
      where: { email: env.SUPERADMIN_LOGIN, role: 'SUPERADMIN', googleId: null },
      data: { passwordHash },
    });
    if (updated.count === 0) {
      await prisma.user.create({
        data: { email: env.SUPERADMIN_LOGIN, name: 'Administración Cronos', role: 'SUPERADMIN', passwordHash },
      });
    }
    console.log('Cuenta compartida habilitada con contraseña en la base de datos. Ingresa en /admin/login.');
  }
} catch (error) {
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  console.error(code === 'P2002'
    ? 'El identificador pertenece a otra cuenta o cambió durante la operación.'
    : 'No se pudo guardar el hash de la cuenta compartida.');
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
