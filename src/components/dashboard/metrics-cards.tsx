'use client';

import { Users, Activity, HardDrive, Wifi } from 'lucide-react';
import { clsx } from 'clsx';
import { Card, CardContent } from '@/components/ui/card';
import { useDashboardStats } from '@/hooks/use-dashboard-stats';
import { Loader2 } from 'lucide-react';
import { formatBytes } from '@/lib/format';

interface MetricCardProps {
  label: string;
  value: string;
  subtext?: string;
  icon: React.ReactNode;
  isLoading?: boolean;
}

function MetricCard({
  label,
  value,
  subtext,
  icon,
  isLoading,
}: MetricCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-6">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          {isLoading ? (
            <div className="mt-1 flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <p className="text-2xl font-bold tracking-tight">{value}</p>
              {subtext && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {subtext}
                </p>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function MetricsCards() {
  const { data: stats, isLoading } = useDashboardStats();

  const totalTraffic = stats
    ? stats.totalTrafficBytesIn + stats.totalTrafficBytesOut
    : 0;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        label="Total Users"
        value={stats ? String(stats.totalUsers) : '--'}
        subtext={
          stats
            ? `${stats.activeUsers} active, ${stats.blockedUsers} blocked`
            : undefined
        }
        icon={<Users className="h-6 w-6 text-muted-foreground" />}
        isLoading={isLoading}
      />
      <MetricCard
        label="Active Users"
        value={stats ? String(stats.activeUsers) : '--'}
        subtext={
          stats
            ? `${Math.round(stats.totalUsers > 0 ? (stats.activeUsers / stats.totalUsers) * 100 : 0)}% of total`
            : undefined
        }
        icon={<Activity className="h-6 w-6 text-muted-foreground" />}
        isLoading={isLoading}
      />
      <MetricCard
        label="Total Traffic"
        value={stats ? formatBytes(totalTraffic) : '--'}
        subtext={
          stats
            ? `${formatBytes(stats.totalTrafficBytesIn)} down / ${formatBytes(stats.totalTrafficBytesOut)} up`
            : undefined
        }
        icon={<HardDrive className="h-6 w-6 text-muted-foreground" />}
        isLoading={isLoading}
      />
      <MetricCard
        label="Services Online"
        value={stats ? `${stats.servicesOnline}/${stats.servicesTotal}` : '--'}
        subtext={
          stats
            ? stats.servicesOnline === stats.servicesTotal
              ? 'All services running'
              : 'Some services down'
            : undefined
        }
        icon={<Wifi className="h-6 w-6 text-muted-foreground" />}
        isLoading={isLoading}
      />
    </div>
  );
}
