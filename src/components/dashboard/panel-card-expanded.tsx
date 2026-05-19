'use client';

import { Cpu, MemoryStick, HardDrive } from 'lucide-react';
import { clsx } from 'clsx';
import { TrafficChart } from '@/components/dashboard/traffic-chart';

function getUsageColor(percent: number): string {
  if (percent >= 90) return 'bg-red-500';
  if (percent >= 70) return 'bg-yellow-500';
  return 'bg-green-500';
}

function getUsageTextColor(percent: number): string {
  if (percent >= 90) return 'text-red-500';
  if (percent >= 70) return 'text-yellow-500';
  return 'text-green-500';
}

interface ResourceBarProps {
  label: string;
  percent: number;
  used: string;
  total: string;
  icon: React.ReactNode;
  detail?: string;
}

function ResourceBar({
  label,
  percent,
  used,
  total,
  icon,
  detail,
}: ResourceBarProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {label}
        </div>
        <span className={clsx('text-sm font-bold', getUsageTextColor(percent))}>
          {percent}%
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={clsx(
            'h-full rounded-full transition-all duration-500',
            getUsageColor(percent),
          )}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {used} / {total}
        </span>
        {detail && <span>{detail}</span>}
      </div>
    </div>
  );
}

interface PanelCardExpandedProps {
  panelId: number;
}

export function PanelCardExpanded({
  panelId: _panelId,
}: PanelCardExpandedProps) {
  return (
    <div className="mt-4 space-y-6 border-t border-border pt-4">
      <div>
        <h4 className="mb-2 text-sm font-medium text-muted-foreground">
          Traffic
        </h4>
        <TrafficChart buckets={[]} maxBars={12} />
      </div>
      <div>
        <h4 className="mb-3 text-sm font-medium text-muted-foreground">
          Resources
        </h4>
        <div className="space-y-5">
          <ResourceBar
            label="CPU"
            percent={0}
            used="0%"
            total="0 cores"
            icon={<Cpu className="h-4 w-4 text-muted-foreground" />}
          />
          <ResourceBar
            label="Memory"
            percent={0}
            used="0 B"
            total="0 B"
            icon={<MemoryStick className="h-4 w-4 text-muted-foreground" />}
            detail="No data"
          />
          <ResourceBar
            label="Disk"
            percent={0}
            used="0 B"
            total="0 B"
            icon={<HardDrive className="h-4 w-4 text-muted-foreground" />}
            detail="No data"
          />
        </div>
      </div>
    </div>
  );
}
