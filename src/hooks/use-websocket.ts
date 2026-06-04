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

/**
 * Stable callbacks ref updated after each render.
 * Avoids reconnecting the socket when callbacks change,
 * while satisfying react-hooks/refs (no ref writes during render).
 */
function useCallbacksRef(callbacks: {
  onMessage?: (data: unknown) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}) {
  const ref = useRef(callbacks);

  useEffect(() => {
    ref.current = callbacks;
  });

  return ref;
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

  // Stable ref for callbacks — updated post-render in an effect
  const callbacksRef = useCallbacksRef({ onMessage, onConnect, onDisconnect });

  // Stable message handler reads latest callback from ref
  const handleMessage = useCallback(
    (data: unknown) => {
      callbacksRef.current.onMessage?.(data);
    },
    [callbacksRef],
  );

  // Stabilize events list by serializing to a string key
  const eventsKey = events?.join(',');
  const eventsRef = useRef(events);

  useEffect(() => {
    eventsRef.current = events;
  });

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
      callbacksRef.current.onConnect?.();
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      callbacksRef.current.onDisconnect?.();
    });

    socket.on('connect_error', () => {
      setIsConnected(false);
    });

    if (onMessage) {
      socket.on('message', handleMessage);
    }

    // Listen for specific events if provided
    const currentEvents = eventsRef.current;
    if (currentEvents) {
      for (const eventType of currentEvents) {
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
    // eventsKey stabilizes the events array dependency.
    // Callbacks are read from a ref, so the socket won't reconnect when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect, eventsKey, onMessage, handleMessage]);

  return {
    isConnected,
    socket: socketRef,
    lastEvent,
  };
}
