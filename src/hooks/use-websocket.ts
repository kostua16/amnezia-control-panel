'use client';

import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

export interface UseWebSocketOptions {
  onMessage?: (data: unknown) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const reconnectCountRef = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 5;

  useEffect(() => {
    // Initialize socket connection
    const socket = io({
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
      reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
      setIsConnected(true);
      reconnectCountRef.current = 0;
    });

    socket.on('disconnect', (_reason) => {
      setIsConnected(false);
    });

    socket.on('connect_error', () => {
      setIsConnected(false);
    });

    if (options.onMessage) {
      socket.on('message', options.onMessage);
    }

    if (options.onConnect) {
      socket.on('connect', options.onConnect);
    }

    if (options.onDisconnect) {
      socket.on('disconnect', options.onDisconnect);
    }

    // Connect after setting up event handlers
    socket.connect();
    socketRef.current = socket;

    // Cleanup on unmount
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [options.onMessage, options.onConnect, options.onDisconnect]);

  return {
    isConnected,
    socket: socketRef.current,
  };
}
