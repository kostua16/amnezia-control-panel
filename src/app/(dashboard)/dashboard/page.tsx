'use client';

import { MetricsCards } from '@/components/dashboard/metrics-cards';
import { MultiPanelSection } from '@/components/dashboard/multi-panel-section';
import { ResourceMonitor } from '@/components/dashboard/resource-monitor';
import { TrafficStats } from '@/components/dashboard/traffic-stats';
import { DashboardWidgetError } from '@/components/dashboard-widget-error';

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
      <DashboardWidgetError label="Key metrics">
        <MetricsCards />
      </DashboardWidgetError>

      {/* Two-column layout for resources and traffic */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <DashboardWidgetError label="System resources">
            <ResourceMonitor />
          </DashboardWidgetError>
        </div>
        <div className="lg:col-span-2">
          <DashboardWidgetError label="Traffic overview">
            <TrafficStats />
          </DashboardWidgetError>
        </div>
      </div>

      {/* Multi-panel fleet overview */}
      <DashboardWidgetError label="Fleet overview">
        <MultiPanelSection />
      </DashboardWidgetError>
    </div>
  );
}
