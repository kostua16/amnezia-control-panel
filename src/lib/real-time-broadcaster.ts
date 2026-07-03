import { getDashboardStats } from '@/lib/dashboard-stats';
import type { DashboardStats } from '@/types/monitoring';
import { getSystemResources } from '@/lib/resource-monitor';
import { broadcastEvent, hasConnectedClients } from '@/lib/websocket';
import { cleanupOldTrafficLogs } from '@/lib/traffic-log-cleanup';
import { cleanupOldAlerts } from '@/lib/alert-service';

let statsInterval: ReturnType<typeof setInterval> | null = null;
let resourcesInterval: ReturnType<typeof setInterval> | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;
let initialCleanupTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Cached dashboard snapshot computed once per broadcaster stats tick.
 * Kept so the stats API route can serve the same data without re-running the
 * traffic aggregate query on every poll. Only populated while a WebSocket
 * client is connected (the stats tick is skipped otherwise).
 */
let cachedDashboardStats: { stats: DashboardStats; timestamp: number } | null =
  null;

/**
 * Return the cached dashboard snapshot if one is available.
 * Returns null when no cache exists yet (broadcaster not started or no clients
 * connected to populate it). Callers decide their own freshness window.
 */
export function getCachedDashboardStats(): {
  stats: DashboardStats;
  timestamp: number;
} | null {
  return cachedDashboardStats;
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
      cachedDashboardStats = { stats, timestamp: Date.now() };
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
      // Run each cleanup independently so a failure in one does not skip the
      // other.
      try {
        await cleanupOldTrafficLogs();
      } catch (err) {
        console.error('[broadcaster] Traffic log cleanup failed:', err);
      }
      try {
        await cleanupOldAlerts();
      } catch (err) {
        console.error('[broadcaster] Alert cleanup failed:', err);
      }
    },
    24 * 60 * 60 * 1000,
  );

  // Run cleanup once on startup (after a short delay to avoid startup churn)
  initialCleanupTimeout = setTimeout(async () => {
    initialCleanupTimeout = null;
    try {
      await cleanupOldTrafficLogs();
    } catch (err) {
      console.error('[broadcaster] Initial traffic log cleanup failed:', err);
    }
    try {
      await cleanupOldAlerts();
    } catch (err) {
      console.error('[broadcaster] Initial alert cleanup failed:', err);
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
  if (initialCleanupTimeout) {
    clearTimeout(initialCleanupTimeout);
    initialCleanupTimeout = null;
  }
  cachedDashboardStats = null;
}
