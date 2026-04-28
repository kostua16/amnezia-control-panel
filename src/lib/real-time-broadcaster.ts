import { prisma } from '@/lib/prisma';
import { getSystemResources } from '@/lib/resource-monitor';
import { broadcastStatsUpdate, broadcastResourceUpdate } from '@/lib/websocket';

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
      const [totalUsers, activeUsers, blockedUsers, trafficAgg, servicesOnline, servicesTotal] =
        await Promise.all([
          prisma.user.count(),
          prisma.user.count({ where: { isActive: true } }),
          prisma.user.count({ where: { isBlocked: true } }),
          prisma.trafficLog.aggregate({
            _sum: { bytesIn: true, bytesOut: true },
          }),
          prisma.service.count({ where: { status: 'RUNNING' } }),
          prisma.service.count(),
        ]);

      broadcastStatsUpdate({
        totalUsers,
        activeUsers,
        blockedUsers,
        totalTrafficBytesIn: trafficAgg._sum.bytesIn ?? 0,
        totalTrafficBytesOut: trafficAgg._sum.bytesOut ?? 0,
        servicesOnline,
        servicesTotal,
      });
    } catch (err) {
      console.error('[broadcaster] Stats push failed:', err);
    }
  }, 30_000);

  // System resources — every 10s
  resourcesInterval = setInterval(() => {
    try {
      const resources = getSystemResources();
      broadcastResourceUpdate(resources);
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
