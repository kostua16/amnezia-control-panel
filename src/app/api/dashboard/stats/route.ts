import { success, error } from '@/lib/api-response';
import {
  getCachedTrafficTotals,
  startBroadcaster,
} from '@/lib/real-time-broadcaster';
import { TRAFFIC_STATS_WINDOW_HOURS } from '@/lib/dashboard-stats';
import { prisma } from '@/lib/prisma';

/**
 * Get dashboard stats.
 * Uses cached traffic totals from the broadcaster when available,
 * otherwise falls back to a fresh query.
 */
export async function GET() {
  try {
    const cached = getCachedTrafficTotals();
    const now = Date.now();
    const cacheAge = cached ? now - cached.timestamp : Infinity;

    // Use cache if it's less than 2x the broadcaster interval (60s)
    const useCache = cached && cacheAge < 60_000;

    if (useCache) {
      // Cache hit - return cached data without additional queries
      return success({
        trafficBytesInWindow: cached.bytesIn,
        trafficBytesOutWindow: cached.bytesOut,
        trafficWindowHours: TRAFFIC_STATS_WINDOW_HOURS,
        cached: true,
        cacheAge: Math.round(cacheAge / 1000), // seconds
      });
    }

    // Cache miss - compute fresh stats
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
              gte: new Date(now - TRAFFIC_STATS_WINDOW_HOURS * 60 * 60 * 1000),
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

    return success({
      totalUsers,
      activeUsers,
      blockedUsers,
      trafficBytesInWindow: trafficAgg._sum.bytesIn ?? 0,
      trafficBytesOutWindow: trafficAgg._sum.bytesOut ?? 0,
      trafficWindowHours: TRAFFIC_STATS_WINDOW_HOURS,
      cached: false,
    });
  } catch (err) {
    console.error('[api/dashboard/stats] Error:', err);
    return error('Failed to fetch dashboard stats');
  }
}
