import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useWebSocketContext } from '@/components/providers';
import type { AlertData } from '@/lib/alert-service';
import type { AlertSeverity } from '@/generated/prisma/enums';

export interface AlertsResponse {
  success: boolean;
  data: {
    alerts: AlertData[];
    pagination: {
      limit: number;
      offset: number;
      total: number;
      unreadCount: number;
    };
  };
}

export interface AlertsParams {
  isRead?: boolean;
  severity?: AlertSeverity;
  type?: string;
  limit?: number;
  offset?: number;
}

async function fetchAlerts(params?: AlertsParams): Promise<AlertsResponse> {
  const searchParams = new URLSearchParams();

  if (params?.isRead !== undefined) searchParams.set('isRead', String(params.isRead));
  if (params?.severity) searchParams.set('severity', params.severity);
  if (params?.type) searchParams.set('type', params.type);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));

  const query = searchParams.toString();
  const url = `/api/alerts${query ? `?${query}` : ''}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch alerts (status ${response.status})`);
  }
  return response.json();
}

export function useAlerts(params?: AlertsParams) {
  const { lastEvent } = useWebSocketContext();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['alerts', params],
    queryFn: () => fetchAlerts(params),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  // Invalidate alerts query when a new alert arrives via WebSocket
  useEffect(() => {
    if (lastEvent['alert:new']) {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['alerts-unread-count'] });
    }
  }, [lastEvent, queryClient]);

  return query;
}

export function useAlertUnreadCount() {
  const { lastEvent } = useWebSocketContext();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['alerts-unread-count'],
    queryFn: async () => {
      const response = await fetchAlerts({ limit: 1 });
      return response.data.pagination.unreadCount;
    },
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  // Invalidate unread count when a new alert arrives
  useEffect(() => {
    if (lastEvent['alert:new']) {
      queryClient.invalidateQueries({ queryKey: ['alerts-unread-count'] });
    }
  }, [lastEvent, queryClient]);

  return query;
}

export function useMarkAlertRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/alerts/${id}`, {
        method: 'PUT',
      });
      if (!response.ok) {
        throw new Error('Failed to mark alert as read');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['alerts-unread-count'] });
    },
  });
}

export function useMarkAllAlertsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/alerts/read-all', {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error('Failed to mark all alerts as read');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['alerts-unread-count'] });
    },
  });
}

export function useDeleteAlert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/alerts/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Failed to delete alert');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['alerts-unread-count'] });
    },
  });
}
