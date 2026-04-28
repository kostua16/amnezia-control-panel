'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { useWebSocket } from '@/hooks/use-websocket';
import type { WsEventType } from '@/lib/websocket';

interface WebSocketContextValue {
  isConnected: boolean;
  lastEvent: Record<string, unknown>;
}

const WebSocketContext = createContext<WebSocketContextValue>({
  isConnected: false,
  lastEvent: {},
});

export function useWebSocketContext() {
  return useContext(WebSocketContext);
}

const WS_EVENTS: WsEventType[] = [
  'stats:update',
  'resource:update',
  'alert:new',
  'user:status-change',
];

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchInterval: 30_000,
          },
        },
      }),
  );

  const { isConnected, lastEvent } = useWebSocket({
    autoConnect: true,
    events: WS_EVENTS,
  });

  return (
    <QueryClientProvider client={queryClient}>
      <WebSocketContext.Provider value={{ isConnected, lastEvent }}>
        {children}
      </WebSocketContext.Provider>
    </QueryClientProvider>
  );
}
