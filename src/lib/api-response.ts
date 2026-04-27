import { NextResponse } from 'next/server';
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
