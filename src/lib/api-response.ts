import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';
import type { ApiResponse } from '@/types/api';

export function success<T>(
  data: T,
  message?: string,
  status = 200,
): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ success: true, data, message }, { status });
}

export function error(
  message: string,
  status = 500,
): NextResponse<ApiResponse> {
  return NextResponse.json({ success: false, error: message }, { status });
}

/** Extract the first validation message from a Zod parse error. */
export function firstZodError(zodError: ZodError): string {
  return zodError.issues[0]?.message ?? 'Invalid request body';
}

/** Convenience: return a 422 with the first Zod error message. */
export function validationError(zodError: ZodError): NextResponse<ApiResponse> {
  return error(firstZodError(zodError), 422);
}
