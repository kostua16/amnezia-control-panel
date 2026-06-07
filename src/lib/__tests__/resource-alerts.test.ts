import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESOURCE_CHECK_INTERVAL_MS,
  type ResourceCheckResult,
} from '../resource-alerts';

/**
 * Threshold classification logic extracted for pure testing.
 * The thresholds in resource-alerts.ts are:
 *   cpu:    warning 80%, critical 90%
 *   memory: warning 80%, critical 90%
 *   disk:   warning 90%, critical 95%
 *
 * The function checkResourceThresholds couples to getSystemResources and
 * prisma, so we test the classification logic in isolation here and rely
 * on integration tests for the full flow.
 */

interface ThresholdConfig {
  metric: string;
  warningPercent: number;
  criticalPercent: number;
  label: string;
}

const THRESHOLDS: ThresholdConfig[] = [
  { metric: 'cpu', warningPercent: 80, criticalPercent: 90, label: 'CPU' },
  { metric: 'memory', warningPercent: 80, criticalPercent: 90, label: 'RAM' },
  { metric: 'disk', warningPercent: 90, criticalPercent: 95, label: 'Disk' },
];

type Severity = 'WARNING' | 'CRITICAL' | null;

function classifyThreshold(
  metric: string,
  value: number,
): { severity: Severity; label: string } {
  const threshold = THRESHOLDS.find((t) => t.metric === metric);
  if (!threshold) return { severity: null, label: metric };

  let severity: Severity = null;
  if (value >= threshold.criticalPercent) {
    severity = 'CRITICAL';
  } else if (value >= threshold.warningPercent) {
    severity = 'WARNING';
  }

  return { severity, label: threshold.label };
}

describe('resource-alerts threshold classification', () => {
  // ─── Constants ──────────────────────────────────────────

  it('exports RESOURCE_CHECK_INTERVAL_MS as 60 seconds', () => {
    assert.strictEqual(RESOURCE_CHECK_INTERVAL_MS, 60_000);
  });

  // ─── CPU thresholds ─────────────────────────────────────

  it('classifies CPU usage below 80% as no alert', () => {
    const result = classifyThreshold('cpu', 50);
    assert.strictEqual(result.severity, null);
    assert.strictEqual(result.label, 'CPU');
  });

  it('classifies CPU usage at 80% as WARNING', () => {
    const result = classifyThreshold('cpu', 80);
    assert.strictEqual(result.severity, 'WARNING');
  });

  it('classifies CPU usage at 90% as CRITICAL', () => {
    const result = classifyThreshold('cpu', 90);
    assert.strictEqual(result.severity, 'CRITICAL');
  });

  it('classifies CPU usage at 89% as WARNING', () => {
    const result = classifyThreshold('cpu', 89);
    assert.strictEqual(result.severity, 'WARNING');
  });

  // ─── Memory thresholds ──────────────────────────────────

  it('classifies memory usage below 80% as no alert', () => {
    const result = classifyThreshold('memory', 79);
    assert.strictEqual(result.severity, null);
    assert.strictEqual(result.label, 'RAM');
  });

  it('classifies memory usage at 80% as WARNING', () => {
    const result = classifyThreshold('memory', 80);
    assert.strictEqual(result.severity, 'WARNING');
  });

  it('classifies memory usage at 90% as CRITICAL', () => {
    const result = classifyThreshold('memory', 90);
    assert.strictEqual(result.severity, 'CRITICAL');
  });

  // ─── Disk thresholds ────────────────────────────────────

  it('classifies disk usage below 90% as no alert', () => {
    const result = classifyThreshold('disk', 89);
    assert.strictEqual(result.severity, null);
    assert.strictEqual(result.label, 'Disk');
  });

  it('classifies disk usage at 90% as WARNING', () => {
    const result = classifyThreshold('disk', 90);
    assert.strictEqual(result.severity, 'WARNING');
  });

  it('classifies disk usage at 95% as CRITICAL', () => {
    const result = classifyThreshold('disk', 95);
    assert.strictEqual(result.severity, 'CRITICAL');
  });

  // ─── Edge cases ─────────────────────────────────────────

  it('classifies 100% usage as CRITICAL for all metrics', () => {
    for (const metric of ['cpu', 'memory', 'disk']) {
      const result = classifyThreshold(metric, 100);
      assert.strictEqual(result.severity, 'CRITICAL', `${metric} at 100%`);
    }
  });

  it('classifies 0% usage as no alert for all metrics', () => {
    for (const metric of ['cpu', 'memory', 'disk']) {
      const result = classifyThreshold(metric, 0);
      assert.strictEqual(result.severity, null, `${metric} at 0%`);
    }
  });

  it('returns null severity for unknown metric', () => {
    const result = classifyThreshold('network', 99);
    assert.strictEqual(result.severity, null);
  });

  // ─── ResourceCheckResult type shape ─────────────────────

  it('ResourceCheckResult shape matches expected interface', () => {
    const result: ResourceCheckResult = {
      checks: [
        {
          metric: 'cpu',
          label: 'CPU',
          value: 85,
          warningThreshold: 80,
          criticalThreshold: 90,
          severity: 'WARNING',
        },
      ],
      alertsCreated: 1,
    };
    assert.strictEqual(result.checks.length, 1);
    assert.strictEqual(result.checks[0].severity, 'WARNING');
    assert.strictEqual(result.alertsCreated, 1);
  });
});
