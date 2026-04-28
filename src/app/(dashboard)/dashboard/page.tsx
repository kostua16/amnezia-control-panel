'use client';

import { MetricsCards } from '@/components/dashboard/metrics-cards';
import { ResourceMonitor } from '@/components/dashboard/resource-monitor';
import { TrafficStats } from '@/components/dashboard/traffic-stats';

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Monitor your VPN services, traffic, and system resources
        </p>
      </div>

      {/* Key metrics */}
      <MetricsCards />

      {/* Two-column layout for resources and traffic */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <ResourceMonitor />
        </div>
        <div className="lg:col-span-2">
          <TrafficStats />
        </div>
      </div>
    </div>
  );
}
