'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import { queryKeys } from '@/lib/query-keys';
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
  'panel:fallback-change',
  'panel:push-progress',
  'chain:status-update',
];

/**
 * Mapping from WebSocket event types to React Query key prefixes.
 * When a WS event arrives, all queries whose key starts with the
 * mapped prefix are invalidated, triggering a fresh fetch.
 *
 * Poll-only (no WS→RQ mapping):
 * - panel:push-progress — consumed by push-wizard.tsx via lastEvent (no RQ cache)
 */
const WS_TO_QUERY_KEYS: Partial<
  Record<WsEventType, readonly (readonly string[])[]>
> = {
  'stats:update': [
    queryKeys.dashboardStats,
    queryKeys.serviceStatus,
    queryKeys.trafficStats,
    queryKeys.topUserTraffic,
  ],
  'resource:update': [queryKeys.systemResources],
  'user:status-change': [queryKeys.users],
  'panel:fallback-change': [queryKeys.fleetStatus],
  'alert:new': [queryKeys.alerts, queryKeys.alertsUnreadCount],
  'chain:status-update': [queryKeys.fleetStatus],
};

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
    events: WS_EVENTS as WsEventType[],
  });

  // Bridge: invalidate React Query caches when WebSocket events arrive
  useEffect(() => {
    for (const [eventType, queryKeys] of Object.entries(WS_TO_QUERY_KEYS)) {
      if (queryKeys && lastEvent[eventType]) {
        for (const queryKey of queryKeys) {
          queryClient.invalidateQueries({ queryKey });
        }
      }
    }
  }, [lastEvent, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <WebSocketContext.Provider value={{ isConnected, lastEvent }}>
        {children}
      </WebSocketContext.Provider>
    </QueryClientProvider>
  );
}
