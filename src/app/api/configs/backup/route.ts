import { NextResponse } from 'next/server';
import { backupDatabase, applyRetentionPolicy } from '@/lib/db-backup';

export async function POST() {
  try {
    const backupPath = await backupDatabase();
    const removed = applyRetentionPolicy();

    return NextResponse.json({
      success: true,
      backupPath,
      removedOld: removed.length,
    });
  } catch (error) {
    console.error('[backup] Error:', error);
    return NextResponse.json({ error: 'Backup failed' }, { status: 500 });
  }
}
