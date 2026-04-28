import { useQuery } from '@tanstack/react-query';
import type { DashboardStats } from '@/types/monitoring';

async function fetchDashboardStats(): Promise<DashboardStats> {
  const response = await fetch('/api/dashboard/stats');
  if (!response.ok) {
    throw new Error(`Failed to fetch dashboard stats (status ${response.status})`);
  }
  const json = await response.json();
  if (!json.success) {
    throw new Error(json.error || 'Failed to fetch dashboard stats');
  }
  return json.data;
}

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: fetchDashboardStats,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
