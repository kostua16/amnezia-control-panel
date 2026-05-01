'use client';

import { clsx } from 'clsx';
import { Loader2 } from 'lucide-react';
import type { TrafficBucket } from '@/types/monitoring';
import { formatBytes } from '@/lib/format';

interface TrafficChartProps {
  buckets: TrafficBucket[];
  isLoading?: boolean;
  maxBars?: number;
}

export function TrafficChart({
  buckets,
  isLoading,
  maxBars = 24,
}: TrafficChartProps) {
  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (buckets.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        No traffic data available
      </div>
    );
  }

  // Sample buckets to maxBars
  const sampled = buckets.length > maxBars
    ? buckets.filter((_, i) => i % Math.ceil(buckets.length / maxBars) === 0)
    : buckets;

  // Find max value for scaling
  const maxValue = Math.max(
    ...sampled.map((b) => Math.max(b.bytesIn, b.bytesOut)),
    1, // avoid division by zero
  );

  // Format timestamp label for display
  function formatLabel(ts: string): string {
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return ts;
      // If the string contains hour info, show hour
      if (ts.includes(' ')) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      // Otherwise show short date
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return ts;
    }
  }

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-blue-500" />
          Download
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-green-500" />
          Upload
        </div>
      </div>

      {/* Bar chart */}
      <div className="flex items-end gap-1 overflow-x-auto pb-1">
        {sampled.map((bucket, i) => {
          const inHeight = Math.max(4, (bucket.bytesIn / maxValue) * 100);
          const outHeight = Math.max(4, (bucket.bytesOut / maxValue) * 100);

          return (
            <div
              key={`${bucket.timestamp}-${i}`}
              className="group relative flex flex-1 flex-col items-center gap-0.5"
              style={{ minWidth: 24 }}
            >
              {/* Tooltip */}
              <div className="pointer-events-none absolute -top-16 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs text-background opacity-0 shadow-md transition-opacity group-hover:opacity-100">
                <div>{formatLabel(bucket.timestamp)}</div>
                <div>Down: {formatBytes(bucket.bytesIn)}</div>
                <div>Up: {formatBytes(bucket.bytesOut)}</div>
              </div>

              {/* Bars container */}
              <div className="flex w-full items-end gap-px" style={{ height: 120 }}>
                <div
                  className="w-full rounded-t-sm bg-blue-500 transition-all duration-200"
                  style={{ height: `${inHeight}%` }}
                  title={`Download: ${formatBytes(bucket.bytesIn)}`}
                />
                <div
                  className="w-full rounded-t-sm bg-green-500 transition-all duration-200"
                  style={{ height: `${outHeight}%` }}
                  title={`Upload: ${formatBytes(bucket.bytesOut)}`}
                />
              </div>

              {/* Label */}
              <span className="mt-1 text-center text-[10px] text-muted-foreground leading-tight">
                {formatLabel(bucket.timestamp)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
