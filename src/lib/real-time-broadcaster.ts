import { prisma } from '@/lib/prisma';
import { getSystemResources } from '@/lib/resource-monitor';
import { broadcastEvent } from '@/lib/websocket';

let statsInterval: ReturnType<typeof setInterval> | null = null;
let resourcesInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Dashboard traffic stats sum only the recent window instead of the entire
 * `traffic_logs` table. The table grows unboundedly over months and a full-table
 * aggregate every 30s would degrade as rows accumulate. `timestamp` is indexed
 * (prisma `@@index([timestamp])`), so a range-bounded aggregate stays cheap.
 *
 * Configurable via the `TRAFFIC_STATS_WINDOW_HOURS` env var; defaults to 24h.
 */
const TRAFFIC_STATS_WINDOW_MS = (() => {
  const parsed = Number.parseInt(
    process.env.TRAFFIC_STATS_WINDOW_HOURS ?? '',
    10,
  );
  return (Number.isFinite(parsed) && parsed > 0 ? parsed : 24) * 60 * 60 * 1000;
})();

/**
 * Start the real-time broadcaster.
 * Pushes dashboard stats every 30s and system resources every 10s to connected WebSocket clients.
 */
export function startBroadcaster(): void {
  if (statsInterval) return; // already running

  // Dashboard stats — every 30s
  statsInterval = setInterval(async () => {
    try {
      // One groupBy replaces three separate user.count() queries; total/active/
      // blocked are derived from the (isActive, isBlocked) cohorts it returns.
      // The traffic aggregate is bounded to the recent window so it does not
      // scan the full history table on every tick.
      const [userCohorts, trafficAgg, servicesOnline, servicesTotal] =
        await Promise.all([
          prisma.user.groupBy({
            by: ['isActive', 'isBlocked'],
            _count: true,
          }),
          prisma.trafficLog.aggregate({
            _sum: { bytesIn: true, bytesOut: true },
            where: {
              timestamp: {
                gte: new Date(Date.now() - TRAFFIC_STATS_WINDOW_MS),
              },
            },
          }),
          prisma.service.count({ where: { status: 'RUNNING' } }),
          prisma.service.count(),
        ]);

      let totalUsers = 0;
      let activeUsers = 0;
      let blockedUsers = 0;
      for (const cohort of userCohorts) {
        const count = cohort._count;
        totalUsers += count;
        if (cohort.isActive) activeUsers += count;
        if (cohort.isBlocked) blockedUsers += count;
      }

      broadcastEvent('stats:update', {
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
