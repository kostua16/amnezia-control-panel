'use client';

import { CheckCircle, XCircle, Loader2, Clock } from 'lucide-react';
import { clsx } from 'clsx';
import type { PushProgressEvent } from '@/types/config-push';

interface PushProgressTrackerProps {
  progress: Map<number, PushProgressEvent>;
  panelIds: number[];
}

export function PushProgressTracker({
  progress,
  panelIds,
}: PushProgressTrackerProps) {
  return (
    <div className="space-y-3">
      {panelIds.map((panelId) => {
        const event = progress.get(panelId);
        const status = event?.status ?? 'pending';
        const panelName = event?.panelName ?? `Panel ${panelId}`;

        return (
          <div
            key={panelId}
            className={clsx(
              'flex items-center gap-3 rounded-md border p-3',
              status === 'success' && 'border-green-500/30 bg-green-500/5',
              status === 'failed' && 'border-red-500/30 bg-red-500/5',
              status === 'pushing' && 'border-accent/30 bg-accent/5',
            )}
          >
            <StatusIcon status={status} />
            <div className="flex-1">
              <p className="text-sm font-medium">{panelName}</p>
              <p className="text-xs text-muted-foreground">
                <StatusText status={status} panelName={panelName} event={event} />
              </p>
            </div>
            {status === 'success' && event?.latencyMs != null && (
              <span className="text-xs text-muted-foreground">({event.latencyMs}ms)</span>
            )}
            {status === 'failed' && event?.error && (
              <span className="text-xs text-destructive">{event.error.message}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatusIcon({ status }: { status: PushProgressEvent['status'] }) {
  switch (status) {
    case 'pending':
      return <Clock className="h-5 w-5 text-muted-foreground" />;
    case 'pushing':
    case 'applying':
      return <Loader2 className="h-5 w-5 text-accent animate-spin" />;
    case 'success':
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case 'failed':
      return <XCircle className="h-5 w-5 text-red-500" />;
    default:
      return <Clock className="h-5 w-5 text-muted-foreground" />;
  }
}

function StatusText({
  status,
  panelName,
  event,
}: {
  status: PushProgressEvent['status'];
  panelName: string;
  event?: PushProgressEvent;
}) {
  switch (status) {
    case 'pending':
      return <span>Waiting...</span>;
    case 'pushing':
      return <span>Pushing configuration to {panelName}...</span>;
    case 'applying':
      return <span>Applying configuration on {panelName}...</span>;
    case 'success':
      return (
        <span>
          Configuration applied to {panelName}
          {event?.latencyMs != null ? ` (${event.latencyMs}ms)` : ''}
        </span>
      );
    case 'failed':
      return <span className="text-destructive">Push failed</span>;
    default:
      return <span>Unknown status</span>;
  }
}
