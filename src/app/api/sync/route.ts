import { NextResponse } from 'next/server';
import { syncAllUsers } from '@/lib/user-sync';
import { apiHandler } from '@/lib/api-handler';

export const POST = apiHandler(async () => {
  const report = await syncAllUsers();
  return NextResponse.json({
    success: report.errors.length === 0,
    data: report,
  });
}, 'api/sync');
