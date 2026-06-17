import { useQuery } from '@tanstack/react-query';
import type { TrafficStatsResponse } from '@/types/monitoring';
import { queryKeys } from '@/lib/query-keys';

export interface TrafficStatsParams {
  userId?: number;
  period?: 'hourly' | 'daily' | 'weekly' | 'monthly';
  startDate?: string;
  endDate?: string;
}

async function fetchTrafficStats(
  params?: TrafficStatsParams,
): Promise<TrafficStatsResponse> {
  const searchParams = new URLSearchParams();

  if (params?.userId) searchParams.set('userId', String(params.userId));
  if (params?.period) searchParams.set('period', params.period);
  if (params?.startDate) searchParams.set('startDate', params.startDate);
  if (params?.endDate) searchParams.set('endDate', params.endDate);

  const query = searchParams.toString();
  const url = `/api/stats/traffic${query ? `?${query}` : ''}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch traffic stats (status ${response.status})`,
    );
  }
  const json = await response.json();
  if (!json.success) {
    throw new Error(json.error || 'Failed to fetch traffic stats');
  }
  return json.data;
}

export function useTrafficStats(params?: TrafficStatsParams) {
  return useQuery({
    queryKey: [...queryKeys.trafficStats, params],
    queryFn: () => fetchTrafficStats(params),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
