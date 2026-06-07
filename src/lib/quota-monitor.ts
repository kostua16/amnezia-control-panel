import { prisma } from '@/lib/prisma';
import { createAlert } from '@/lib/alert-service';
import type { AlertSeverity } from '@/generated/prisma/enums';

/** Quota alert thresholds in percent, ordered by percent ascending */
export const QUOTA_THRESHOLDS = [
  { percent: 80, severity: 'WARNING' as AlertSeverity },
  { percent: 90, severity: 'WARNING' as AlertSeverity },
  { percent: 100, severity: 'CRITICAL' as AlertSeverity },
];

/** How often to check quotas (ms) */
export const QUOTA_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

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
    const quota = user.quotas[0];
    if (!quota || quota.quotaBytes <= 0) continue;

    const usagePercent = await getUserUsagePercent(user.id, quota.quotaBytes);

    for (const threshold of QUOTA_THRESHOLDS) {
      if (usagePercent >= threshold.percent) {
        const created = await checkQuotaThreshold(
          user.id,
          user.username,
          usagePercent,
          threshold.percent,
          threshold.severity,
        );

        if (created) {
          results.alertsCreated++;
          results.details.push({
            userId: user.id,
            username: user.username,
            percent: usagePercent,
            severity: threshold.severity,
          });
        }
      }
    }
  }

  return results;
}

/**
 * Check if a specific user exceeds a quota threshold and create alert if needed.
 * Prevents duplicate alerts within the same quota period.
 */
async function checkQuotaThreshold(
  _userId: number,
  username: string,
  usagePercent: number,
  thresholdPercent: number,
  severity: AlertSeverity,
): Promise<boolean> {
  const alertType = `quota_${thresholdPercent}%`;

  // Check for a recent alert of the same type to prevent duplicates
  const recentAlert = await prisma.alert.findFirst({
    where: {
      type: alertType,
      message: { contains: username },
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }, // Within last hour
    },
    orderBy: { createdAt: 'desc' },
  });

  if (recentAlert) {
    return false; // Duplicate alert suppressed
  }

  const message = `User "${username}" has used ${usagePercent}% of traffic quota (${thresholdPercent}% threshold exceeded)`;

  await createAlert(alertType, severity, message);
  return true;
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

/**
 * Determine the highest-matching quota threshold severity for a usage percent.
 * Returns the severity of the highest exceeded threshold, or null if none.
 * Pure function — no side effects, suitable for unit testing.
 */
export function classifyQuotaSeverity(
  usagePercent: number,
): AlertSeverity | null {
  let result: AlertSeverity | null = null;
  for (const t of QUOTA_THRESHOLDS) {
    if (usagePercent >= t.percent) {
      result = t.severity;
    }
  }
  return result;
}
