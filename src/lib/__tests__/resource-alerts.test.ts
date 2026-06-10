import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESOURCE_CHECK_INTERVAL_MS,
  RESOURCE_THRESHOLDS,
  classifyResourceSeverity,
} from '../resource-alerts';
import type { ResourceThreshold } from '../resource-alerts';

describe('resource-alerts', () => {
  describe('constants', () => {
    it('exports RESOURCE_CHECK_INTERVAL_MS as 60 seconds', () => {
      assert.strictEqual(RESOURCE_CHECK_INTERVAL_MS, 60_000);
    });

    it('defines thresholds for cpu, memory, and disk', () => {
      const metrics = RESOURCE_THRESHOLDS.map((t) => t.metric);
      assert.deepEqual(metrics.sort(), ['cpu', 'disk', 'memory']);
    });

    it('has critical > warning for every threshold', () => {
      for (const t of RESOURCE_THRESHOLDS) {
        assert.ok(
          t.criticalPercent > t.warningPercent,
          `${t.metric}: critical (${t.criticalPercent}) must be > warning (${t.warningPercent})`,
        );
      }
    });
  });

  describe('classifyResourceSeverity', () => {
    const threshold: ResourceThreshold = {
      metric: 'test',
      warningPercent: 80,
      criticalPercent: 90,
      label: 'Test',
    };

    it('returns null when below warning threshold', () => {
      assert.strictEqual(classifyResourceSeverity(0, threshold), null);
      assert.strictEqual(classifyResourceSeverity(50, threshold), null);
      assert.strictEqual(classifyResourceSeverity(79, threshold), null);
    });

    it('returns WARNING at exactly warning threshold', () => {
      assert.strictEqual(classifyResourceSeverity(80, threshold), 'WARNING');
    });

    it('returns WARNING between warning and critical', () => {
      assert.strictEqual(classifyResourceSeverity(85, threshold), 'WARNING');
      assert.strictEqual(classifyResourceSeverity(89, threshold), 'WARNING');
    });

    it('returns CRITICAL at exactly critical threshold', () => {
      assert.strictEqual(classifyResourceSeverity(90, threshold), 'CRITICAL');
    });

    it('returns CRITICAL above critical threshold', () => {
      assert.strictEqual(classifyResourceSeverity(95, threshold), 'CRITICAL');
      assert.strictEqual(classifyResourceSeverity(100, threshold), 'CRITICAL');
    });

    it('works with disk-specific thresholds', () => {
      const diskThreshold = RESOURCE_THRESHOLDS.find(
        (t) => t.metric === 'disk',
      )!;
      assert.strictEqual(classifyResourceSeverity(89, diskThreshold), null);
      assert.strictEqual(
        classifyResourceSeverity(90, diskThreshold),
        'WARNING',
      );
      assert.strictEqual(
        classifyResourceSeverity(95, diskThreshold),
        'CRITICAL',
      );
    });
  });
});
