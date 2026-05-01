'use client';

import { useMultiPanelStatus } from '@/hooks/use-multi-panel-status';
import { FleetHealthStrip } from './fleet-health-strip';
import { PanelCard } from './panel-card';
import { EmptyPanelCTA } from './empty-panel-cta';

export function MultiPanelSection() {
  const { data, isLoading } = useMultiPanelStatus();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <FleetHealthStrip
          summary={{ total: 0, online: 0, degraded: 0, offline: 0, unknown: 0 }}
          isLoading
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="animate-pulse rounded-lg bg-muted h-32" />
          ))}
        </div>
      </div>
    );
  }

  if (!data || data.summary.total === 0) {
    return <EmptyPanelCTA />;
  }

  return (
    <div className="space-y-4">
      <FleetHealthStrip summary={data.summary} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.panels.map((panel) => (
          <PanelCard key={panel.panelId} panel={panel} />
        ))}
      </div>
    </div>
  );
}
