import { getSystemResources } from '@/lib/resource-monitor';
import { prisma } from '@/lib/prisma';
import { createAlert } from '@/lib/alert-service';
import type { AlertSeverity } from '@/generated/prisma/enums';

/** Resource threshold configuration */
interface ResourceThreshold {
  metric: string;
  warningPercent: number;
  criticalPercent: number;
  label: string;
}

const RESOURCE_THRESHOLDS: ResourceThreshold[] = [
  { metric: 'cpu', warningPercent: 80, criticalPercent: 90, label: 'CPU' },
  { metric: 'memory', warningPercent: 80, criticalPercent: 90, label: 'RAM' },
  { metric: 'disk', warningPercent: 90, criticalPercent: 95, label: 'Disk' },
];

/**
 * Determine severity for a resource metric value against its threshold.
 * Returns CRITICAL if value >= critical, WARNING if >= warning, or null if within normal range.
 */
export function classifyResourceSeverity(
  metric: string,
  value: number,
): { severity: AlertSeverity | null; label: string } {
  const threshold = RESOURCE_THRESHOLDS.find((t) => t.metric === metric);
  if (!threshold) return { severity: null, label: metric };

  let severity: AlertSeverity | null = null;
  if (value >= threshold.criticalPercent) {
    severity = 'CRITICAL';
  } else if (value >= threshold.warningPercent) {
    severity = 'WARNING';
  }

  return { severity, label: threshold.label };
}

/** How often to check resources (ms) */
export const RESOURCE_CHECK_INTERVAL_MS = 60 * 1000; // 60 seconds

/** Duplicate alert suppression window (ms) */
const DUPLICATE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

export interface ResourceCheckResult {
  checks: Array<{
    metric: string;
    label: string;
    value: number;
    warningThreshold: number;
    criticalThreshold: number;
    severity: AlertSeverity | null;
  }>;
  alertsCreated: number;
}

/**
 * Check system resources against configured thresholds.
 * Creates WARNING and CRITICAL alerts when thresholds are exceeded.
 * Prevents duplicate alerts within 30 minutes.
 */
export async function checkResourceThresholds(): Promise<ResourceCheckResult> {
  const resources = await getSystemResources();
  const results: ResourceCheckResult = {
    checks: [],
    alertsCreated: 0,
  };

  const metricValues: Record<string, number> = {
    cpu: resources.cpu.usage,
    memory: resources.memory.percent,
    disk: resources.disk.percent,
  };

  for (const threshold of RESOURCE_THRESHOLDS) {
    const value = metricValues[threshold.metric] ?? 0;

    const { severity, label } = classifyResourceSeverity(
      threshold.metric,
      value,
    );

    results.checks.push({
      metric: threshold.metric,
      label,
      value,
      warningThreshold: threshold.warningPercent,
      criticalThreshold: threshold.criticalPercent,
      severity,
    });

    if (severity) {
      const created = await createResourceAlert(
        threshold.metric,
        threshold.label,
        value,
        severity,
      );

      if (created) {
        results.alertsCreated++;
      }
    }
  }

  return results;
}

/**
 * Create a resource alert if one hasn't been created recently for the same metric and severity.
 */
async function createResourceAlert(
  metric: string,
  label: string,
  value: number,
  severity: AlertSeverity,
): Promise<boolean> {
  const alertType = `resource_${metric}`;

  // Check for a recent alert of the same type and severity
  const recentAlert = await prisma.alert.findFirst({
    where: {
      type: alertType,
      severity,
      createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (recentAlert) {
    return false; // Duplicate alert suppressed
  }

  const message = `${label} usage at ${value}% (${severity} threshold exceeded)`;

  await createAlert(alertType, severity, message);
  return true;
}
