'use client';

import { ChevronDown } from 'lucide-react';
import type { PanelDashboardStatus } from '@/types/multi-panel-dashboard';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import { PanelStatusBadge } from '@/components/panels/panel-status-badge';
import { PanelCardExpanded } from './panel-card-expanded';
import { Card, CardContent } from '@/components/ui/card';

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${diffDay}d ago`;
}

interface PanelCardProps {
  panel: PanelDashboardStatus;
}

export function PanelCard({ panel }: PanelCardProps) {
  return (
    <Card>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <CardContent className="group cursor-pointer p-4 transition-colors hover:bg-muted/50">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">
                {panel.panelName}
              </h3>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
            </div>

            <div className="flex items-center">
              <PanelStatusBadge status={panel.status} />
              {panel.isFallback && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-yellow-500/20 bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-400">
                  Running on cached config
                </span>
              )}
            </div>

            <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
              {panel.latencyMs !== null && (
                <span>{panel.latencyMs}ms latency</span>
              )}
              <span>
                {panel.servicesOnline}/{panel.servicesTotal} services
              </span>
              {panel.lastCheckedAt && (
                <span>Last sync: {formatTimeAgo(panel.lastCheckedAt)}</span>
              )}
            </div>
          </CardContent>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="px-4 pb-4">
            <PanelCardExpanded panelId={panel.panelId} />
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
