import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESOURCE_CHECK_INTERVAL_MS,
  RESOURCE_THRESHOLDS,
  classifySeverity,
} from '../resource-alerts';

describe('resource-alerts constants', () => {
  it('exports RESOURCE_CHECK_INTERVAL_MS as 60 seconds', () => {
    assert.strictEqual(RESOURCE_CHECK_INTERVAL_MS, 60_000);
  });

  it('defines thresholds for cpu, memory, and disk', () => {
    const metrics = RESOURCE_THRESHOLDS.map((t) => t.metric);
    assert.ok(metrics.includes('cpu'));
    assert.ok(metrics.includes('memory'));
    assert.ok(metrics.includes('disk'));
    assert.strictEqual(RESOURCE_THRESHOLDS.length, 3);
  });

  it('has critical > warning for every threshold', () => {
    for (const t of RESOURCE_THRESHOLDS) {
      assert.ok(
        t.criticalPercent > t.warningPercent,
        `${t.metric}: critical (${t.criticalPercent}) must exceed warning (${t.warningPercent})`,
      );
    }
  });
});

describe('classifySeverity', () => {
  it('returns null when value is below warning threshold', () => {
    assert.strictEqual(classifySeverity(50, 80, 90), null);
    assert.strictEqual(classifySeverity(0, 80, 90), null);
    assert.strictEqual(classifySeverity(79, 80, 90), null);
  });

  it('returns WARNING at and above warning threshold (below critical)', () => {
    assert.strictEqual(classifySeverity(80, 80, 90), 'WARNING');
    assert.strictEqual(classifySeverity(85, 80, 90), 'WARNING');
    assert.strictEqual(classifySeverity(89, 80, 90), 'WARNING');
  });

  it('returns CRITICAL at and above critical threshold', () => {
    assert.strictEqual(classifySeverity(90, 80, 90), 'CRITICAL');
    assert.strictEqual(classifySeverity(95, 80, 90), 'CRITICAL');
    assert.strictEqual(classifySeverity(100, 80, 90), 'CRITICAL');
  });

  it('works with disk thresholds (warning 90, critical 95)', () => {
    assert.strictEqual(classifySeverity(89, 90, 95), null);
    assert.strictEqual(classifySeverity(90, 90, 95), 'WARNING');
    assert.strictEqual(classifySeverity(94, 90, 95), 'WARNING');
    assert.strictEqual(classifySeverity(95, 90, 95), 'CRITICAL');
  });

  it('returns CRITICAL when warning and critical are equal and value meets them', () => {
    assert.strictEqual(classifySeverity(80, 80, 80), 'CRITICAL');
  });
});
