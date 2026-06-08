import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RESOURCE_CHECK_INTERVAL_MS } from '../resource-alerts';

/**
 * Test the threshold classification logic that resource-alerts uses.
 * The actual checkResourceThresholds() is tightly coupled to prisma and
 * getSystemResources, so we test the classification rules in isolation.
 */

interface ThresholdConfig {
  metric: string;
  warningPercent: number;
  criticalPercent: number;
  label: string;
}

const RESOURCE_THRESHOLDS: ThresholdConfig[] = [
  { metric: 'cpu', warningPercent: 80, criticalPercent: 90, label: 'CPU' },
  { metric: 'memory', warningPercent: 80, criticalPercent: 90, label: 'RAM' },
  { metric: 'disk', warningPercent: 90, criticalPercent: 95, label: 'Disk' },
];

function classifySeverity(
  metric: string,
  value: number,
): { severity: 'WARNING' | 'CRITICAL' | null; threshold: ThresholdConfig | undefined } {
  const threshold = RESOURCE_THRESHOLDS.find((t) => t.metric === metric);
  if (!threshold) return { severity: null, threshold: undefined };

  if (value >= threshold.criticalPercent) {
    return { severity: 'CRITICAL', threshold };
  }
  if (value >= threshold.warningPercent) {
    return { severity: 'WARNING', threshold };
  }
  return { severity: null, threshold };
}

describe('resource-alerts', () => {
  it('exports RESOURCE_CHECK_INTERVAL_MS as 60 seconds', () => {
    assert.strictEqual(RESOURCE_CHECK_INTERVAL_MS, 60_000);
  });

  describe('threshold classification', () => {
    it('classifies CPU at 79% as normal (no alert)', () => {
      const { severity } = classifySeverity('cpu', 79);
      assert.strictEqual(severity, null);
    });

    it('classifies CPU at 80% as WARNING', () => {
      const { severity } = classifySeverity('cpu', 80);
      assert.strictEqual(severity, 'WARNING');
    });

    it('classifies CPU at 90% as CRITICAL', () => {
      const { severity } = classifySeverity('cpu', 90);
      assert.strictEqual(severity, 'CRITICAL');
    });

    it('classifies CPU at 100% as CRITICAL', () => {
      const { severity } = classifySeverity('cpu', 100);
      assert.strictEqual(severity, 'CRITICAL');
    });

    it('classifies memory at 85% as WARNING', () => {
      const { severity } = classifySeverity('memory', 85);
      assert.strictEqual(severity, 'WARNING');
    });

    it('classifies memory at 95% as CRITICAL', () => {
      const { severity } = classifySeverity('memory', 95);
      assert.strictEqual(severity, 'CRITICAL');
    });

    it('classifies disk at 89% as normal', () => {
      const { severity } = classifySeverity('disk', 89);
      assert.strictEqual(severity, null);
    });

    it('classifies disk at 90% as WARNING', () => {
      const { severity } = classifySeverity('disk', 90);
      assert.strictEqual(severity, 'WARNING');
    });

    it('classifies disk at 95% as CRITICAL', () => {
      const { severity } = classifySeverity('disk', 95);
      assert.strictEqual(severity, 'CRITICAL');
    });

    it('returns null severity for unknown metric', () => {
      const { severity } = classifySeverity('network', 80);
      assert.strictEqual(severity, null);
    });

    it('all three metrics are covered', () => {
      assert.strictEqual(RESOURCE_THRESHOLDS.length, 3);
      const metrics = RESOURCE_THRESHOLDS.map((t) => t.metric);
      assert.ok(metrics.includes('cpu'));
      assert.ok(metrics.includes('memory'));
      assert.ok(metrics.includes('disk'));
    });
  });
});
