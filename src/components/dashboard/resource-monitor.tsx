'use client';

import { Cpu, MemoryStick, HardDrive, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSystemResources } from '@/hooks/use-system-resources';
import { formatBytes } from '@/lib/format';
import { getUsageColor, getUsageTextColor } from '@/lib/usage-colors';

interface ResourceBarProps {
  label: string;
  percent: number;
  used: string;
  total: string;
  icon: React.ReactNode;
  detail?: string;
}

function ResourceBar({
  label,
  percent,
  used,
  total,
  icon,
  detail,
}: ResourceBarProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {label}
        </div>
        <span className={clsx('text-sm font-bold', getUsageTextColor(percent))}>
          {percent}%
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={clsx(
            'h-full rounded-full transition-all duration-500',
            getUsageColor(percent),
          )}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {used} / {total}
        </span>
        {detail && <span>{detail}</span>}
      </div>
    </div>
  );
}

export function ResourceMonitor() {
  const { data: resources, isLoading } = useSystemResources();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>System Resources</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!resources) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>System Resources</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <ResourceBar
          label="CPU"
          percent={resources.cpu.usage}
          used={`${resources.cpu.usage}%`}
          total={`${resources.cpu.cores} cores`}
          icon={<Cpu className="h-4 w-4 text-muted-foreground" />}
        />
        <ResourceBar
          label="Memory"
          percent={resources.memory.percent}
          used={formatBytes(resources.memory.used)}
          total={formatBytes(resources.memory.total)}
          icon={<MemoryStick className="h-4 w-4 text-muted-foreground" />}
          detail={`${formatBytes(resources.memory.free)} free`}
        />
        <ResourceBar
          label="Disk"
          percent={resources.disk.percent}
          used={formatBytes(resources.disk.used)}
          total={formatBytes(resources.disk.total)}
          icon={<HardDrive className="h-4 w-4 text-muted-foreground" />}
          detail={`${formatBytes(resources.disk.free)} free`}
        />
      </CardContent>
    </Card>
  );
}
