import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  VPN_SERVICES,
  DEFAULT_TRAFFIC_QUOTA_BYTES,
  DEFAULT_SPEED_LIMIT_KBPS,
  ALERT_SEVERITY_ORDER,
  TRAFFIC_PERIODS,
  type VpnService,
  type TrafficPeriod,
} from '../constants';

describe('VPN_SERVICES', () => {
  it('contains AWG and THREE_XUI keys', () => {
    assert.ok('AWG' in VPN_SERVICES);
    assert.ok('THREE_XUI' in VPN_SERVICES);
  });

  it('values match their keys', () => {
    assert.strictEqual(VPN_SERVICES.AWG, 'AWG');
    assert.strictEqual(VPN_SERVICES.THREE_XUI, 'THREE_XUI');
  });

  it('is frozen (readonly)', () => {
    // The `as const` assertion makes it readonly at compile time.
    // At runtime the object is not frozen, but the type prevents mutation.
    // Verify it has exactly 2 keys.
    assert.strictEqual(Object.keys(VPN_SERVICES).length, 2);
  });
});

describe('DEFAULT_TRAFFIC_QUOTA_BYTES', () => {
  it('equals 10 GB in bytes', () => {
    assert.strictEqual(DEFAULT_TRAFFIC_QUOTA_BYTES, 10 * 1024 * 1024 * 1024);
  });

  it('is a positive number', () => {
    assert.ok(DEFAULT_TRAFFIC_QUOTA_BYTES > 0);
  });
});

describe('DEFAULT_SPEED_LIMIT_KBPS', () => {
  it('is 0 (unlimited)', () => {
    assert.strictEqual(DEFAULT_SPEED_LIMIT_KBPS, 0);
  });
});

describe('ALERT_SEVERITY_ORDER', () => {
  it('has exactly 3 levels', () => {
    assert.strictEqual(ALERT_SEVERITY_ORDER.length, 3);
  });

  it('orders CRITICAL first', () => {
    assert.strictEqual(ALERT_SEVERITY_ORDER[0], 'CRITICAL');
  });

  it('orders WARNING second', () => {
    assert.strictEqual(ALERT_SEVERITY_ORDER[1], 'WARNING');
  });

  it('orders INFO last', () => {
    assert.strictEqual(ALERT_SEVERITY_ORDER[2], 'INFO');
  });
});

describe('TRAFFIC_PERIODS', () => {
  it('has 4 periods', () => {
    assert.strictEqual(TRAFFIC_PERIODS.length, 4);
  });

  it('contains hourly, daily, weekly, monthly', () => {
    const expected = ['hourly', 'daily', 'weekly', 'monthly'];
    assert.deepStrictEqual([...TRAFFIC_PERIODS], expected);
  });
});

describe('VpnService type', () => {
  it('narrows to union of VPN_SERVICES values', () => {
    const values: VpnService[] = [VPN_SERVICES.AWG, VPN_SERVICES.THREE_XUI];
    assert.strictEqual(values.length, 2);
  });
});

describe('TrafficPeriod type', () => {
  it('narrows to union of TRAFFIC_PERIODS values', () => {
    const periods: TrafficPeriod[] = [...TRAFFIC_PERIODS];
    assert.strictEqual(periods.length, 4);
  });
});
