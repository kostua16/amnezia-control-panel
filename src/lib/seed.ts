import { hash } from 'bcryptjs';
import { prisma } from '@/lib/prisma';

let seeded = false;

/**
 * Ensures a default admin user exists.
 * Safe to call multiple times — it is a no-op after the first successful run.
 */
export async function seedAdmin(): Promise<void> {
  if (seeded) return;

  try {
    const existing = await prisma.admin.findUnique({
      where: { username: 'admin' },
    });

    if (!existing) {
      const adminPassword = process.env.ADMIN_PASSWORD;
      if (!adminPassword) {
        if (process.env.NODE_ENV === 'production') {
          throw new Error(
            'ADMIN_PASSWORD environment variable must be set in production',
          );
        }
        console.warn(
          '[seed] ADMIN_PASSWORD not set — using insecure default "admin". ' +
            'Set ADMIN_PASSWORD in production.',
        );
      }
      const passwordHash = await hash(adminPassword || 'admin', 10);
      await prisma.admin.create({
        data: {
          username: 'admin',
          password: passwordHash,
        },
      });
      console.log('[seed] Default admin user created');
    }

    seeded = true;
  } catch (error) {
    console.error('[seed] Failed to seed admin user:', error);
    throw error;
  }
}
