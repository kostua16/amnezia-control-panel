'use client';

interface FleetHealthSummary {
  total: number;
  online: number;
  degraded: number;
  offline: number;
  unknown: number;
}

interface FleetHealthStripProps {
  summary: FleetHealthSummary;
  isLoading?: boolean;
}

function SkeletonBadge() {
  return <div className="h-6 w-16 animate-pulse rounded-full bg-muted" />;
}

export function FleetHealthStrip({ summary, isLoading }: FleetHealthStripProps) {
  if (isLoading) {
    return (
      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <SkeletonBadge />
            <SkeletonBadge />
            <SkeletonBadge />
          </div>
          <SkeletonBadge />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/20 bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-400">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            {summary.online} Online
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-yellow-500/20 bg-yellow-500/10 px-2.5 py-1 text-xs font-medium text-yellow-400">
            <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
            {summary.degraded} Degraded
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-400">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            {summary.offline} Offline
          </span>
        </div>
        <span className="text-sm text-muted-foreground">
          Fleet: {summary.total} panels
        </span>
      </div>
    </div>
  );
}
