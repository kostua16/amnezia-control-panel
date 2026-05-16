'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

interface ChainStatusNode {
  id: string;
  label: string;
  hostname: string;
  status: 'active' | 'degraded' | 'down';
  latencyMs: number | null;
}

interface ChainStatusConnection {
  fromNode: string;
  toNode: string;
  trafficBytesPerSec: number;
  latencyMs: number | null;
}

interface ChainStatus {
  chainId: string;
  topology: 'linear' | 'split' | 'mesh';
  isActive: boolean;
  nodes: ChainStatusNode[];
  connections: ChainStatusConnection[];
  lastUpdatedAt: string;
}

export interface UseChainStatusOptions {
  pollInterval?: number;
  enabled?: boolean;
}

export function useChainStatus(
  chainId: number | null,
  options: UseChainStatusOptions = {}
) {
  const { pollInterval = 5000, enabled = true } = options;
  const [status, setStatus] = useState<ChainStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!chainId || !enabled) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/chains/${chainId}/status`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      setStatus(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [chainId, enabled]);

  // Initial fetch
  useEffect(() => {
    void fetchStatus();
  }, [chainId, enabled]); // Only re-run when chainId or enabled changes

  // Polling
  useEffect(() => {
    if (!enabled || !chainId) return;

    pollingRef.current = setInterval(() => {
      void fetchStatus();
    }, pollInterval);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [chainId, pollInterval, enabled, fetchStatus]);

  return { status, isLoading, error, refetch: fetchStatus };
}
