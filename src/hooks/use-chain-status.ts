'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import type { ChainTopology } from '@/types/chain';

export interface ChainStatusNode {
  id: string;
  label: string;
  hostname: string;
  status: 'active' | 'degraded' | 'down';
  latencyMs: number | null;
}

export interface ChainStatusConnection {
  fromNode: string;
  toNode: string;
  trafficBytesPerSec: number;
  latencyMs: number | null;
}

export interface ChainStatus {
  chainId: string;
  topology: ChainTopology;
  isActive: boolean;
  nodes: ChainStatusNode[];
  connections: ChainStatusConnection[];
  lastUpdatedAt: string;
}

interface UseChainStatusOptions {
  chainId: string;
  /** Poll interval in milliseconds. Default: 5000 */
  pollInterval?: number;
  /** Enable WebSocket live updates. Default: true */
  enableWebSocket?: boolean;
}

interface UseChainStatusReturn {
  status: ChainStatus | null;
  isLoading: boolean;
  error: string | null;
  isConnected: boolean;
  refetch: () => void;
}

function formatBytesPerSec(bytes: number): string {
  if (bytes >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(1)} MB/s`;
  }
  if (bytes >= 1_000) {
    return `${(bytes / 1_000).toFixed(1)} KB/s`;
  }
  return `${bytes} B/s`;
}

export { formatBytesPerSec };

export function useChainStatus({
  chainId,
  pollInterval = 5000,
  enableWebSocket = true,
}: UseChainStatusOptions): UseChainStatusReturn {
  const [status, setStatus] = useState<ChainStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/chains/${chainId}/status`);
      const result = await response.json();

      if (result.success) {
        setStatus(result.data);
        setError(null);
      } else {
        setError(result.error ?? 'Failed to fetch chain status');
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Network error fetching status',
      );
    } finally {
      setIsLoading(false);
    }
  }, [chainId]);

  // Polling
  useEffect(() => {
    fetchStatus();

    const interval = setInterval(fetchStatus, pollInterval);
    return () => clearInterval(interval);
  }, [fetchStatus, pollInterval]);

  // WebSocket for live updates
  useEffect(() => {
    if (!enableWebSocket) return;

    const connectWs = () => {
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(
          `${protocol}//${window.location.host}/api/ws?chain=${chainId}`,
        );

        ws.onopen = () => {
          setIsConnected(true);
          reconnectAttempts.current = 0;
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'chain:status-update' && data.chainId === chainId) {
              setStatus(data.payload);
            }
          } catch {
            // Ignore non-JSON messages
          }
        };

        ws.onclose = () => {
          setIsConnected(false);
          wsRef.current = null;

          // Reconnect with exponential backoff
          if (reconnectAttempts.current < 10) {
            const delay = Math.min(
              1000 * Math.pow(2, reconnectAttempts.current),
              30_000,
            );
            reconnectAttempts.current += 1;
            reconnectTimer.current = setTimeout(connectWs, delay);
          }
        };

        ws.onerror = () => {
          // Error is followed by onclose
        };

        wsRef.current = ws;
      } catch {
        // WebSocket not available
      }
    };

    connectWs();

    return () => {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [chainId, enableWebSocket]);

  return {
    status,
    isLoading,
    error,
    isConnected,
    refetch: fetchStatus,
  };
}
