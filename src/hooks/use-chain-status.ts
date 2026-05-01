'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
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
  /** Enable Socket.IO live updates. Default: true */
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
  const socketRef = useRef<Socket | null>(null);
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

  // Socket.IO for live updates
  useEffect(() => {
    if (!enableWebSocket) return;

    const connectSocket = () => {
      const socket = io(window.location.origin, {
        path: '/api/ws',
        transports: ['websocket', 'polling'],
        reconnection: false,
      });

      socket.on('connect', () => {
        setIsConnected(true);
        reconnectAttempts.current = 0;
      });

      socket.on('chain:status-update', (data: unknown) => {
        const payload = data as { chainId: string } & ChainStatus;
        if (payload.chainId === chainId) {
          setStatus(payload);
          setError(null);
        }
      });

      socket.on('disconnect', () => {
        setIsConnected(false);
        socketRef.current = null;

        // Reconnect with exponential backoff
        if (reconnectAttempts.current < 10) {
          const delay = Math.min(
            1000 * Math.pow(2, reconnectAttempts.current),
            30_000,
          );
          reconnectAttempts.current += 1;
          reconnectTimer.current = setTimeout(connectSocket, delay);
        }
      });

      socket.on('connect_error', () => {
        // Error is followed by disconnect handler's reconnect logic
      });

      socketRef.current = socket;
    };

    connectSocket();

    return () => {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      reconnectAttempts.current = 10; // prevent auto-reconnect after unmount
      socketRef.current?.disconnect();
      socketRef.current = null;
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
