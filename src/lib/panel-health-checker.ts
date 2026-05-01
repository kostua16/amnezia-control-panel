import { prisma } from '@/lib/prisma';
import { broadcastEvent } from '@/lib/websocket';
import { createAlert } from '@/lib/alert-service';
import type { AlertSeverity } from '@/generated/prisma/enums';
import type { PanelTestResult, PanelConnectionRecord } from '@/types/remote-panel';
import type { PanelSyncPayload } from '@/types/panel-sync';

// ─── Types ──────────────────────────────────────────────

export type PanelConnectionStatus = 'connected' | 'degraded' | 'offline' | 'unknown';

// ─── Fallback Detection State ───────────────────────────

/** Track consecutive health check failures per panel for fallback detection */
const consecutiveFailures = new Map<number, number>();
/** Track which panels are currently in fallback mode */
const fallbackPanels = new Set<number>();
/** In-memory cache of plaintext API keys for auto-resync. Populated on manual push. */
const panelApiKeyCache = new Map<number, string>();

// ─── Health Check Interval ──────────────────────────────

let healthCheckInterval: ReturnType<typeof setInterval> | null = null;

// ─── Fallback Status Queries ────────────────────────────

/**
 * Check if a panel is currently in fallback mode.
 */
export function isPanelInFallback(panelId: number): boolean {
  return fallbackPanels.has(panelId);
}

/**
 * Get all panels currently in fallback mode.
 */
export function getFallbackPanels(): number[] {
  return Array.from(fallbackPanels);
}

/**
 * Cache a panel's API key for auto-resync use.
 * Called when admin triggers a manual push (which provides the plaintext key).
 */
export function cachePanelApiKey(panelId: number, apiKey: string): void {
  panelApiKeyCache.set(panelId, apiKey);
}

/**
 * Remove a panel's cached API key (e.g., when panel is deleted).
 */
export function removePanelApiKey(panelId: number): void {
  panelApiKeyCache.delete(panelId);
}

// ─── WebSocket Fallback Broadcast ───────────────────────

async function broadcastFallbackStatusChange(panelId: number, panelName: string, isFallback: boolean): Promise<void> {
  const severity: AlertSeverity = isFallback ? 'WARNING' : 'INFO';
  const message = isFallback
    ? `Panel "${panelName}" is running on cached config (central unreachable)`
    : `Panel "${panelName}" reconnected -- sync resumed`;

  // Create persisted Alert record for unified view
  try {
    await createAlert(`panel:${panelName}`, severity, message);
  } catch (err) {
    console.error('[panel-health] Failed to create alert for fallback change:', err);
  }

  broadcastEvent('panel:fallback-change', {
    panelId,
    panelName,
    isFallback,
    message,
    timestamp: new Date().toISOString(),
  });
}

// ─── Auto-Resync ────────────────────────────────────────

/**
 * Trigger auto-resync to a remote panel that just came back online.
 * Fetches the latest cached config, generates per-panel config, and pushes.
 * Runs asynchronously, errors are logged but do not propagate.
 */
async function triggerAutoResync(panelId: number, panelName: string): Promise<void> {
  try {
    // Import dynamically to avoid circular dependency at module load
    const { pushConfigToPanel } = await import('@/lib/panel-sync-client');

    const cachedApiKey = panelApiKeyCache.get(panelId);
    if (!cachedApiKey) {
      console.warn(`[panel-health] Auto-resync skipped for panel ${panelId}: no cached API key. Admin must trigger manual push first.`);
      return;
    }

    // Fetch latest cached config for this panel
    const cachedConfig = await prisma.cachedPanelConfig.findUnique({
      where: { panelId },
    });

    if (!cachedConfig) {
      console.warn(`[panel-health] Auto-resync skipped for panel ${panelId}: no cached config found`);
      return;
    }

    const panel = await prisma.remotePanel.findUnique({ where: { id: panelId } });
    if (!panel) return;

    const payload = cachedConfig.config as unknown as PanelSyncPayload;
    const result = await pushConfigToPanel(
      { id: panel.id, name: panel.name, panelUrl: panel.panelUrl, apiKey: cachedApiKey },
      payload,
    );

    if (result.success) {
      console.log(`[panel-health] Auto-resync succeeded for panel ${panelId}: configVersion=${result.configVersion}`);
    } else {
      console.error(`[panel-health] Auto-resync failed for panel ${panelId}: ${result.error}`);
    }
  } catch (err) {
    console.error(`[panel-health] Auto-resync error for panel ${panelId}:`, err);
  }
}

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
 * Includes fallback detection (3 consecutive failures) and auto-resync on recovery.
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
          const result = await testPanel(panel.id);

          // Fallback detection and auto-resync logic
          if (result.success) {
            const prevFailures = consecutiveFailures.get(panel.id) ?? 0;
            consecutiveFailures.set(panel.id, 0);

            // Auto-resync: if panel was in fallback and is now reachable
            if (fallbackPanels.has(panel.id)) {
              console.log(`[panel-health] Panel ${panel.id} (${panel.name}) reconnected -- triggering auto-resync`);
              fallbackPanels.delete(panel.id);
              broadcastFallbackStatusChange(panel.id, panel.name, false);
              triggerAutoResync(panel.id, panel.name);
            }
          } else {
            const failures = (consecutiveFailures.get(panel.id) ?? 0) + 1;
            consecutiveFailures.set(panel.id, failures);

            // Fallback detection: 3 consecutive failures per CONTEXT.md decision
            if (failures >= 3 && !fallbackPanels.has(panel.id)) {
              console.warn(`[panel-health] Panel ${panel.id} (${panel.name}) unreachable x${failures} -- entering fallback mode`);
              fallbackPanels.add(panel.id);
              broadcastFallbackStatusChange(panel.id, panel.name, true);
            }
          }
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
