'use client';

import { useState, useEffect } from 'react';
import { X, Clock, Zap, Hash } from 'lucide-react';
import { clsx } from 'clsx';

interface PanelDetailsDrawerProps {
  panelId: number;
  onClose: () => void;
}

interface StatusData {
  panelId: number;
  status: string;
  lastRecord: {
    success: boolean;
    latencyMs: number | null;
    message: string;
    version: string | null;
    checkedAt: string;
  } | null;
  history: Array<{
    id: number;
    success: boolean;
    latencyMs: number | null;
    message: string;
    version: string | null;
    checkedAt: string;
  }>;
}

export function PanelDetailsDrawer({ panelId, onClose }: PanelDetailsDrawerProps) {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await fetch(`/api/panels/${panelId}/status`);
        const json = await res.json();
        if (json.success) {
          setData(json.data);
        }
      } catch (err) {
        console.error('Failed to fetch panel status:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchStatus();
  }, [panelId]);

  const statusColors: Record<string, { dot: string; text: string }> = {
    connected: { dot: 'bg-green-500', text: 'text-green-500' },
    degraded: { dot: 'bg-yellow-500', text: 'text-yellow-500' },
    offline: { dot: 'bg-red-500', text: 'text-red-500' },
    unknown: { dot: 'bg-gray-400', text: 'text-muted-foreground' },
  };

  const current = statusColors[data?.status ?? 'unknown'] ?? statusColors.unknown;

  return (
    <div className={clsx(
      'fixed inset-y-0 right-0 z-50 w-96 max-w-full',
      'border-l border-border bg-background shadow-lg',
    )}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h2 className="text-lg font-bold">Connection Details</h2>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close details"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="p-6 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-muted-foreground">Loading...</span>
          </div>
        ) : data ? (
          <>
            {/* Status Card */}
            <div className={clsx(
              'rounded-lg border p-4',
              data.status === 'connected' ? 'bg-green-500/10 border-green-500/20' :
              data.status === 'degraded' ? 'bg-yellow-500/10 border-yellow-500/20' :
              data.status === 'offline' ? 'bg-red-500/10 border-red-500/20' :
              'bg-muted border-border',
            )}>
              <div className="flex items-center gap-2">
                <span className={clsx('h-2.5 w-2.5 rounded-full', current.dot)} />
                <span className={clsx('text-sm font-bold capitalize', current.text)}>
                  {data.status}
                </span>
              </div>
            </div>

            {/* Details */}
            {data.lastRecord && (
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-foreground">Last Check</h3>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>{new Date(data.lastRecord.checkedAt).toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Zap className="h-4 w-4" />
                  <span>Latency: {data.lastRecord.latencyMs !== null ? `${data.lastRecord.latencyMs}ms` : 'N/A'}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Hash className="h-4 w-4" />
                  <span>Version: {data.lastRecord.version ?? 'Unknown'}</span>
                </div>
              </div>
            )}

            {/* History */}
            {data.history.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-foreground">Recent History</h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {data.history.map((record) => (
                    <div key={record.id} className="flex items-center justify-between text-sm py-1.5 border-b border-border last:border-0">
                      <div className="flex items-center gap-2">
                        <span className={clsx(
                          'h-2 w-2 rounded-full',
                          record.success ? 'bg-green-500' : 'bg-red-500',
                        )} />
                        <span className="text-muted-foreground">
                          {new Date(record.checkedAt).toLocaleString()}
                        </span>
                      </div>
                      <span className="text-muted-foreground">
                        {record.latencyMs !== null ? `${record.latencyMs}ms` : 'Failed'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!data.lastRecord && (
              <p className="text-sm text-muted-foreground">No connection history yet.</p>
            )}
          </>
        ) : (
          <p className="text-sm text-destructive">Failed to load panel details.</p>
        )}
      </div>
    </div>
  );
}
