'use client';

import { clsx } from 'clsx';
import type { PanelConnectionStatus } from '@/lib/panel-health-checker';

interface PanelStatusBadgeProps {
  status: PanelConnectionStatus;
}

const statusConfig: Record<PanelConnectionStatus, { dot: string; label: string; tint: string }> = {
  connected: {
    dot: 'bg-green-500',
    label: 'Connected',
    tint: 'bg-green-500/10 border-green-500/20',
  },
  degraded: {
    dot: 'bg-yellow-500',
    label: 'Degraded',
    tint: 'bg-yellow-500/10 border-yellow-500/20',
  },
  offline: {
    dot: 'bg-red-500',
    label: 'Offline',
    tint: 'bg-red-500/10 border-red-500/20',
  },
  unknown: {
    dot: 'bg-gray-400',
    label: 'Unknown',
    tint: 'bg-muted border-border',
  },
};

export function PanelStatusBadge({ status }: PanelStatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={clsx('h-2.5 w-2.5 rounded-full', config.dot)}
        title={status}
      />
      <span className="text-sm">{config.label}</span>
    </span>
  );
}
