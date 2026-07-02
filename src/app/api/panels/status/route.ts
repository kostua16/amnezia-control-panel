import { prisma } from '@/lib/prisma';
import {
  isPanelInFallback,
  getPanelHealthSnapshot,
} from '@/lib/panel-health-checker';
import { success, error } from '@/lib/api-response';
import type {
  FleetAggregatedStatus,
  PanelDashboardStatus,
} from '@/types/multi-panel-dashboard';

export async function GET() {
  try {
    const panels = await prisma.remotePanel.findMany({
      where: { isActive: true },
    });

    const snapshot = getPanelHealthSnapshot();

    const statuses: PanelDashboardStatus[] = await Promise.all(
      panels.map(async (panel) => {
        const cached = snapshot.get(panel.id);

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

        // Use the periodic checker's cached snapshot when available
        // to avoid redundant HTTP HEAD probes on every request.
        if (cached) {
          return {
            panelId: cached.panelId,
            panelName: panel.name,
            panelUrl: panel.panelUrl,
            status: cached.status,
            latencyMs: cached.latencyMs,
            lastCheckedAt: cached.checkedAt,
            lastSyncAt,
            servicesOnline: 0,
            servicesTotal: 0,
            isFallback: cached.isFallback,
          };
        }

        // Fallback when periodic health checks have not started yet.
        const fallback = isPanelInFallback(panel.id);
        return {
          panelId: panel.id,
          panelName: panel.name,
          panelUrl: panel.panelUrl,
          status: fallback ? 'degraded' : 'unknown',
          latencyMs: null,
          lastCheckedAt: null,
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
    console.error(
      '[api/panels/status] Failed to aggregate panel statuses:',
      err,
    );
    return error('Failed to retrieve panel statuses', 500);
  }
}
