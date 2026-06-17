import { describe, expect, it } from 'vitest';
import { queryKeys } from '@/lib/query-keys';

describe('queryKeys', () => {
  it('exports all expected base keys', () => {
    expect(queryKeys.dashboardStats).toEqual(['dashboard-stats']);
    expect(queryKeys.alerts).toEqual(['alerts']);
    expect(queryKeys.alertsUnreadCount).toEqual(['alerts-unread-count']);
    expect(queryKeys.users).toEqual(['users']);
    expect(queryKeys.serviceStatus).toEqual(['service-status']);
    expect(queryKeys.fleetStatus).toEqual(['fleet-status']);
    expect(queryKeys.systemResources).toEqual(['system-resources']);
    expect(queryKeys.trafficStats).toEqual(['traffic-stats']);
    expect(queryKeys.topUserTraffic).toEqual(['top-user-traffic']);
  });

  it('keys are readonly const tuples', () => {
    // Type-level assertion: keys should be readonly
    const key = queryKeys.dashboardStats;
    expect(Object.isFrozen(key)).toBe(true);
  });

  it('supports parameterized key spreading', () => {
    const params = { isRead: true, limit: 10 };
    expect([...queryKeys.alerts, params]).toEqual(['alerts', params]);
    expect([...queryKeys.users, params]).toEqual(['users', params]);
    expect([...queryKeys.trafficStats, params]).toEqual(['traffic-stats', params]);
    expect([...queryKeys.serviceStatus, 'awg']).toEqual([
      'service-status',
      'awg',
    ]);
    expect([...queryKeys.topUserTraffic, 10, 'daily']).toEqual([
      'top-user-traffic',
      10,
      'daily',
    ]);
  });

  it('base keys serve as invalidation prefixes', () => {
    // React Query prefix matching: ['alerts'] matches ['alerts', {...}]
    const baseKey = queryKeys.alerts;
    const specificKey = [...queryKeys.alerts, { page: 1 }];
    expect(specificKey[0]).toBe(baseKey[0]);
    expect(specificKey.length).toBeGreaterThan(baseKey.length);
  });

  it('covers all known query key namespaces', () => {
    const namespaces = Object.keys(queryKeys);
    expect(namespaces).toContain('dashboardStats');
    expect(namespaces).toContain('alerts');
    expect(namespaces).toContain('alertsUnreadCount');
    expect(namespaces).toContain('users');
    expect(namespaces).toContain('serviceStatus');
    expect(namespaces).toContain('fleetStatus');
    expect(namespaces).toContain('systemResources');
    expect(namespaces).toContain('trafficStats');
    expect(namespaces).toContain('topUserTraffic');
    expect(namespaces).toHaveLength(9);
  });
});
