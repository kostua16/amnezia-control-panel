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
 * For a P2002 unique-constraint violation, return the offending column names
 * (Prisma populates `meta.target`). Returns undefined when the target cannot be
 * read, so callers can fall back to a generic message.
 */
export function uniqueViolationTarget(err: unknown): string[] | undefined {
  if (!isPrismaUniqueViolation(err)) {
    return undefined;
  }
  const target = (err as Prisma.PrismaClientKnownRequestError).meta?.target;
  return Array.isArray(target)
    ? target.filter((t): t is string => typeof t === 'string')
    : undefined;
}

/**
 * Type guard: true when `err` is a Prisma record-not-found error (P2025).
 */
export function isPrismaNotFound(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025'
  );
}
