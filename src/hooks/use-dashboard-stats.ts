import { useQuery } from '@tanstack/react-query';
import type { DashboardStats } from '@/types/monitoring';
import { queryKeys } from '@/lib/query-keys';
import { apiGet, type ApiResponse } from '@/lib/api-client';

export function useDashboardStats() {
  return useQuery({
    queryKey: queryKeys.dashboardStats,
    queryFn: async () => {
      const response = await apiGet<ApiResponse<DashboardStats>>(
        '/api/dashboard/stats',
      );
      return response.data;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
