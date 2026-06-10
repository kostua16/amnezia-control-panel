import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALERT_SEVERITY_ORDER,
  DEFAULT_SPEED_LIMIT_KBPS,
  DEFAULT_TRAFFIC_QUOTA_BYTES,
  TRAFFIC_PERIODS,
  VPN_SERVICES,
  type TrafficPeriod,
  type VpnService,
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
  it('orders critical, warning, info', () => {
    assert.deepStrictEqual(ALERT_SEVERITY_ORDER, [
      'CRITICAL',
      'WARNING',
      'INFO',
    ]);
  });
});

describe('TRAFFIC_PERIODS', () => {
  it('contains hourly, daily, weekly, monthly', () => {
    assert.deepStrictEqual(
      [...TRAFFIC_PERIODS],
      ['hourly', 'daily', 'weekly', 'monthly'],
    );
  });
});

describe('constants types', () => {
  it('narrows VpnService to VPN service values', () => {
    const values: VpnService[] = [VPN_SERVICES.AWG, VPN_SERVICES.THREE_XUI];
    assert.strictEqual(values.length, 2);
  });

  it('narrows TrafficPeriod to configured traffic periods', () => {
    const periods: TrafficPeriod[] = [...TRAFFIC_PERIODS];
    assert.strictEqual(periods.length, 4);
  });
});
