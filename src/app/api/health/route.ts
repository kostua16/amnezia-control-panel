import { NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api-handler';

export const GET = apiHandler(async () => {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
}, 'api/health');
