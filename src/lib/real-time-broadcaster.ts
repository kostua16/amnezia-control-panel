import { getDashboardStats } from '@/lib/dashboard-stats';
import { getSystemResources } from '@/lib/resource-monitor';
import { broadcastEvent } from '@/lib/websocket';

let statsInterval: ReturnType<typeof setInterval> | null = null;
let resourcesInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the real-time broadcaster.
 * Pushes dashboard stats every 30s and system resources every 10s to connected WebSocket clients.
 */
export function startBroadcaster(): void {
  if (statsInterval) return; // already running

  // Dashboard stats — every 30s
  statsInterval = setInterval(async () => {
    try {
      broadcastEvent('stats:update', await getDashboardStats());
    } catch (err) {
      console.error('[broadcaster] Stats push failed:', err);
    }
  }, 30_000);

  // System resources — every 10s
  resourcesInterval = setInterval(async () => {
    try {
      const resources = await getSystemResources();
      broadcastEvent('resource:update', resources);
    } catch (err) {
      console.error('[broadcaster] Resources push failed:', err);
    }
  }, 10_000);
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
}
