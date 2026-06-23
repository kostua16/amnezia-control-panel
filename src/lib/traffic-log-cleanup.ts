import { prisma } from '@/lib/prisma';

/**
 * Retention period for traffic logs in days (default: 90 days).
 * Configure via RETENTION_DAYS environment variable.
 */
export const RETENTION_DAYS = (() => {
  const parsed = Number.parseInt(process.env.RETENTION_DAYS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 90;
})();

/**
 * Delete traffic log entries older than the retention period.
 * This should be called once daily, not on every broadcaster tick.
 *
 * A single deleteMany is safe here: the application does not bulk-write traffic
 * logs, so the table holds only modest volume and a one-shot delete cannot hold
 * a long write lock. If a high-volume writer is introduced, switch to batched
 * deletes to bound the lock duration.
 */
export async function cleanupOldTrafficLogs(): Promise<number> {
  const retentionDate = new Date();
  retentionDate.setDate(retentionDate.getDate() - RETENTION_DAYS);

  const result = await prisma.trafficLog.deleteMany({
    where: {
      timestamp: {
        lt: retentionDate,
      },
    },
  });

  if (result.count > 0) {
    console.log(
      `[traffic-cleanup] Deleted ${result.count} traffic log entries older than ${RETENTION_DAYS} days`,
    );
  }

  return result.count;
}
