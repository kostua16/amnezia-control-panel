import { NextResponse } from 'next/server';
import path from 'node:path';
import { backupDatabase, applyRetentionPolicy } from '@/lib/db-backup';

export async function POST() {
  try {
    const backupPath = await backupDatabase();
    const removed = applyRetentionPolicy();

    return NextResponse.json({
      success: true,
      // Return only the file name — the absolute server path would leak the
      // deployment directory structure to the client.
      backupFile: path.basename(backupPath),
      removedOld: removed.length,
    });
  } catch (error) {
    console.error('[backup] Error:', error);
    return NextResponse.json({ error: 'Backup failed' }, { status: 500 });
  }
}
