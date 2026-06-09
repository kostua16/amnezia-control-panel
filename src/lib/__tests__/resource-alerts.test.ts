import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESOURCE_CHECK_INTERVAL_MS,
  classifyResourceMetric,
} from '../resource-alerts';

describe('resource-alerts', () => {
  it('exports RESOURCE_CHECK_INTERVAL_MS as 60 seconds', () => {
    assert.strictEqual(RESOURCE_CHECK_INTERVAL_MS, 60_000);
  });
});

describe('classifyResourceMetric', () => {
  it('returns null when value is below warning threshold', () => {
    assert.strictEqual(classifyResourceMetric(50, 80, 90), null);
  });

  it('returns null at exactly 0', () => {
    assert.strictEqual(classifyResourceMetric(0, 80, 90), null);
  });

  it('returns WARNING at warning threshold boundary', () => {
    assert.strictEqual(classifyResourceMetric(80, 80, 90), 'WARNING');
  });

  it('returns WARNING between warning and critical thresholds', () => {
    assert.strictEqual(classifyResourceMetric(85, 80, 90), 'WARNING');
  });

  it('returns CRITICAL at critical threshold boundary', () => {
    assert.strictEqual(classifyResourceMetric(90, 80, 90), 'CRITICAL');
  });

  it('returns CRITICAL above critical threshold', () => {
    assert.strictEqual(classifyResourceMetric(99, 80, 90), 'CRITICAL');
  });

  it('returns CRITICAL at 100 percent', () => {
    assert.strictEqual(classifyResourceMetric(100, 80, 90), 'CRITICAL');
  });

  it('uses disk thresholds (90 warning, 95 critical)', () => {
    assert.strictEqual(classifyResourceMetric(89, 90, 95), null);
    assert.strictEqual(classifyResourceMetric(90, 90, 95), 'WARNING');
    assert.strictEqual(classifyResourceMetric(94, 90, 95), 'WARNING');
    assert.strictEqual(classifyResourceMetric(95, 90, 95), 'CRITICAL');
  });

  it('returns WARNING at exactly one below critical', () => {
    assert.strictEqual(classifyResourceMetric(89, 80, 90), 'WARNING');
  });
});
