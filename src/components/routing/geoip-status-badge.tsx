'use client';

import { useState, useEffect, useCallback, startTransition } from 'react';
import { RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/button';

interface GeoIPStatusData {
  loaded: boolean;
  stale: boolean;
  lastRefreshed: string | null;
  fileSize: number | null;
  error: string | null;
}

export function GeoIPStatusBadge() {
  const [status, setStatus] = useState<GeoIPStatusData | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/geoip/status');
      const json = await res.json();
      if (json.success) setStatus(json.data);
    } catch {
      // Non-critical -- status badge is informational
    }
  }, []);

  useEffect(() => {
    startTransition(() => {
      fetchStatus();
    });
  }, [fetchStatus]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch('/api/geoip/refresh', { method: 'POST' });
      await fetchStatus();
    } catch {
      // Non-critical
    } finally {
      setRefreshing(false);
    }
  };

  if (!status) return null;

  const dotColor = status.loaded
    ? status.stale
      ? 'bg-yellow-500'
      : 'bg-green-500'
    : 'bg-red-500';

  const label = status.loaded
    ? status.stale
      ? `Last updated ${status.lastRefreshed ? new Date(status.lastRefreshed).toLocaleDateString() : 'unknown'}`
      : 'Up to date'
    : 'Not loaded';

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className={clsx('inline-block h-2 w-2 rounded-full', dotColor)} />
      <span>GeoIP: {label}</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs"
        onClick={handleRefresh}
        disabled={refreshing}
        aria-label="Update GeoIP database"
      >
        <RefreshCw
          className={clsx('mr-1 h-3 w-3', refreshing && 'animate-spin')}
        />
        Update Now
      </Button>
    </div>
  );
}
