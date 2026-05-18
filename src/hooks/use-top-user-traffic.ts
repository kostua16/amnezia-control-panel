import { useQuery } from '@tanstack/react-query';
import type { TopUserTraffic } from '@/types/monitoring';

async function fetchTopUserTraffic(
  limit = 10,
  period: string = 'daily',
): Promise<TopUserTraffic[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    period,
  });
  const response = await fetch(`/api/stats/traffic/users?${params}`);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch top users by traffic (status ${response.status})`,
    );
  }
  const json = await response.json();
  if (!json.success) {
    throw new Error(json.error || 'Failed to fetch top users by traffic');
  }
  return json.data;
}

export function useTopUserTraffic(limit?: number, period?: string) {
  return useQuery({
    queryKey: ['top-user-traffic', limit, period],
    queryFn: () => fetchTopUserTraffic(limit, period),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
