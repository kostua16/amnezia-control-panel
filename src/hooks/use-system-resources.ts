import { useQuery } from '@tanstack/react-query';
import type { SystemResources } from '@/types/monitoring';
import { queryKeys } from '@/lib/query-keys';

async function fetchSystemResources(): Promise<SystemResources> {
  const response = await fetch('/api/monitoring/resources');
  if (!response.ok) {
    throw new Error(
      `Failed to fetch system resources (status ${response.status})`,
    );
  }
  const json = await response.json();
  if (!json.success) {
    throw new Error(json.error || 'Failed to fetch system resources');
  }
  return json.data;
}

export function useSystemResources() {
  return useQuery({
    queryKey: queryKeys.systemResources,
    queryFn: fetchSystemResources,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}
