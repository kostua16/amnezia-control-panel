import { prisma } from '@/lib/prisma';
import { getPanelStatus, isPanelInFallback } from '@/lib/panel-health-checker';
import { success, error } from '@/lib/api-response';
import type { FleetAggregatedStatus, PanelDashboardStatus } from '@/types/multi-panel-dashboard';

export async function GET() {
  try {
    const panels = await prisma.remotePanel.findMany({
      where: { isActive: true },
    });

    const statuses: PanelDashboardStatus[] = await Promise.all(
      panels.map(async (panel) => {
        const { status, lastRecord } = await getPanelStatus(panel.id);
        const fallback = isPanelInFallback(panel.id);

        let lastSyncAt: string | null = null;
        try {
          const latestConfig = await prisma.cachedPanelConfig.findFirst({
            where: { panelId: panel.id },
            orderBy: { receivedAt: 'desc' },
          });
          if (latestConfig) {
            lastSyncAt = latestConfig.receivedAt.toISOString();
          }
        } catch {
          // cachedPanelConfig table may not exist in all environments
        }

        return {
          panelId: panel.id,
          panelName: panel.name,
          panelUrl: panel.panelUrl,
          status,
          latencyMs: lastRecord?.latencyMs ?? null,
          lastCheckedAt: lastRecord?.checkedAt ?? null,
          lastSyncAt,
          servicesOnline: 0,
          servicesTotal: 0,
          isFallback: fallback,
        };
      }),
    );

    const summary = {
      total: statuses.length,
      online: statuses.filter((s) => s.status === 'connected').length,
      degraded: statuses.filter((s) => s.status === 'degraded').length,
      offline: statuses.filter((s) => s.status === 'offline').length,
      unknown: statuses.filter((s) => s.status === 'unknown').length,
    };

    const result: FleetAggregatedStatus = { panels: statuses, summary };

    return success(result);
  } catch (err) {
    console.error('[api/panels/status] Failed to aggregate panel statuses:', err);
    return error('Failed to retrieve panel statuses', 500);
  }
}
