import { prisma } from '@/lib/prisma';
import { broadcastEvent } from '@/lib/websocket';
import { createAlert } from '@/lib/alert-service';
import type { Alert } from '@/types/alert';
import type {
  PanelTestResult,
  PanelConnectionRecord,
} from '@/types/remote-panel';
import type { PanelSyncPayload } from '@/types/panel-sync';

// ─── Types ──────────────────────────────────────────────

export type PanelConnectionStatus =
  | 'connected'
  | 'degraded'
  | 'offline'
  | 'unknown';
type AlertSeverity = Alert['severity'];

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

async function broadcastFallbackStatusChange(
  panelId: number,
  panelName: string,
  isFallback: boolean,
): Promise<void> {
  const severity: AlertSeverity = isFallback ? 'WARNING' : 'INFO';
  const message = isFallback
    ? `Panel "${panelName}" is running on cached config (central unreachable)`
    : `Panel "${panelName}" reconnected -- sync resumed`;

  // Create persisted Alert record for unified view
  try {
    await createAlert(`panel:${panelName}`, severity, message);
  } catch (err) {
    console.error(
      '[panel-health] Failed to create alert for fallback change:',
      err,
    );
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
async function triggerAutoResync(
  panelId: number,
  _panelName: string,
): Promise<void> {
  try {
    // Import dynamically to avoid circular dependency at module load
    const { pushConfigToPanel } = await import('@/lib/panel-sync-client');

    const cachedApiKey = panelApiKeyCache.get(panelId);
    if (!cachedApiKey) {
      console.warn(
        `[panel-health] Auto-resync skipped for panel ${panelId}: no cached API key. Admin must trigger manual push first.`,
      );
      return;
    }

    // Fetch latest cached config for this panel
    const cachedConfig = await prisma.cachedPanelConfig.findUnique({
      where: { panelId },
    });

    if (!cachedConfig) {
      console.warn(
        `[panel-health] Auto-resync skipped for panel ${panelId}: no cached config found`,
      );
      return;
    }

    const panel = await prisma.remotePanel.findUnique({
      where: { id: panelId },
    });
    if (!panel) return;

    const payload = cachedConfig.config as unknown as PanelSyncPayload;
    const result = await pushConfigToPanel(
      {
        id: panel.id,
        name: panel.name,
        panelUrl: panel.panelUrl,
        apiKey: cachedApiKey,
      },
      payload,
    );

    if (result.success) {
      console.log(
        `[panel-health] Auto-resync succeeded for panel ${panelId}: configVersion=${result.configVersion}`,
      );
    } else {
      console.error(
        `[panel-health] Auto-resync failed for panel ${panelId}: ${result.error}`,
      );
    }
  } catch (err) {
    console.error(
      `[panel-health] Auto-resync error for panel ${panelId}:`,
      err,
    );
  }
}

// ─── Panel Health Testing ───────────────────────────────

/**
 * Test connectivity to a single remote panel.
 * Returns a detailed result with latency, status, and error info.
 */
export async function testPanel(panelId: number): Promise<PanelTestResult> {
  const panel = await prisma.remotePanel.findUnique({
    where: { id: panelId },
  });

  if (!panel) {
    return {
      success: false,
      panelId,
      latency: null,
      error: 'Panel not found',
    };
  }

  const startTime = Date.now();

  try {
    const response = await fetch(`${panel.panelUrl}/api/health`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
    });

    const latency = Date.now() - startTime;

    if (response.ok) {
      return {
        success: true,
        panelId,
        latency,
        status: 'connected',
      };
    }

    return {
      success: false,
      panelId,
      latency,
      error: `HTTP ${response.status}`,
    };
  } catch (err) {
    const latency = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      panelId,
      latency,
      error: message,
    };
  }
}

/**
 * Test connectivity to all active panels and return results.
 */
export async function testAllPanels(): Promise<PanelTestResult[]> {
  const panels = await prisma.remotePanel.findMany({
    where: { isActive: true },
  });

  const results = await Promise.all(
    panels.map((panel: { id: number }) => testPanel(panel.id)),
  );

  return results;
}

// ─── Periodic Health Checks ─────────────────────────────

/**
 * Start periodic health checks for all active panels.
 * Checks every 30 seconds.
 */
export function startPanelHealthChecks(): void {
  if (healthCheckInterval) {
    console.warn('[panel-health] Health checks already running');
    return;
  }

  console.log('[panel-health] Starting periodic health checks (30s interval)');

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
            consecutiveFailures.set(panel.id, 0);

            // Auto-resync: if panel was in fallback and is now reachable
            if (fallbackPanels.has(panel.id)) {
              console.log(
                `[panel-health] Panel ${panel.id} (${panel.name}) reconnected -- triggering auto-resync`,
              );
              fallbackPanels.delete(panel.id);
              broadcastFallbackStatusChange(panel.id, panel.name, false);
              triggerAutoResync(panel.id, panel.name);
            }
          } else {
            const failures = (consecutiveFailures.get(panel.id) ?? 0) + 1;
            consecutiveFailures.set(panel.id, failures);

            // Fallback detection: 3 consecutive failures per CONTEXT.md decision
            if (failures >= 3 && !fallbackPanels.has(panel.id)) {
              console.warn(
                `[panel-health] Panel ${panel.id} (${panel.name}) unreachable x${failures} -- entering fallback mode`,
              );
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

/**
 * Get status for a single panel with latest connection record.
 * Used by API routes to provide per-panel status data.
 */
export async function getPanelStatus(panelId: number): Promise<{
  status: PanelConnectionStatus;
  lastRecord: PanelConnectionRecord | null;
}> {
  const result = await testPanel(panelId);

  let lastRecord: PanelConnectionRecord | null = null;
  try {
    const history = await prisma.panelConnectionHistory.findFirst({
      where: { panelId },
      orderBy: { checkedAt: 'desc' },
    });
    if (history) {
      lastRecord = {
        id: history.id,
        success: history.success,
        latencyMs: history.latencyMs,
        message: history.message,
        version: history.version,
        checkedAt: history.checkedAt.toISOString(),
      };
    }
  } catch {
    // panelConnectionHistory table may not exist
  }

  return {
    status: result.success ? 'connected' : 'offline',
    lastRecord,
  };
}

/**
 * Get connection status records for all active panels.
 * Maps test results to PanelConnectionRecord format.
 */
export async function getPanelConnectionRecords(): Promise<
  PanelConnectionRecord[]
> {
  const panels = await prisma.remotePanel.findMany({
    where: { isActive: true },
  });

  const testResults = await Promise.all(
    panels.map((panel: { id: number }) => testPanel(panel.id)),
  );

  const now = new Date().toISOString();
  return testResults.map((result: PanelTestResult, index: number) => ({
    id: panels[index]?.id ?? 0,
    success: result.success,
    latencyMs: result.latency,
    message: result.error ?? (result.success ? 'OK' : 'Failed'),
    version: null,
    checkedAt: now,
  }));
}
