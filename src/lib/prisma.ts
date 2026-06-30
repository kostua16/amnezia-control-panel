import { PrismaClient } from '@/generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? 'file:./prisma/dev.db',
  });
  const client = new PrismaClient({ adapter });

  client
    .$executeRawUnsafe('PRAGMA journal_mode = WAL')
    .then(() => client.$executeRawUnsafe('PRAGMA busy_timeout = 5000'))
    .catch((err: unknown) => {
      const message =
        err instanceof Error ? err.message : 'Failed to configure SQLite';
      console.warn(`[prisma] SQLite PRAGMA setup skipped: ${message}`);
    });

  return client;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export interface DatabaseHealthResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * Probe database connectivity with a bounded timeout. Runs `SELECT 1` and
 * resolves to a structured health result rather than throwing, so callers such
 * as `/api/health` can report status without try/catch noise. Resolves
 * `ok: false` when the query errors or exceeds `timeoutMs`.
 */
export async function checkDatabaseConnection(
  timeoutMs = 3000,
): Promise<DatabaseHealthResult> {
  const started = Date.now();
  const probe = prisma.$queryRaw`SELECT 1`
    .then((): DatabaseHealthResult => ({
      ok: true,
      latencyMs: Date.now() - started,
    }))
    .catch((err: unknown): DatabaseHealthResult => ({
      ok: false,
      error: err instanceof Error ? err.message : 'Database probe failed',
    }));

  const timeout = new Promise<DatabaseHealthResult>((resolve) => {
    setTimeout(
      () =>
        resolve({
          ok: false,
          error: `Database probe timed out after ${timeoutMs}ms`,
        }),
      timeoutMs,
    ).unref();
  });

  return Promise.race([probe, timeout]);
}
