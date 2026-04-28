'use client';

import { useState } from 'react';
import { clsx } from 'clsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Clock } from 'lucide-react';
import { useTrafficStats, type TrafficStatsParams } from '@/hooks/use-traffic-stats';
import { useTopUserTraffic } from '@/hooks/use-top-user-traffic';
import { TrafficChart } from './traffic-chart';

type Period = 'hourly' | 'daily' | 'weekly' | 'monthly';

const periods: { value: Period; label: string }[] = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function TrafficStats() {
  const [period, setPeriod] = useState<Period>('daily');

  const { data: trafficData, isLoading: trafficLoading } = useTrafficStats({
    period,
  });

  const { data: topUsers, isLoading: topUsersLoading } =
    useTopUserTraffic(10, period);

  const buckets = trafficData?.buckets ?? [];
  const totalIn = trafficData?.totalIn ?? 0;
  const totalOut = trafficData?.totalOut ?? 0;

  return (
    <div className="space-y-4">
      {/* Traffic over time chart */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle>Traffic Overview</CardTitle>
          <div className="flex items-center gap-1 rounded-md border border-border p-1">
            {periods.map((p) => (
              <Button
                key={p.value}
                variant={period === p.value ? 'default' : 'ghost'}
                size="sm"
                className="h-7 px-3 text-xs"
                onClick={() => setPeriod(p.value)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {/* Summary row */}
          <div className="mb-4 flex items-center gap-6 text-sm">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>
                Total: {formatBytes(totalIn + totalOut)} ({formatBytes(totalIn)} down /{' '}
                {formatBytes(totalOut)} up)
              </span>
            </div>
          </div>

          {/* Chart */}
          <TrafficChart buckets={buckets} isLoading={trafficLoading} />
        </CardContent>
      </Card>

      {/* Top users table */}
      <Card>
        <CardHeader>
          <CardTitle>Top Users by Traffic</CardTitle>
        </CardHeader>
        <CardContent>
          {topUsersLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !topUsers || topUsers.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No traffic data available for the selected period
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 font-medium text-muted-foreground">
                      User
                    </th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">
                      Upload
                    </th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">
                      Download
                    </th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topUsers.map((user) => (
                    <tr
                      key={user.userId}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 py-3 font-medium">{user.username}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatBytes(user.totalBytesOut)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatBytes(user.totalBytesIn)}
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {formatBytes(user.totalBytes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
