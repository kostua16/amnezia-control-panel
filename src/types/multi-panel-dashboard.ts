import type { PanelConnectionStatus } from '@/lib/panel-health-checker';

/** Per-panel status as displayed on the dashboard card */
export interface PanelDashboardStatus {
  panelId: number;
  panelName: string;
  panelUrl: string;
  status: PanelConnectionStatus;
  latencyMs: number | null;
  lastCheckedAt: string | null;
  lastSyncAt: string | null;
  servicesOnline: number;
  servicesTotal: number;
  isFallback: boolean;
}

/** Aggregated fleet status returned by GET /api/panels/status */
export interface FleetAggregatedStatus {
  panels: PanelDashboardStatus[];
  summary: {
    total: number;
    online: number;
    degraded: number;
    offline: number;
    unknown: number;
  };
}
