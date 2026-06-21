import { getDashboardStats } from '@/lib/dashboard-stats';
import { getSystemResources } from '@/lib/resource-monitor';
import { broadcastEvent, hasConnectedClients } from '@/lib/websocket';
import { cleanupOldTrafficLogs } from '@/lib/traffic-log-cleanup';

let statsInterval: ReturnType<typeof setInterval> | null = null;
let resourcesInterval: ReturnType<typeof setInterval> | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/** Cached traffic totals for reuse by API routes */
let cachedTrafficTotals: {
  bytesIn: number;
  bytesOut: number;
  timestamp: number;
} | null = null;

/**
 * Get cached traffic totals (computed once per broadcaster tick).
 * Returns null if no cache is available yet (e.g., broadcaster not started or no clients connected).
 */
export function getCachedTrafficTotals(): {
  bytesIn: number;
  bytesOut: number;
  timestamp: number;
} | null {
  return cachedTrafficTotals;
}

/**
 * Start the real-time broadcaster.
 * Pushes dashboard stats every 30s and system resources every 10s to connected WebSocket clients.
 * Skips all DB queries when no clients are connected.
 * Runs traffic log cleanup once daily.
 */
export function startBroadcaster(): void {
  if (statsInterval) return; // already running

  // Dashboard stats — every 30s
  statsInterval = setInterval(async () => {
    if (!hasConnectedClients()) {
      // No clients connected, skip expensive queries
      return;
    }

    try {
      const stats = await getDashboardStats();
      cachedTrafficTotals = {
        bytesIn: stats.trafficBytesInWindow,
        bytesOut: stats.trafficBytesOutWindow,
        timestamp: Date.now(),
      };
      broadcastEvent('stats:update', stats);
    } catch (err) {
      console.error('[broadcaster] Stats push failed:', err);
    }
  }, 30_000);

  // System resources — every 10s
  resourcesInterval = setInterval(async () => {
    if (!hasConnectedClients()) {
      // No clients connected, skip system resources query
      return;
    }

    try {
      const resources = await getSystemResources();
      broadcastEvent('resource:update', resources);
    } catch (err) {
      console.error('[broadcaster] Resources push failed:', err);
    }
  }, 10_000);

  // Traffic log cleanup — once daily (24 hours)
  cleanupInterval = setInterval(
    async () => {
      try {
        await cleanupOldTrafficLogs();
      } catch (err) {
        console.error('[broadcaster] Traffic log cleanup failed:', err);
      }
    },
    24 * 60 * 60 * 1000,
  );

  // Run cleanup once on startup (after a short delay to avoid startup churn)
  setTimeout(async () => {
    try {
      await cleanupOldTrafficLogs();
    } catch (err) {
      console.error('[broadcaster] Initial traffic log cleanup failed:', err);
    }
  }, 5000);
}

/**
 * Stop the real-time broadcaster.
 */
export function stopBroadcaster(): void {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
  if (resourcesInterval) {
    clearInterval(resourcesInterval);
    resourcesInterval = null;
  }
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  cachedTrafficTotals = null;
}
