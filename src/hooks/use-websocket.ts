'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type { WsEventType } from '@/lib/websocket';

interface UseWebSocketOptions {
  /** WebSocket server URL. Defaults to current origin. */
  url?: string;
  /** Auto-connect on mount. Default: true */
  autoConnect?: boolean;
  /** Events to subscribe to */
  events?: WsEventType[];
  /** Maximum reconnection attempts. Default: 10 */
  maxReconnectAttempts?: number;
}

interface UseWebSocketReturn {
  /** Whether the socket is currently connected */
  isConnected: boolean;
  /** Latest event data keyed by event name */
  lastEvent: Record<string, unknown>;
  /** Manually connect */
  connect: () => void;
  /** Manually disconnect */
  disconnect: () => void;
}

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const {
    url,
    autoConnect = true,
    events = [],
    maxReconnectAttempts = 10,
  } = options;

  const socketRef = useRef<Socket | null>(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<Record<string, unknown>>({});

  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;

    const socket = io(url ?? window.location.origin, {
      path: '/api/ws',
      transports: ['websocket', 'polling'],
      reconnection: false, // We handle reconnection ourselves
    });

    socket.on('connect', () => {
      setIsConnected(true);
      reconnectCountRef.current = 0;
      console.log('[ws] Connected');
    });

    socket.on('disconnect', (reason) => {
      setIsConnected(false);
      console.log(`[ws] Disconnected: ${reason}`);
    });

    socket.on('connect_error', () => {
      setIsConnected(false);

      // Exponential backoff reconnect
      if (reconnectCountRef.current < maxReconnectAttempts) {
        const delay = Math.min(
          1000 * Math.pow(2, reconnectCountRef.current),
          30_000,
        );
        reconnectCountRef.current += 1;

        reconnectTimerRef.current = setTimeout(() => {
          console.log(
            `[ws] Reconnect attempt ${reconnectCountRef.current} in ${delay}ms`,
          );
          socket.connect();
        }, delay);
      }
    });

    // Subscribe to events
    for (const event of events) {
      socket.on(event, (data: unknown) => {
        setLastEvent((prev) => ({ ...prev, [event]: data }));
      });
    }

    socketRef.current = socket;
  }, [url, events, maxReconnectAttempts]);

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectCountRef.current = maxReconnectAttempts; // stop auto-reconnect
    socketRef.current?.disconnect();
    socketRef.current = null;
    setIsConnected(false);
  }, [maxReconnectAttempts]);

  useEffect(() => {
    if (autoConnect) {
      connect();
    }
    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  return {
    isConnected,
    lastEvent,
    connect,
    disconnect,
  };
}
