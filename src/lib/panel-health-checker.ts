import { prisma } from '@/lib/prisma';
import type { PanelTestResult, PanelConnectionRecord } from '@/types/remote-panel';

// ─── Types ──────────────────────────────────────────────

export type PanelConnectionStatus = 'connected' | 'degraded' | 'offline' | 'unknown';

// ─── Health Check Interval ──────────────────────────────

let healthCheckInterval: ReturnType<typeof setInterval> | null = null;

// ─── Test Panel ─────────────────────────────────────────

/**
 * Test connectivity to a remote panel by making a HEAD request to its URL.
 * Records the result in PanelConnectionHistory and prunes to last 10 records.
 */
export async function testPanel(panelId: number): Promise<PanelTestResult> {
  const panel = await prisma.remotePanel.findUnique({ where: { id: panelId } });

  if (!panel) {
    return {
      success: false,
      latencyMs: null,
      message: 'Panel not found',
      version: null,
      timestamp: new Date().toISOString(),
    };
  }

  const startTime = Date.now();
  let reachable = false;

  try {
    const response = await fetch(panel.panelUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });
    // Any response (2xx-5xx) means the panel is reachable
    reachable = response.ok || response.status < 600;
  } catch {
    reachable = false;
  }

  const latencyMs = reachable ? Date.now() - startTime : null;

  const result: PanelTestResult = {
    success: reachable,
    latencyMs,
    message: reachable
      ? `Panel reachable (${latencyMs}ms)`
      : `Cannot reach ${panel.panelUrl}`,
    version: null, // Will be populated when remote panel implements version endpoint
    timestamp: new Date().toISOString(),
  };

  // Save result to DB
  await prisma.panelConnectionHistory.create({
    data: {
      panelId,
      success: result.success,
      latencyMs: result.latencyMs,
      message: result.message,
      version: result.version,
    },
  });

  // Prune old records (keep last 10)
  const historyCount = await prisma.panelConnectionHistory.count({ where: { panelId } });
  if (historyCount > 10) {
    const excess = historyCount - 10;
    const oldRecords = await prisma.panelConnectionHistory.findMany({
      where: { panelId },
      orderBy: { checkedAt: 'asc' },
      take: excess,
      select: { id: true },
    });
    if (oldRecords.length > 0) {
      await prisma.panelConnectionHistory.deleteMany({
        where: { id: { in: oldRecords.map(r => r.id) } },
      });
    }
  }

  return result;
}

// ─── Get Panel Status ──────────────────────────────────

/**
 * Derive the current connection status for a panel from its most recent history record.
 * Status thresholds:
 *   connected: latency <= 100ms
 *   degraded: latency 101-500ms OR latency > 500ms but reachable
 *   offline: connection failed
 *   unknown: no history records
 */
export async function getPanelStatus(panelId: number): Promise<{
  status: PanelConnectionStatus;
  lastRecord: PanelConnectionRecord | null;
}> {
  const latest = await prisma.panelConnectionHistory.findFirst({
    where: { panelId },
    orderBy: { checkedAt: 'desc' },
  });

  if (!latest) {
    return { status: 'unknown', lastRecord: null };
  }

  let status: PanelConnectionStatus;

  if (!latest.success) {
    status = 'offline';
  } else if (latest.latencyMs !== null && latest.latencyMs <= 100) {
    status = 'connected';
  } else {
    status = 'degraded';
  }

  const lastRecord: PanelConnectionRecord = {
    id: latest.id,
    success: latest.success,
    latencyMs: latest.latencyMs,
    message: latest.message,
    version: latest.version,
    checkedAt: latest.checkedAt.toISOString(),
  };

  return { status, lastRecord };
}

// ─── Periodic Health Checks ─────────────────────────────

/**
 * Start periodic health checks for all active remote panels.
 * Runs every 30 seconds. Safe to call multiple times (guard prevents double-start).
 */
export function startPanelHealthChecks(): void {
  if (healthCheckInterval) return;

  healthCheckInterval = setInterval(async () => {
    try {
      const panels = await prisma.remotePanel.findMany({
        where: { isActive: true },
      });

      for (const panel of panels) {
        try {
          await testPanel(panel.id);
        } catch (err) {
          console.error('[panel-health] Check failed for panel', panel.id, err);
        }
      }
    } catch (err) {
      console.error('[panel-health] Failed to query active panels:', err);
    }
  }, 30_000);
}

/**
 * Stop periodic health checks.
 */
export function stopPanelHealthChecks(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
  console.log('[panel-health] Stopped periodic health checks');
}
