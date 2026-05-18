'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type { WsEventType } from '@/lib/websocket';

export interface UseWebSocketOptions {
  autoConnect?: boolean;
  events?: WsEventType[];
  onMessage?: (data: unknown) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const {
    autoConnect = true,
    events,
    onMessage,
    onConnect,
    onDisconnect,
  } = options;
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<Record<string, unknown>>({});
  const socketRef = useRef<Socket | null>(null);
  const reconnectCountRef = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 5;

  const handleMessage = useCallback(
    (data: unknown) => {
      setLastEvent((prev) => ({ ...prev }));
      onMessage?.(data);
    },
    [onMessage],
  );

  useEffect(() => {
    if (!autoConnect) return;

    const socket = io({
      reconnection: true,
      reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
      reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
      setIsConnected(true);
      reconnectCountRef.current = 0;
      onConnect?.();
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      onDisconnect?.();
    });

    socket.on('connect_error', () => {
      setIsConnected(false);
    });

    if (onMessage) {
      socket.on('message', handleMessage);
    }

    // Listen for specific events if provided
    if (events) {
      for (const eventType of events) {
        socket.on(eventType, (data: unknown) => {
          setLastEvent((prev) => ({ ...prev, [eventType]: data }));
        });
      }
    }

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [autoConnect, events, onConnect, onDisconnect, onMessage, handleMessage]);

  return {
    isConnected,
    socket: socketRef,
    lastEvent,
  };
}
