import { NextResponse } from 'next/server';
import { syncAllUsers } from '@/lib/user-sync';

export async function POST() {
  try {
    const report = await syncAllUsers();

    return NextResponse.json({
      success: report.errors.length === 0,
      data: report,
    });
  } catch (err) {
    console.error('[api/sync POST] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to run sync' },
      { status: 500 },
    );
  }
}
