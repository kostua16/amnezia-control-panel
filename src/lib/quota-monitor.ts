import { prisma } from '@/lib/prisma';
import { createAlert } from '@/lib/alert-service';
import type { AlertSeverity } from '@/generated/prisma/enums';

/** Quota alert thresholds in percent */
export const QUOTA_THRESHOLDS = [
  { percent: 80, severity: 'WARNING' as AlertSeverity },
  { percent: 90, severity: 'WARNING' as AlertSeverity },
  { percent: 100, severity: 'CRITICAL' as AlertSeverity },
];

/** How often to check quotas (ms) */
export const QUOTA_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Determine which quota thresholds are exceeded by a usage percentage.
 * Returns thresholds in ascending order (80, 90, 100).
 */
export function getExceededQuotaThresholds(
  usagePercent: number,
): Array<{ percent: number; severity: AlertSeverity }> {
  return QUOTA_THRESHOLDS.filter((t) => usagePercent >= t.percent);
}

/**
 * Check all users against their traffic quotas.
 * Creates alerts for users crossing thresholds.
 * Prevents duplicate alerts by checking for recent alerts of the same type.
 */
export async function checkUserQuotas(): Promise<{
  checked: number;
  alertsCreated: number;
  details: Array<{
    userId: number;
    username: string;
    percent: number;
    severity: AlertSeverity;
  }>;
}> {
  // Get all active users with their quotas
  const usersWithQuotas = await prisma.user.findMany({
    where: {
      isActive: true,
      quotas: { some: { quotaBytes: { gt: 0 } } },
    },
    include: {
      quotas: true,
    },
  });

  // Bulk-fetch all recent quota alerts for dedup (Proposal 14: avoid N+1 queries)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentAlerts = await prisma.alert.findMany({
    where: {
      type: { startsWith: 'quota_' },
      createdAt: { gte: oneHourAgo },
    },
    select: { type: true },
  });
  const recentAlertTypes = new Set(recentAlerts.map((a) => a.type));

  const results = {
    checked: usersWithQuotas.length,
    alertsCreated: 0,
    details: [] as Array<{
      userId: number;
      username: string;
      percent: number;
      severity: AlertSeverity;
    }>,
  };

  for (const user of usersWithQuotas) {
    // quotas is an array (one-to-many relation in Prisma)
    const quota = user.quotas.at(0);
    if (!quota || quota.quotaBytes <= 0) continue;

    const usagePercent = await getUserUsagePercent(user.id, quota.quotaBytes);

    for (const threshold of getExceededQuotaThresholds(usagePercent)) {
      const alertType = `quota_${threshold.percent}%_user${user.id}`;

      // Use in-memory set lookup instead of database query (Proposal 14)
      if (recentAlertTypes.has(alertType)) {
        continue; // Duplicate alert suppressed
      }

      const message = `User "${user.username}" has used ${usagePercent}% of traffic quota (${threshold.percent}% threshold exceeded)`;

      await createAlert(alertType, threshold.severity, message);
      recentAlertTypes.add(alertType); // Add to set to prevent duplicates in this run

      results.alertsCreated++;
      results.details.push({
        userId: user.id,
        username: user.username,
        percent: usagePercent,
        severity: threshold.severity,
      });
    }
  }

  return results;
}

/**
 * Calculate a user's traffic usage as a percentage of their quota.
 */
async function getUserUsagePercent(
  userId: number,
  quotaBytes: number,
): Promise<number> {
  // Sum traffic for the current month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const traffic = await prisma.trafficLog.aggregate({
    _sum: { bytesIn: true, bytesOut: true },
    where: {
      userId,
      timestamp: { gte: monthStart },
    },
  });

  const totalBytes = (traffic._sum.bytesIn ?? 0) + (traffic._sum.bytesOut ?? 0);
  return quotaBytes > 0 ? Math.round((totalBytes / quotaBytes) * 100) : 0;
}
