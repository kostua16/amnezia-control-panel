import { NextRequest } from 'next/server';
import { Prisma } from '@/generated/prisma/client';
import { ZodError } from 'zod';
import { error, firstZodError } from '@/lib/api-response';

/**
 * Dynamic-route context: the second argument Next.js passes to handlers under
 * `app/api/[param]/route.ts`. Re-exported so route files can type their
 * handlers consistently while still benefiting from `apiHandler`.
 */
export type RouteContext<P = Record<string, string | string[]>> = {
  params: Promise<P>;
};

/** A Next.js App Router route handler `(request, context) => Response`. */
export type RouteHandler<P = Record<string, string | string[]>> = (
  request: NextRequest,
  context: RouteContext<P>,
) => Promise<Response>;

/**
 * Map a Prisma known-request error code to the matching HTTP status.
 * P2002 (unique-constraint violation) → 409, P2025 (record not found) → 404.
 * Returns null for codes we do not explicitly translate.
 */
function prismaHttpStatus(code: string): number | null {
  switch (code) {
    case 'P2002':
      return 409;
    case 'P2025':
      return 404;
    default:
      return null;
  }
}

/**
 * Convert any thrown error into the standardized JSON error response.
 * Centralizes Prisma / Zod / unknown mapping so route handlers can drop their
 * manual try/catch blocks. `label` is the request path, logged for tracing.
 */
export function toErrorResponse(err: unknown, label: string): Response {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const status = prismaHttpStatus(err.code) ?? 500;
    const message =
      status === 409
        ? 'Resource already exists'
        : status === 404
          ? 'Resource not found'
          : 'Database request failed';
    console.error(`[${label}] Prisma error ${err.code}:`, err);
    return error(message, status);
  }

  if (err instanceof ZodError) {
    return error(firstZodError(err), 422);
  }

  console.error(`[${label}] Error:`, err);
  return error('Internal server error', 500);
}

/**
 * Wrap a Next.js route handler with standardized error handling. Every thrown
 * error is mapped to a consistent JSON shape and logged with `label` (the
 * request path), so routes no longer need manual try/catch boilerplate.
 *
 * Generic over the wrapped handler's arguments so it preserves the exact
 * signature Next.js expects — handlers may declare `(request)`, `(request,
 * context)`, or even `()` and all stay correctly typed.
 */
export function apiHandler<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
  label: string,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      return toErrorResponse(err, label);
    }
  };
}
