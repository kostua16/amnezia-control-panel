import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AlertData } from '@/lib/alert-service';
import type { AlertSeverity } from '@/generated/prisma/enums';
import { queryKeys } from '@/lib/query-keys';
import { apiGet, apiMutate } from '@/lib/api-client';

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

export function useAlerts(params?: AlertsParams) {
  return useQuery({
    queryKey: [...queryKeys.alerts, params],
    queryFn: () => apiGet<AlertsResponse>('/api/alerts', params),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useAlertUnreadCount() {
  return useQuery({
    queryKey: queryKeys.alertsUnreadCount,
    queryFn: async () => {
      const response = await apiGet<AlertsResponse>('/api/alerts', {
        limit: 1,
      });
      return response.data.pagination.unreadCount;
    },
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
}

export function useMarkAlertRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) =>
      apiMutate<{ success: boolean }>(`/api/alerts/${id}`, 'PUT'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts });
      queryClient.invalidateQueries({ queryKey: queryKeys.alertsUnreadCount });
    },
  });
}

export function useMarkAllAlertsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiMutate<{ success: boolean }>('/api/alerts/read-all', 'POST'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts });
      queryClient.invalidateQueries({ queryKey: queryKeys.alertsUnreadCount });
    },
  });
}

export function useDeleteAlert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) =>
      apiMutate<{ success: boolean }>(`/api/alerts/${id}`, 'DELETE'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts });
      queryClient.invalidateQueries({ queryKey: queryKeys.alertsUnreadCount });
    },
  });
}
