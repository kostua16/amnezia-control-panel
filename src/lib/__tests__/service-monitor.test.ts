import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ServiceHealth, ServiceKey } from '../service-monitor';

/**
 * Test the types and exported interface contract of service-monitor.
 * Actual systemctl calls are not testable in CI, so we validate:
 *  - Type exports exist and have correct shape
 *  - ServiceKey covers the expected services
 *  - The health check result shape is correct
 */

describe('service-monitor types', () => {
  it('ServiceKey allows awg and 3x-ui', () => {
    const keys: ServiceKey[] = ['awg', '3x-ui'];
    assert.strictEqual(keys.length, 2);
    assert.ok(keys.includes('awg'));
    assert.ok(keys.includes('3x-ui'));
  });

  it('ServiceHealth has the expected shape', () => {
    const health: ServiceHealth = {
      service: 'awg',
      systemdName: 'amnezia-awg',
      status: 'online',
      timestamp: new Date().toISOString(),
    };
    assert.strictEqual(health.service, 'awg');
    assert.strictEqual(health.systemdName, 'amnezia-awg');
    assert.ok(health.status === 'online' || health.status === 'offline');
    assert.ok(typeof health.timestamp === 'string');
    // Validate ISO timestamp is parseable
    assert.ok(!isNaN(Date.parse(health.timestamp)));
  });

  it('ServiceHealth accepts offline status', () => {
    const health: ServiceHealth = {
      service: '3x-ui',
      systemdName: '3x-ui',
      status: 'offline',
      timestamp: new Date().toISOString(),
    };
    assert.strictEqual(health.status, 'offline');
  });
});
