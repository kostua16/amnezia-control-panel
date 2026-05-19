import { prisma } from '@/lib/prisma';
import { success, error } from '@/lib/api-response';
import type { DashboardStats } from '@/types/monitoring';

export async function GET() {
  try {
    const [
      totalUsers,
      activeUsers,
      blockedUsers,
      trafficAgg,
      servicesOnline,
      servicesTotal,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.count({ where: { isBlocked: true } }),
      prisma.trafficLog.aggregate({
        _sum: { bytesIn: true, bytesOut: true },
      }),
      prisma.service.count({ where: { status: 'RUNNING' } }),
      prisma.service.count(),
    ]);

    const data: DashboardStats = {
      totalUsers,
      activeUsers,
      blockedUsers,
      totalTrafficBytesIn: trafficAgg._sum.bytesIn ?? 0,
      totalTrafficBytesOut: trafficAgg._sum.bytesOut ?? 0,
      servicesOnline,
      servicesTotal,
    };

    return success(data);
  } catch (err) {
    console.error('[api/dashboard/stats] Error:', err);
    return error('Failed to fetch dashboard stats');
  }
}
