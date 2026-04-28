import { useQuery } from '@tanstack/react-query';

export interface ServiceStatusData {
  service: string;
  status: 'online' | 'offline';
  timestamp: string;
}

async function fetchServiceStatus(serviceKey: string): Promise<ServiceStatusData> {
  const response = await fetch(`/api/services/${serviceKey}/status`);
  if (!response.ok) {
    throw new Error(`Failed to fetch status for ${serviceKey}`);
  }
  return response.json();
}

export function useServiceStatus(serviceKey: string) {
  return useQuery({
    queryKey: ['service-status', serviceKey],
    queryFn: () => fetchServiceStatus(serviceKey),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useAllServiceStatuses() {
  const awg = useServiceStatus('awg');
  const xui = useServiceStatus('3x-ui');

  return {
    awg,
    '3x-ui': xui,
    all: [awg, xui],
    isLoading: awg.isLoading || xui.isLoading,
    isError: awg.isError || xui.isError,
  };
}
