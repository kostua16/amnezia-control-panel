import { Prisma } from '@/generated/prisma/client';

/**
 * Type guard: true when `err` is a Prisma unique-constraint violation (P2002).
 */
export function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/**
 * Type guard: true when `err` is a Prisma record-not-found error (P2025).
 */
export function isPrismaNotFound(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025'
  );
}
