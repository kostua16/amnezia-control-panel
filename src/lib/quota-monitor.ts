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

  if (usersWithQuotas.length === 0) {
    return { checked: 0, alertsCreated: 0, details: [] };
  }

  // Batch 1: single grouped traffic aggregate replaces N per-user queries
  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const trafficByUser = await prisma.trafficLog.groupBy({
    by: ['userId'],
    _sum: { bytesIn: true, bytesOut: true },
    where: { timestamp: { gte: monthStart } },
  });
  const trafficMap = new Map<number, number>(
    trafficByUser.map((r) => [
      r.userId,
      (r._sum.bytesIn ?? 0) + (r._sum.bytesOut ?? 0),
    ]),
  );

  // Batch 2: single fetch of all recent quota alerts for dedup
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
    const quota = user.quotas.at(0);
    if (!quota || quota.quotaBytes <= 0) continue;

    const totalBytes = trafficMap.get(user.id) ?? 0;
    const usagePercent =
      quota.quotaBytes > 0
        ? Math.round((totalBytes / quota.quotaBytes) * 100)
        : 0;

    for (const threshold of getExceededQuotaThresholds(usagePercent)) {
      const alertType = `quota_${threshold.percent}%_user${user.id}`;

      if (recentAlertTypes.has(alertType)) {
        continue;
      }

      const message = `User "${user.username}" has used ${usagePercent}% of traffic quota (${threshold.percent}% threshold exceeded)`;

      await createAlert(alertType, threshold.severity, message);
      recentAlertTypes.add(alertType);

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
