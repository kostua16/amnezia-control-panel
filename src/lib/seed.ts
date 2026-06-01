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
      if (!process.env.ADMIN_PASSWORD) {
        throw new Error(
          '[seed] ADMIN_PASSWORD environment variable is not set. Refusing to create admin with insecure default.',
        );
      }
      const passwordHash = await hash(process.env.ADMIN_PASSWORD, 10);
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
