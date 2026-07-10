import { useQuery } from '@tanstack/react-query';
import type { TrafficStatsResponse } from '@/types/monitoring';
import { queryKeys } from '@/lib/query-keys';
import { apiGet, type ApiResponse } from '@/lib/api-client';

export interface TrafficStatsParams {
  userId?: number;
  period?: 'hourly' | 'daily' | 'weekly' | 'monthly';
  startDate?: string;
  endDate?: string;
}

export function useTrafficStats(params?: TrafficStatsParams) {
  return useQuery({
    queryKey: [...queryKeys.trafficStats, params],
    queryFn: async () => {
      const response = await apiGet<ApiResponse<TrafficStatsResponse>>(
        '/api/stats/traffic',
        params,
      );
      return response.data;
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
