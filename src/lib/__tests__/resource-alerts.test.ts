import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESOURCE_CHECK_INTERVAL_MS,
  RESOURCE_THRESHOLDS,
  classifyResourceSeverity,
} from '../resource-alerts';
import type { ResourceThreshold } from '../resource-alerts';

describe('resource-alerts constants', () => {
  it('exports RESOURCE_CHECK_INTERVAL_MS as 60 seconds', () => {
    assert.strictEqual(RESOURCE_CHECK_INTERVAL_MS, 60_000);
  });

  it('exports three resource thresholds', () => {
    assert.strictEqual(RESOURCE_THRESHOLDS.length, 3);
  });

  it('defines thresholds for cpu, memory, and disk', () => {
    const metrics = RESOURCE_THRESHOLDS.map((t) => t.metric);
    assert.ok(metrics.includes('cpu'));
    assert.ok(metrics.includes('memory'));
    assert.ok(metrics.includes('disk'));
  });

  it('has warning < critical for every threshold', () => {
    for (const t of RESOURCE_THRESHOLDS) {
      assert.ok(
        t.warningPercent < t.criticalPercent,
        `${t.metric}: warning (${t.warningPercent}) must be < critical (${t.criticalPercent})`,
      );
    }
  });
});

describe('classifyResourceSeverity', () => {
  const cpuThreshold: ResourceThreshold = {
    metric: 'cpu',
    warningPercent: 80,
    criticalPercent: 90,
    label: 'CPU',
  };

  const diskThreshold: ResourceThreshold = {
    metric: 'disk',
    warningPercent: 90,
    criticalPercent: 95,
    label: 'Disk',
  };

  it('returns null when value is below warning threshold', () => {
    assert.strictEqual(classifyResourceSeverity(50, cpuThreshold), null);
  });

  it('returns null when value is exactly one below warning', () => {
    assert.strictEqual(classifyResourceSeverity(79, cpuThreshold), null);
  });

  it('returns WARNING at exactly warning threshold', () => {
    assert.strictEqual(classifyResourceSeverity(80, cpuThreshold), 'WARNING');
  });

  it('returns WARNING between warning and critical', () => {
    assert.strictEqual(classifyResourceSeverity(85, cpuThreshold), 'WARNING');
  });

  it('returns WARNING at exactly one below critical', () => {
    assert.strictEqual(classifyResourceSeverity(89, cpuThreshold), 'WARNING');
  });

  it('returns CRITICAL at exactly critical threshold', () => {
    assert.strictEqual(classifyResourceSeverity(90, cpuThreshold), 'CRITICAL');
  });

  it('returns CRITICAL above critical threshold', () => {
    assert.strictEqual(classifyResourceSeverity(99, cpuThreshold), 'CRITICAL');
  });

  it('returns CRITICAL at 100 percent', () => {
    assert.strictEqual(classifyResourceSeverity(100, cpuThreshold), 'CRITICAL');
  });

  it('returns null for zero usage', () => {
    assert.strictEqual(classifyResourceSeverity(0, cpuThreshold), null);
  });

  it('works with disk thresholds (90/95)', () => {
    assert.strictEqual(classifyResourceSeverity(89, diskThreshold), null);
    assert.strictEqual(classifyResourceSeverity(90, diskThreshold), 'WARNING');
    assert.strictEqual(classifyResourceSeverity(94, diskThreshold), 'WARNING');
    assert.strictEqual(classifyResourceSeverity(95, diskThreshold), 'CRITICAL');
  });

  it('works with all exported thresholds', () => {
    for (const t of RESOURCE_THRESHOLDS) {
      assert.strictEqual(classifyResourceSeverity(0, t), null);
      assert.strictEqual(
        classifyResourceSeverity(t.warningPercent, t),
        'WARNING',
      );
      assert.strictEqual(
        classifyResourceSeverity(t.criticalPercent, t),
        'CRITICAL',
      );
    }
  });
});
