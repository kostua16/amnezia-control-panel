import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

/** Default retention: keep the 7 most recent backups. */
const DEFAULT_RETENTION = 7;

/** Directory where backup files are stored (relative to project root). */
const BACKUP_DIR = 'backups';

/**
 * Resolve the SQLite database file path from DATABASE_URL.
 * Handles the `file:` prefix used by Prisma adapter-better-sqlite3.
 */
export function resolveDbPath(): string {
  const url = process.env.DATABASE_URL ?? 'file:./prisma/dev.db';
  let resolved = url.startsWith('file:') ? url.slice(5) : url;
  // Drop any `?query` suffix — Prisma connection params are not a valid file path.
  const queryIndex = resolved.indexOf('?');
  if (queryIndex !== -1) {
    resolved = resolved.slice(0, queryIndex);
  }
  return resolved;
}

/**
 * Create a point-in-time backup of the SQLite database.
 *
 * 1. Opens a connection to the live database.
 * 2. Flushes the WAL to the main file via `PRAGMA wal_checkpoint(TRUNCATE)`.
 * 3. Uses better-sqlite3's built-in `backup()` (maps to `sqlite3_backup_*`).
 * 4. Returns the absolute path of the created backup file.
 */
export async function backupDatabase(targetPath?: string): Promise<string> {
  const dbPath = resolveDbPath();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile =
    targetPath ?? path.join(BACKUP_DIR, `backup-${timestamp}.db`);

  fs.mkdirSync(path.dirname(backupFile), { recursive: true });

  const db = new Database(dbPath);

  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    // better-sqlite3's backup() returns a Promise; awaiting it ensures the
    // copy completes before db.close() runs in finally — otherwise the backup
    // is aborted mid-write and the route still reports success.
    await db.backup(backupFile);
  } finally {
    db.close();
  }

  return path.resolve(backupFile);
}

/**
 * Delete old backup files, keeping only the `keepCount` most recent.
 * Returns the list of removed file names.
 */
export function applyRetentionPolicy(
  backupDir: string = BACKUP_DIR,
  keepCount: number = DEFAULT_RETENTION,
): string[] {
  if (!fs.existsSync(backupDir)) return [];

  const files = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith('backup-') && f.endsWith('.db'))
    .sort();

  const removed: string[] = [];
  while (files.length > keepCount) {
    const oldest = files.shift()!;
    fs.unlinkSync(path.join(backupDir, oldest));
    removed.push(oldest);
  }

  return removed;
}
