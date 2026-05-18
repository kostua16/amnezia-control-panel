'use client';

import { RefreshCw, Wifi, Globe } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAllServiceStatuses } from '@/hooks/use-service-status';

interface ServiceCardProps {
  title: string;
  serviceKey: string;
  status: 'online' | 'offline' | undefined;
  isLoading: boolean;
  isError: boolean;
  onRefresh: () => void;
  icon: React.ReactNode;
}

function ServiceCard({
  title,
  serviceKey,
  status,
  isLoading,
  isError,
  onRefresh,
  icon,
}: ServiceCardProps) {
  const statusColor =
    status === 'online'
      ? 'text-green-500'
      : status === 'offline'
        ? 'text-red-500'
        : 'text-muted-foreground';

  const statusBg =
    status === 'online'
      ? 'bg-green-500/10 border-green-500/20'
      : status === 'offline'
        ? 'bg-red-500/10 border-red-500/20'
        : 'bg-muted border-border';

  const statusLabel = isLoading
    ? 'Checking...'
    : isError
      ? 'Error'
      : status === 'online'
        ? 'Online'
        : status === 'offline'
          ? 'Offline'
          : 'Unknown';

  const dotColor =
    status === 'online'
      ? 'bg-green-500'
      : status === 'offline'
        ? 'bg-red-500'
        : 'bg-muted-foreground';

  return (
    <Card className={statusBg}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onRefresh}
          disabled={isLoading}
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${dotColor}`} />
          <span className={`text-sm font-medium ${statusColor}`}>
            {statusLabel}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Service: {serviceKey}
        </p>
      </CardContent>
    </Card>
  );
}

export function ServiceStatusDisplay() {
  const { awg, '3x-ui': xui, isLoading } = useAllServiceStatuses();

  const handleRefresh = () => {
    awg.refetch();
    xui.refetch();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Service Status</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isLoading}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ServiceCard
          title="Amnezia AWG"
          serviceKey="awg"
          status={awg.data?.status}
          isLoading={awg.isLoading}
          isError={awg.isError}
          onRefresh={() => awg.refetch()}
          icon={<Wifi className="h-5 w-5" />}
        />
        <ServiceCard
          title="3x-ui (Xray)"
          serviceKey="3x-ui"
          status={xui.data?.status}
          isLoading={xui.isLoading}
          isError={xui.isError}
          onRefresh={() => xui.refetch()}
          icon={<Globe className="h-5 w-5" />}
        />
      </div>
    </div>
  );
}
