import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { queryKeys } from '@/lib/query-keys';

describe('queryKeys', () => {
  it('exports all expected base keys', () => {
    assert.deepEqual(queryKeys.dashboardStats, ['dashboard-stats']);
    assert.deepEqual(queryKeys.alerts, ['alerts']);
    assert.deepEqual(queryKeys.alertsUnreadCount, ['alerts-unread-count']);
    assert.deepEqual(queryKeys.users, ['users']);
    assert.deepEqual(queryKeys.serviceStatus, ['service-status']);
    assert.deepEqual(queryKeys.fleetStatus, ['fleet-status']);
    assert.deepEqual(queryKeys.systemResources, ['system-resources']);
    assert.deepEqual(queryKeys.trafficStats, ['traffic-stats']);
    assert.deepEqual(queryKeys.topUserTraffic, ['top-user-traffic']);
  });

  it('keys are const tuples with correct types', () => {
    // `as const` ensures type-level readonly; verify runtime structure
    assert.equal(queryKeys.dashboardStats.length, 1);
    assert.equal(queryKeys.dashboardStats[0], 'dashboard-stats');
  });

  it('supports parameterized key spreading', () => {
    const params = { isRead: true, limit: 10 };
    assert.deepEqual([...queryKeys.alerts, params], ['alerts', params]);
    assert.deepEqual([...queryKeys.users, params], ['users', params]);
    assert.deepEqual(
      [...queryKeys.trafficStats, params],
      ['traffic-stats', params],
    );
    assert.deepEqual(
      [...queryKeys.serviceStatus, 'awg'],
      ['service-status', 'awg'],
    );
    assert.deepEqual(
      [...queryKeys.topUserTraffic, 10, 'daily'],
      ['top-user-traffic', 10, 'daily'],
    );
  });

  it('base keys serve as invalidation prefixes', () => {
    const baseKey = queryKeys.alerts;
    const specificKey = [...queryKeys.alerts, { page: 1 }];
    assert.equal(specificKey[0], baseKey[0]);
    assert.ok(specificKey.length > baseKey.length);
  });

  it('covers all known query key namespaces', () => {
    const namespaces = Object.keys(queryKeys);
    assert.ok(namespaces.includes('dashboardStats'));
    assert.ok(namespaces.includes('alerts'));
    assert.ok(namespaces.includes('alertsUnreadCount'));
    assert.ok(namespaces.includes('users'));
    assert.ok(namespaces.includes('serviceStatus'));
    assert.ok(namespaces.includes('fleetStatus'));
    assert.ok(namespaces.includes('systemResources'));
    assert.ok(namespaces.includes('trafficStats'));
    assert.ok(namespaces.includes('topUserTraffic'));
    assert.equal(namespaces.length, 9);
  });
});
