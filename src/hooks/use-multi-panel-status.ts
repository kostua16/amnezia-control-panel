import { useQuery } from '@tanstack/react-query';
import type { FleetAggregatedStatus } from '@/types/multi-panel-dashboard';

async function fetchFleetStatus(): Promise<FleetAggregatedStatus> {
  const response = await fetch('/api/panels/status');
  if (!response.ok) {
    throw new Error(`Failed to fetch fleet status (status ${response.status})`);
  }
  const json = await response.json();
  if (!json.success) {
    throw new Error(json.error || 'Failed to fetch fleet status');
  }
  return json.data;
}

export function useMultiPanelStatus() {
  return useQuery({
    queryKey: ['fleet-status'],
    queryFn: fetchFleetStatus,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
