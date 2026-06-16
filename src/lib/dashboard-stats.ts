import { prisma } from '@/lib/prisma';
import type { DashboardStats } from '@/types/monitoring';

export const TRAFFIC_STATS_WINDOW_HOURS = (() => {
  const parsed = Number.parseInt(
    process.env.TRAFFIC_STATS_WINDOW_HOURS ?? '',
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
})();

const TRAFFIC_STATS_WINDOW_MS = TRAFFIC_STATS_WINDOW_HOURS * 60 * 60 * 1000;

export async function getDashboardStats(): Promise<DashboardStats> {
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

  return {
    totalUsers,
    activeUsers,
    blockedUsers,
    trafficBytesInWindow: trafficAgg._sum.bytesIn ?? 0,
    trafficBytesOutWindow: trafficAgg._sum.bytesOut ?? 0,
    trafficWindowHours: TRAFFIC_STATS_WINDOW_HOURS,
    servicesOnline,
    servicesTotal,
  };
}
